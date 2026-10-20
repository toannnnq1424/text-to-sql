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
// Cloud auth, tool registration and SQL logging are deliberately excluded.
package main

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"database/sql"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"time"

	mysql "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/microsoft/go-mssqldb"
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

// BuildPostgresURL is adapted from the upstream PostgreSQL source. URL encoding
// prevents credentials or database names from being interpreted as DSN options.
func BuildPostgresURL(connection Connection) string {
	options := url.Values{}
	options.Set("application_name", "nla-data-runtime")
	options.Set("sslmode", "disable")
	if connection.TLS {
		options.Set("sslmode", "verify-full")
	}
	location := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(connection.Username, connection.Password),
		Host:     net.JoinHostPort(connection.Host, strconv.Itoa(connection.Port)),
		Path:     connection.Database,
		RawQuery: options.Encode(),
	}
	return location.String()
}

// OpenSource retains the native pgx/database/sql pool constructors from the three
// upstream source implementations, with bounded lifetimes and no IAM/cloud deps.
func OpenSource(ctx context.Context, engine string, connection Connection) (*Source, error) {
	source := &Source{engine: engine}
	switch engine {
	case "POSTGRESQL":
		config, err := pgxpool.ParseConfig(BuildPostgresURL(connection))
		if err != nil {
			return nil, err
		}
		config.MaxConns = 4
		config.MinConns = 0
		config.MaxConnIdleTime = time.Minute
		config.MaxConnLifetime = 15 * time.Minute
		config.ConnConfig.ConnectTimeout = 5 * time.Second
		// Avoid retaining statement text and schema-specific prepared plans.
		config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
		source.postgres, err = pgxpool.NewWithConfig(ctx, config)
		if err != nil {
			return nil, err
		}
		if err = source.postgres.Ping(ctx); err != nil {
			source.Close()
			return nil, err
		}
	case "MYSQL":
		config := mysql.NewConfig()
		config.Addr = net.JoinHostPort(connection.Host, strconv.Itoa(connection.Port))
		config.Net = "tcp"
		config.User = connection.Username
		config.Passwd = connection.Password
		config.DBName = connection.Database
		config.ParseTime = true
		config.Params = map[string]string{"time_zone": "'+00:00'"}
		config.Loc = time.UTC
		config.Timeout = 5 * time.Second
		config.ReadTimeout = 125 * time.Second
		config.WriteTimeout = 5 * time.Second
		config.MultiStatements = false
		config.AllowNativePasswords = true
		config.ConnectionAttributes = "program_name:nla-data-runtime"
		if connection.TLS {
			config.TLSConfig = "true"
		}
		if os.Getenv("DATA_TOOL_MYSQL_PUBLIC_KEY") != "" && !connection.TLS {
			config.ServerPubKey = "nla-runtime"
		}
		connector, err := mysql.NewConnector(config)
		if err != nil {
			return nil, err
		}
		source.database = sql.OpenDB(connector)
	case "SQL_SERVER":
		options := url.Values{}
		options.Set("app name", "nla-data-runtime")
		options.Set("database", connection.Database)
		options.Set("connection timeout", "5")
		options.Set("encrypt", "disable")
		if connection.TLS {
			options.Set("encrypt", "true")
		}
		options.Set("TrustServerCertificate", "false")
		location := url.URL{
			Scheme:   "sqlserver",
			User:     url.UserPassword(connection.Username, connection.Password),
			Host:     net.JoinHostPort(connection.Host, strconv.Itoa(connection.Port)),
			RawQuery: options.Encode(),
		}
		var err error
		source.database, err = sql.Open("sqlserver", location.String())
		if err != nil {
			return nil, err
		}
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
