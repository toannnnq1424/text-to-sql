// Private executor for SQL already approved by Java. This service is never exposed
// to a browser, the AI service, or anonymous callers.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgconn"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type QueryRequest struct {
	CorrelationID string     `json:"correlationId"`
	WarehouseID   string     `json:"warehouseId"`
	Engine        string     `json:"engine"`
	Connection    Connection `json:"connection"`
	SQL           string     `json:"sql"`
	MaxRows       int        `json:"maxRows"`
	MaxBytes      int        `json:"maxBytes"`
	TimeoutMs     int        `json:"timeoutMs"`
}

type Executor struct {
	Token         string
	AllowedHosts  map[string]bool
	Pools         *PoolManager
	Slots         chan struct{}
	budgetMutex   sync.Mutex
	reservedBytes int
}

func (executor *Executor) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	if len(executor.Token) < 32 || subtle.ConstantTimeCompare([]byte(request.Header.Get("Authorization")), []byte("Bearer "+executor.Token)) != 1 {
		privateError(writer, http.StatusUnauthorized, "UNAUTHENTICATED")
		return
	}
	if request.Method == "GET" && request.URL.Path == "/internal/v1/health" {
		_, _ = writer.Write([]byte(`{"status":"UP"}`))
		return
	}
	if request.Method != "POST" || request.URL.Path != "/internal/v1/query" {
		privateError(writer, http.StatusNotFound, "NOT_FOUND")
		return
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 131072))
	decoder.DisallowUnknownFields()
	var input QueryRequest
	if err := decoder.Decode(&input); err != nil {
		privateError(writer, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF || !executor.valid(input) {
		privateError(writer, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	select {
	case executor.Slots <- struct{}{}:
		defer func() { <-executor.Slots }()
	default:
		privateError(writer, http.StatusServiceUnavailable, "RUNTIME_BUSY")
		return
	}
	executor.budgetMutex.Lock()
	if executor.reservedBytes+input.MaxBytes > 64*1024*1024 {
		executor.budgetMutex.Unlock()
		privateError(writer, http.StatusServiceUnavailable, "RUNTIME_BUSY")
		return
	}
	executor.reservedBytes += input.MaxBytes
	executor.budgetMutex.Unlock()
	defer func() {
		executor.budgetMutex.Lock()
		executor.reservedBytes -= input.MaxBytes
		executor.budgetMutex.Unlock()
	}()
	ctx, cancel := context.WithTimeout(request.Context(), time.Duration(input.TimeoutMs)*time.Millisecond)
	defer cancel()
	source, release, err := executor.Pools.Acquire(ctx, input)
	if err != nil {
		executionError(writer, ctx, err)
		return
	}
	defer release()
	result, err := source.Query(ctx, input)
	if err != nil {
		executionError(writer, ctx, err)
		return
	}
	if err := ctx.Err(); err != nil {
		executionError(writer, ctx, err)
		return
	}
	_ = json.NewEncoder(writer).Encode(result)
}

func (executor *Executor) valid(input QueryRequest) bool {
	connection := input.Connection
	if input.CorrelationID == "" || len(input.CorrelationID) > 100 || input.WarehouseID == "" || len(input.WarehouseID) > 200 {
		return false
	}
	if input.Engine != "POSTGRESQL" && input.Engine != "MYSQL" && input.Engine != "SQL_SERVER" {
		return false
	}
	if !executor.AllowedHosts[connection.Host] || connection.Port < 1 || connection.Port > 65535 {
		return false
	}
	if connection.Database == "" || len(connection.Database) > 253 || connection.Username == "" || len(connection.Username) > 253 || connection.Password == "" || len(connection.Password) > 4096 {
		return false
	}
	if input.TimeoutMs < 100 || input.TimeoutMs > 120000 || input.MaxRows < 1 || input.MaxRows > 10000 || input.MaxBytes < 1 || input.MaxBytes > 52428800 || len(input.SQL) > 100000 {
		return false
	}
	fields := strings.Fields(input.SQL)
	return len(fields) > 0 && (strings.EqualFold(fields[0], "SELECT") || strings.EqualFold(fields[0], "WITH"))
}

func executionError(writer http.ResponseWriter, ctx context.Context, err error) {
	var postgresError *pgconn.PgError
	postgresTimeout := errors.As(err, &postgresError) && postgresError.Code == "57014"
	if errors.Is(err, ErrBusy) {
		privateError(writer, http.StatusServiceUnavailable, "RUNTIME_BUSY")
	} else if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || postgresTimeout {
		privateError(writer, http.StatusGatewayTimeout, "QUERY_TIMEOUT")
	} else {
		privateError(writer, http.StatusBadGateway, "QUERY_ERROR")
	}
}

func privateError(writer http.ResponseWriter, status int, code string) {
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(map[string]string{"code": code})
}
