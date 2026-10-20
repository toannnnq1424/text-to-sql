# Source attribution

This private database runtime contains adapted code from the MCP Toolbox for
Databases source snapshot supplied by the user, Copyright 2024–2026 Google LLC,
licensed under Apache License 2.0 (see LICENSE). Product/runtime names use this
project's branding; upstream names here identify provenance only.

Adapted implementation:

- `internal/sources/postgres/postgres.go`: PostgreSQL URL encoding, pgx pool
  initialization, native query/field/value cursor handling.
- `internal/sources/mysql/mysql.go`: MySQL driver configuration, database/sql
  initialization, native row scanning and column type conversion.
- `internal/sources/mssql/mssql.go`: SQL Server URL configuration, database/sql
  initialization and native result iteration.
- `internal/tools/mysql/mysqlcommon/mysqlcommon.go`: byte/string conversion for
  typed native results, extended for the app's canonical JSON contract.
- `internal/sources/util.go`: native UUID result normalization.
- `internal/sources/cache.go`: synchronized source caching/expiry, extended with
  finite source count, active leases, concurrent initialization and shutdown.

Changes: extracted the three native SQL sources from the cloud-wide dependency
closure; omitted upstream arbitrary execute-tool/UI/SQL debug logging and external
OIDC authentication because Java owns user authorization. Added private service
authentication, explicit host allowlist, read-only transactions, reader credentials,
request cancellation, global concurrency, connection lifetimes, byte/row bounds,
canonical DECIMAL/BIGINT strings and deterministic duplicate-column handling.

Upstream's source names, license and original file hashes are recorded in
`docs/integrations/data-tool-runtime-provenance.json`. This is a maintained adapted
fork of the listed implementation, not a claim that the entire upstream Go server
or its cloud connectors are installed.
