# Java → private native warehouse runtime

Java remains the decision maker: resource authorization, authorized catalog,
semantic planning, SQL AST validation and dialect-safe limit happen before any
native runtime request. React and Python AI cannot call this service. Discovery
continues through JDBC/native metadata, while query execution uses the extracted
native pools when `DATA_TOOL_RUNTIME_URL` is configured. Configured runtime errors
never fall back to JDBC. Host-only Quick Start can still explicitly use the JDBC
execution path by leaving that private endpoint unconfigured.

`POST /internal/v1/query`, `Authorization: Bearer DATA_TOOL_RUNTIME_TOKEN`:

```json
{
  "correlationId": "request-id",
  "warehouseId": "registered-warehouse-id",
  "engine": "POSTGRESQL",
  "connection": {
    "host": "registered-host",
    "port": 5432,
    "database": "registered-database",
    "username": "reader",
    "password": "resolved-only-inside-trusted-services",
    "tls": true
  },
  "sql": "SELECT COUNT(*) AS record_count FROM approved_table",
  "maxRows": 1000,
  "maxBytes": 5242880,
  "timeoutMs": 15000
}
```

- Engines exactly `POSTGRESQL`, `MYSQL`, `SQL_SERVER`; endpoint uses registered
  warehouse settings, with the same explicit host allowlist enforced twice.
- Connection is a private transport field, never a public API, persisted result,
  AI prompt, log or error body. Only the server's resolved reader credential is
  sent. SQL Import/pipeline writer credentials remain in Java and are not sent.
- Success uses the existing QueryResult object from [domain.md](domain.md):
  `columns`, object-valued `rows`, `returnedRowCount`, `page`, `pageSize`,
  `truncated`. BIGINT and DECIMAL remain strings; BOOLEAN remains boolean; DATE
  uses ISO date and TIMESTAMP uses UTC. Duplicate labels have stable suffixes.
- Limits: 128KiB input, SQL100000 bytes,10000 rows,10MiB row JSON,1000 columns,
  128KiB column metadata, timeout100–120000ms. Caller can select smaller bounds.
- Private errors expose only `{ "code": "..." }` with401 UNAUTHENTICATED,
  400 INVALID_REQUEST,503 RUNTIME_BUSY,504 QUERY_TIMEOUT,502 QUERY_ERROR.
  Java maps timeout to existing QUERY_TIMEOUT, all other failures to QUERY_ERROR.
  Driver text, connection fields and SQL text do not appear in errors.
- Native source pool fingerprint includes warehouse ID, engine, endpoint, TLS,
  username and credential. Rotation cannot reuse old credentials. Maximum32
  cached sources,4 connections/source,8 concurrent requests; active sources are
  leased and cannot be evicted. Idle source TTL5minutes, idle connection1minute,
  connection lifetime15minutes. Cancellation flows through native drivers and
  transaction rollback. PG/MySQL use read-only transactions; SQL Server uses the
  registered restricted reader plus Java AST policy (driver has no read-only
  transaction mode).
- `GET /internal/v1/health` requires the same service token. No host port, public
  MCP endpoint, generic agent execution tool or SQL logging is enabled.
