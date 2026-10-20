// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Adapted for the application's private Java-approved read-only query executor.
// Actual upstream source factories are called below; Java owns user authorization.
package main

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"database/sql"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	mysql "github.com/go-sql-driver/mysql"
	upstreamMSSQL "github.com/googleapis/mcp-toolbox/internal/sources/mssql"
	upstreamMySQL "github.com/googleapis/mcp-toolbox/internal/sources/mysql"
	upstreamPg "github.com/googleapis/mcp-toolbox/internal/sources/postgres"
	upstreamUtil "github.com/googleapis/mcp-toolbox/internal/util"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/microsoft/go-mssqldb"
	"go.opentelemetry.io/otel/trace/noop"
)

type Connection struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
	TLS      bool   `json:"tls"`
}

type Source struct {
	engine   string
	postgres *pgxpool.Pool
	database *sql.DB
}

// BuildPostgresURL delegates to the upstream PostgreSQL source. URL encoding
// prevents credentials or database names from being interpreted as DSN options.
func BuildPostgresURL(connection Connection) string {
	sslMode := "disable"
	if connection.TLS {
		sslMode = "verify-full"
	}
	return upstreamPg.BuildPostgresURL(
		connection.Host,
		strconv.Itoa(connection.Port),
		connection.Username,
		connection.Password,
		connection.Database,
		map[string]string{
			"application_name": "nla-data-runtime",
			"sslmode":          sslMode,
		},
	)
}

// OpenSource calls the actual vendored upstream source implementations.
// The application still owns host/auth guards, read-only queries and result bounds.
func OpenSource(ctx context.Context, engine string, connection Connection) (*Source, error) {
	source := &Source{engine: engine}
	ctx = upstreamUtil.WithUserAgent(ctx, "nla-data-runtime")
	tracer := noop.NewTracerProvider().Tracer("nla-data-runtime")
	switch engine {
	case "POSTGRESQL":
		sslMode := "disable"
		if connection.TLS {
			sslMode = "verify-full"
		}
		timeout := 5
		enabled := false
		config := upstreamPg.Config{
			Name:           "nla-data-runtime",
			Type:           "postgres",
			Host:           connection.Host,
			Port:           strconv.Itoa(connection.Port),
			User:           connection.Username,
			Password:       connection.Password,
			Database:       connection.Database,
			ConnectTimeout: &timeout,
			QueryExecMode:  "exec",
			SQLCommenter:   &enabled,
			QueryParams: map[string]string{
				"sslmode":                 sslMode,
				"application_name":        "nla-data-runtime",
				"pool_max_conns":          "4",
				"pool_min_conns":          "0",
				"pool_max_conn_idle_time": "1m",
				"pool_max_conn_lifetime":  "15m",
			},
		}
		native, err := config.Initialize(ctx, tracer)
		if err != nil {
			return nil, err
		}
		source.postgres = native.(*upstreamPg.Source).PostgresPool()
		if err := source.postgres.Ping(ctx); err != nil {
			source.Close()
			return nil, err
		}
	case "MYSQL":
		params := map[string]string{
			"parseTime":       "true",
			"loc":             "UTC",
			"time_zone":       "'+00:00'",
			"timeout":         "5s",
			"writeTimeout":    "5s",
			"multiStatements": "false",
		}
		if connection.TLS {
			params["tls"] = "true"
		}
		if os.Getenv("DATA_TOOL_MYSQL_PUBLIC_KEY") != "" && !connection.TLS {
			params["serverPubKey"] = "nla-runtime"
		}
		enabled := false
		config := upstreamMySQL.Config{
			Name:         "nla-data-runtime",
			Type:         "mysql",
			Host:         connection.Host,
			Port:         strconv.Itoa(connection.Port),
			User:         connection.Username,
			Password:     connection.Password,
			Database:     connection.Database,
			QueryTimeout: "125s",
			QueryParams:  params,
			SQLCommenter: &enabled,
		}
		native, err := config.Initialize(ctx, tracer)
		if err != nil {
			return nil, err
		}
		source.database = native.(*upstreamMySQL.Source).MySQLPool()
	case "SQL_SERVER":
		encrypt := "disable"
		if connection.TLS {
			encrypt = "true"
		}
		config := upstreamMSSQL.Config{
			Name:           "nla-data-runtime",
			Type:           "mssql",
			Host:           connection.Host,
			Port:           strconv.Itoa(connection.Port),
			User:           connection.Username,
			Password:       connection.Password,
			Database:       connection.Database,
			Encrypt:        encrypt,
			ConnectTimeout: 5,
		}
		native, err := config.Initialize(ctx, tracer)
		if err != nil {
			return nil, err
		}
		source.database = native.(*upstreamMSSQL.Source).Db
	default:
		return nil, errors.New("unsupported engine")
	}
	if source.database != nil {
		source.database.SetMaxOpenConns(4)
		source.database.SetMaxIdleConns(2)
		source.database.SetConnMaxIdleTime(time.Minute)
		source.database.SetConnMaxLifetime(15 * time.Minute)
		if err := source.database.PingContext(ctx); err != nil {
			source.Close()
			return nil, err
		}
	}
	return source, nil
}

