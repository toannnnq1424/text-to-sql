package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func validRequest() QueryRequest {
	return QueryRequest{
		CorrelationID: "test-correlation", WarehouseID: "registered-test", Engine: "POSTGRESQL",
		Connection: Connection{Host: "127.0.0.1", Port: 55432, Database: "nla_chinook", Username: "nla_reader", Password: "test-only"},
		SQL:        "SELECT 1", MaxRows: 10, MaxBytes: 4096, TimeoutMs: 1000,
	}
}

func TestPrivateRouteAuthenticationAndValidationBeforePool(t *testing.T) {
	manager := NewPoolManager(2, time.Minute)
	var opened atomic.Int32
	manager.opener = func(context.Context, string, Connection) (*Source, error) {
		opened.Add(1)
		return nil, errors.New("test must not connect")
	}
	executor := &Executor{Token: strings.Repeat("t", 48), AllowedHosts: map[string]bool{"127.0.0.1": true}, Pools: manager, Slots: make(chan struct{}, 1)}
	for _, scenario := range []struct {
		name     string
		auth     bool
		change   func(*QueryRequest)
		expected int
	}{
		{"anonymous", false, func(*QueryRequest) {}, 401},
		{"host denied", true, func(input *QueryRequest) { input.Connection.Host = "169.254.169.254" }, 400},
		{"write denied", true, func(input *QueryRequest) { input.SQL = "DROP TABLE private" }, 400},
		{"unbounded rows", true, func(input *QueryRequest) { input.MaxRows = 10001 }, 400},
		{"unbounded timeout", true, func(input *QueryRequest) { input.TimeoutMs = 120001 }, 400},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			input := validRequest()
			scenario.change(&input)
			body, _ := json.Marshal(input)
			request := httptest.NewRequest(http.MethodPost, "/internal/v1/query", bytes.NewReader(body))
			if scenario.auth {
				request.Header.Set("Authorization", "Bearer "+executor.Token)
			}
			writer := httptest.NewRecorder()
			executor.ServeHTTP(writer, request)
			if writer.Code != scenario.expected {
				t.Fatalf("status %d", writer.Code)
			}
			if strings.Contains(writer.Body.String(), "test-only") {
				t.Fatal("credential leaked")
			}
		})
	}
	if opened.Load() != 0 {
		t.Fatal("invalid request reached native source")
	}
}

func TestSourceFingerprintIsCredentialSensitiveWithoutPlaintext(t *testing.T) {
	request := validRequest()
	key := poolKey(request)
	request.Connection.Password = "rotated"
	if key == poolKey(request) || strings.Contains(key, "test-only") {
		t.Fatal("unsafe source key")
	}
	parsed, err := url.Parse(BuildPostgresURL(Connection{Host: "::1", Port: 5432, Username: "name@x", Password: "secret@?#", Database: "a/b"}))
	if err != nil || parsed.Host != "[::1]:5432" {
		t.Fatal("invalid encoded connection URI")
	}
	password, _ := parsed.User.Password()
	if password != "secret@?#" {
		t.Fatal("DSN password was reinterpreted")
	}
}

