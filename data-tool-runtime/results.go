// Copyright 2024-2025 Google LLC
// SPDX-License-Identifier: Apache-2.0
// Adapted from postgres/mysql/mssql RunSQL and mysqlcommon.ConvertToType.
// Changes preserve the app's lossless BIGINT/DECIMAL strings and typed results.
package main

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

type Column struct {
	Name         string `json:"name"`
	Label        string `json:"label"`
	DataType     string `json:"dataType"`
	SemanticRole string `json:"semanticRole"`
}

type Result struct {
	Columns          []Column         `json:"columns"`
	Rows             []map[string]any `json:"rows"`
	ReturnedRowCount int              `json:"returnedRowCount"`
	Page             int              `json:"page"`
	PageSize         int              `json:"pageSize"`
	Truncated        bool             `json:"truncated"`
}

func NewColumn(label string, nativeType string) Column {
	typeName := strings.ToUpper(strings.TrimPrefix(nativeType, "UNSIGNED "))
	canonical := "STRING"
	switch typeName {
	case "INT2", "INT4", "SMALLINT", "TINYINT", "MEDIUMINT", "INT", "INTEGER":
		canonical = "INTEGER"
	case "INT8", "BIGINT":
		canonical = "BIGINT"
	case "NUMERIC", "DECIMAL", "MONEY", "SMALLMONEY":
		canonical = "DECIMAL"
	case "FLOAT4", "FLOAT8", "FLOAT", "DOUBLE", "REAL":
		canonical = "FLOAT"
	case "BOOL", "BOOLEAN", "BIT":
		canonical = "BOOLEAN"
	case "DATE":
		canonical = "DATE"
	case "TIMESTAMP", "TIMESTAMPTZ", "DATETIME", "DATETIME2", "SMALLDATETIME", "DATETIMEOFFSET":
		canonical = "TIMESTAMP"
	}
	role := "DIMENSION"
	if canonical == "INTEGER" || canonical == "BIGINT" || canonical == "DECIMAL" || canonical == "FLOAT" {
		role = "METRIC"
	} else if canonical == "DATE" || canonical == "TIMESTAMP" {
		role = "TIME"
	}
	return Column{Name: label, Label: label, DataType: canonical, SemanticRole: role}
}

func canonicalValue(value any, dataType string) (any, error) {
	if value == nil {
		return nil, nil
	}
	if valuer, ok := value.(driver.Valuer); ok {
		var err error
		value, err = valuer.Value()
		if err != nil || value == nil {
			return value, err
		}
	}
	if timestamp, ok := value.(time.Time); ok {
		if dataType == "DATE" {
			return timestamp.Format("2006-01-02"), nil
		}
		return timestamp.UTC().Format(time.RFC3339Nano), nil
	}
	if bytes, ok := value.([]byte); ok {
		if dataType == "BOOLEAN" {
			if len(bytes) == 1 && (bytes[0] == 0 || bytes[0] == 1) {
				return bytes[0] == 1, nil
			}
		}
		value = string(bytes)
	}
	switch dataType {
	case "BIGINT", "DECIMAL":
		return fmt.Sprint(value), nil
	case "INTEGER":
		return strconv.ParseInt(fmt.Sprint(value), 10, 64)
	case "FLOAT":
		number, err := strconv.ParseFloat(fmt.Sprint(value), 64)
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
			return nil, errors.New("nonfinite numeric result")
		}
		return number, nil
	case "BOOLEAN":
		if boolean, ok := value.(bool); ok {
			return boolean, nil
		}
		return strconv.ParseBool(fmt.Sprint(value))
	default:
		return fmt.Sprint(value), nil
	}
}

// CollectRows is shared by all native cursors. It counts actual UTF-8 row JSON,
// normalizes duplicate labels and never returns a partial row or result on error.
func CollectRows(columns []Column, next func() bool, values func() ([]any, error), rowsErr func() error, request QueryRequest) (Result, error) {
	result := Result{Columns: columns, Rows: []map[string]any{}, Page: 1, PageSize: 20}
	if len(columns) == 0 || len(columns) > 1000 {
		return Result{}, errors.New("column limit exceeded")
	}
	used := make(map[string]bool)
	for index := range columns {
		label := columns[index].Name
		name := label
		for suffix := 2; used[name]; suffix++ {
			name = label + "_" + strconv.Itoa(suffix)
		}
		columns[index].Name = name
		used[name] = true
	}
	encodedColumns, err := json.Marshal(columns)
	if err != nil || len(encodedColumns) > 131072 {
		return Result{}, errors.New("column metadata limit exceeded")
	}
	bytes := 0
	for next() {
		if len(result.Rows) == request.MaxRows {
			result.Truncated = true
			break
		}
		raw, err := values()
		if err != nil {
			return Result{}, err
		}
		row := make(map[string]any, len(columns))
		for index, column := range columns {
			row[column.Name], err = canonicalValue(raw[index], column.DataType)
			if err != nil {
				return Result{}, err
			}
		}
		encoded, err := json.Marshal(row)
		if err != nil {
			return Result{}, err
		}
		if bytes+len(encoded) > request.MaxBytes {
			result.Truncated = true
			break
		}
		bytes += len(encoded)
		result.Rows = append(result.Rows, row)
	}
	if err := rowsErr(); err != nil {
		return Result{}, err
	}
	result.ReturnedRowCount = len(result.Rows)
	result.PageSize = min(100, max(20, len(result.Rows)))
	return result, nil
}
