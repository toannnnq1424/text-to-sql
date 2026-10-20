# Source attribution

This private database runtime contains adapted code from the MCP Toolbox for
Databases source snapshot supplied by the user, Copyright 2024–2026 Google LLC,
licensed under Apache License 2.0 (see LICENSE). Product/runtime names use this
project's branding; upstream names here identify provenance only.

Original adaptations retained in the guarded executor:

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

Current source integration: the full snapshot is included in
`vendor/upstream/data-tool-platform`. `go.mod` uses a local module replacement;
`OpenSource` directly invokes the actual PostgreSQL, MySQL and MSSQL
`Config.Initialize` implementations and acquires their native pools. The previous
local DSN/source-initialization copies have been replaced by these calls.
Application-owned bounded pool leases, canonical cursor conversion, private
authentication, host allowlist, read-only transactions, cancellation,
concurrency/time/row/byte limits remain. SQLCommenter is disabled and tracer is
noop; the upstream arbitrary execution-tool server is not exposed.

The MSSQL source has a recorded patch for bounded connection timeout, explicit
certificate verification and IPv6-safe host formatting. Source baseline and
before/after hashes are in `docs/integrations/full-source-inventory.json` and
`full-source-patches.json`. The earlier adapted-file provenance remains in
`data-tool-runtime-provenance.json`. Apache-2.0 LICENSE is retained in both the
full snapshot and this runtime image. Source availability does not assert all
upstream connectors or tools are active in the application.