func RegisterMySQLPublicKey(path string) error {
	if path == "" {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return errors.New("MySQL public key unavailable")
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return errors.New("invalid MySQL public key")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return errors.New("invalid MySQL public key")
	}
	key, ok := parsed.(*rsa.PublicKey)
	if !ok {
		return errors.New("invalid MySQL public key")
	}
	mysql.RegisterServerPubKey("nla-runtime", key)
	return nil
}

func (source *Source) Close() {
	if source.postgres != nil {
		source.postgres.Close()
	}
	if source.database != nil {
		_ = source.database.Close()
	}
}

// Query preserves upstream native cursor scanning and cancellation. Every result
// cursor is closed and every transaction is rolled back, including truncation.
func (source *Source) Query(ctx context.Context, request QueryRequest) (Result, error) {
	if source.postgres != nil {
		transaction, err := source.postgres.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
		if err != nil {
			return Result{}, err
		}
		defer transaction.Rollback(context.Background())
		_, err = transaction.Exec(ctx, fmt.Sprintf("SET LOCAL statement_timeout = %d", request.TimeoutMs))
		if err != nil {
			return Result{}, err
		}
		rows, err := transaction.Query(ctx, request.SQL)
		if err != nil {
			return Result{}, err
		}
		defer rows.Close()
		fields := rows.FieldDescriptions()
		columns := make([]Column, len(fields))
		for index, field := range fields {
			typeName := ""
			if nativeType, exists := transaction.Conn().TypeMap().TypeForOID(field.DataTypeOID); exists {
				typeName = nativeType.Name
			}
			columns[index] = NewColumn(field.Name, typeName)
		}
		return CollectRows(columns, rows.Next, rows.Values, rows.Err, request)
	}
	options := &sql.TxOptions{ReadOnly: source.engine == "MYSQL"}
	transaction, err := source.database.BeginTx(ctx, options)
	if err != nil {
		return Result{}, err
	}
	defer transaction.Rollback()
	rows, err := transaction.QueryContext(ctx, request.SQL)
	if err != nil {
		return Result{}, err
	}
	defer rows.Close()
	names, err := rows.Columns()
	if err != nil {
		return Result{}, err
	}
	types, err := rows.ColumnTypes()
	if err != nil {
		return Result{}, err
	}
	columns := make([]Column, len(names))
	for index, name := range names {
		columns[index] = NewColumn(name, types[index].DatabaseTypeName())
	}
	values := func() ([]any, error) {
		raw := make([]any, len(names))
		scan := make([]any, len(names))
		for index := range raw {
			scan[index] = &raw[index]
		}
		if err := rows.Scan(scan...); err != nil {
			return nil, err
		}
		return raw, nil
	}
	return CollectRows(columns, rows.Next, values, rows.Err, request)
}