func TestPoolLeasesReuseBoundsRotationAndIdleEviction(t *testing.T) {
	manager := NewPoolManager(1, time.Millisecond)
	defer manager.Close()
	var opened atomic.Int32
	manager.opener = func(context.Context, string, Connection) (*Source, error) {
		opened.Add(1)
		return &Source{}, nil
	}
	request := validRequest()
	first, releaseFirst, err := manager.Acquire(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	second, releaseSecond, err := manager.Acquire(context.Background(), request)
	if err != nil || first != second || opened.Load() != 1 {
		t.Fatal("pool was not shared")
	}
	request.Connection.Password = "rotated"
	if _, _, err := manager.Acquire(context.Background(), request); !errors.Is(err, ErrBusy) {
		t.Fatal("active pool was evicted")
	}
	releaseFirst()
	releaseSecond()
	_, releaseRotated, err := manager.Acquire(context.Background(), request)
	if err != nil || opened.Load() != 2 {
		t.Fatal("credential rotation did not replace idle source")
	}
	releaseRotated()
	time.Sleep(2 * time.Millisecond)
	manager.DeleteExpired()
	if len(manager.items) != 0 {
		t.Fatal("idle native source leaked")
	}
}

func TestConcurrentRequestsDoNotCreateDuplicatePools(t *testing.T) {
	manager := NewPoolManager(2, time.Minute)
	defer manager.Close()
	var opened atomic.Int32
	manager.opener = func(context.Context, string, Connection) (*Source, error) {
		opened.Add(1)
		time.Sleep(10 * time.Millisecond)
		return &Source{}, nil
	}
	var group sync.WaitGroup
	for range 20 {
		group.Go(func() {
			_, release, err := manager.Acquire(context.Background(), validRequest())
			if err != nil {
				t.Error(err)
				return
			}
			release()
		})
	}
	group.Wait()
	if opened.Load() != 1 {
		t.Fatal("concurrent duplicate pools")
	}
}

func TestCanonicalValuesAndUTF8Truncation(t *testing.T) {
	columns := []Column{NewColumn("value", "bigint"), NewColumn("value", "decimal"), NewColumn("enabled", "bit"), NewColumn("empty", "text")}
	count := 0
	result, err := CollectRows(columns, func() bool {
		count++
		return count <= 2
	}, func() ([]any, error) {
		return []any{int64(9007199254740993), []byte("1234.5000"), []byte{1}, nil}, nil
	}, func() error { return nil }, QueryRequest{MaxRows: 1, MaxBytes: 4096})
	if err != nil || !result.Truncated || result.ReturnedRowCount != 1 {
		t.Fatal("row bound failed", err)
	}
	row := result.Rows[0]
	if row["value"] != "9007199254740993" || row["value_2"] != "1234.5000" || row["enabled"] != true || row["empty"] != nil {
		t.Fatal("lossless typed result failed", row)
	}
	count = 0
	result, err = CollectRows([]Column{NewColumn("text", "text")}, func() bool {
		count++
		return count == 1
	}, func() ([]any, error) { return []any{"Tiếng Việt"}, nil }, func() error { return nil }, QueryRequest{MaxRows: 10, MaxBytes: 10})
	if err != nil || len(result.Rows) != 0 || !result.Truncated {
		t.Fatal("UTF-8 byte limit failed")
	}
}

func TestNativeEnginesTypedResultsAndCancellation(t *testing.T) {
	if os.Getenv("NLA_RUNTIME_INTEGRATION") != "true" {
		t.Skip("actual DB3 runtime flag not configured")
	}
	if err := RegisterMySQLPublicKey(os.Getenv("DATA_TOOL_MYSQL_PUBLIC_KEY")); err != nil {
		t.Fatal(err)
	}
	for _, spec := range []struct {
		engine string
		port   int
		suffix string
		sql    string
		slow   string
	}{
		{"POSTGRESQL", 55432, "PG", "SELECT CAST(9007199254740993 AS BIGINT) AS large_id, CAST(1234.5000 AS DECIMAL(20,4)) AS amount, TRUE AS enabled, CAST(NULL AS VARCHAR) AS empty_value, TIMESTAMPTZ '2026-10-20 12:34:56+07' AS moment, DATE '2026-10-20' AS day", "SELECT pg_sleep(5)"},
		{"MYSQL", 53306, "MYSQL", "SELECT CAST(9007199254740993 AS SIGNED) AS large_id, CAST(1234.5000 AS DECIMAL(20,4)) AS amount, b'1' AS enabled, CAST(NULL AS CHAR) AS empty_value, CAST('2026-10-20 05:34:56' AS DATETIME) AS moment, CAST('2026-10-20' AS DATE) AS day", "SELECT SLEEP(5)"},
		{"SQL_SERVER", 51433, "MSSQL", "SELECT CAST(9007199254740993 AS BIGINT) AS large_id, CAST(1234.5000 AS DECIMAL(20,4)) AS amount, CAST(1 AS BIT) AS enabled, CAST(NULL AS VARCHAR) AS empty_value, CAST('2026-10-20T12:34:56+07:00' AS DATETIMEOFFSET) AS moment, CAST('2026-10-20' AS DATE) AS day", "SELECT COUNT_BIG(*) FROM sys.all_objects a CROSS JOIN sys.all_objects b CROSS JOIN sys.all_objects c"},
	} {
		t.Run(spec.engine, func(t *testing.T) {
			request := validRequest()
			request.Engine = spec.engine
			request.Connection.Port = spec.port
			request.Connection.Password = os.Getenv("NLA_CHINOOK_" + spec.suffix + "_PASSWORD")
			request.SQL = spec.sql
			if spec.engine == "MYSQL" {
				adminConnection := request.Connection
				adminConnection.Username = "root"
				adminConnection.Password = os.Getenv("NLA_MYSQL_ADMIN_PASSWORD")
				admin, err := OpenSource(context.Background(), spec.engine, adminConnection)
				if err != nil {
					t.Fatal("MySQL type fixture admin unavailable")
				}
				defer admin.Close()
				fixture := "nla_runtime_types_" + strconv.FormatInt(time.Now().UnixNano(), 10)
				if _, err := admin.database.Exec("CREATE TABLE " + fixture + " (enabled BIT(1))"); err != nil {
					t.Fatal("type fixture creation failed")
				}
				defer admin.database.Exec("DROP TABLE " + fixture)
				if _, err := admin.database.Exec("INSERT INTO " + fixture + " VALUES (b'1')"); err != nil {
					t.Fatal("type fixture insert failed")
				}
				request.SQL = strings.ReplaceAll(spec.sql, "b'1'", "(SELECT enabled FROM "+fixture+")")
			}
			request.TimeoutMs = 5000
			manager := NewPoolManager(2, time.Minute)
			defer manager.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			source, release, err := manager.Acquire(ctx, request)
			if err != nil {
				t.Fatal("native source connection failed", strings.ReplaceAll(err.Error(), request.Connection.Password, "[redacted]"))
			}
			defer release()
			result, err := source.Query(ctx, request)
			if err != nil {
				t.Fatal("typed query failed", err)
			}
			row := result.Rows[0]
			if row["large_id"] != "9007199254740993" || row["amount"] != "1234.5000" || row["enabled"] != true || row["empty_value"] != nil || row["moment"] != "2026-10-20T05:34:56Z" || row["day"] != "2026-10-20" {
				t.Fatalf("typed values differ: %#v", row)
			}
			slow, stop := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer stop()
			request.SQL = spec.slow
			request.TimeoutMs = 100
			started := time.Now()
			if _, err := source.Query(slow, request); err == nil || time.Since(started) > 3*time.Second {
				t.Fatal("native query was not canceled")
			}
			request.SQL = "SELECT 1 AS healthy"
			if _, err := source.Query(ctx, request); err != nil {
				t.Fatal("pool did not recover after cancellation")
			}
		})
	}
}
