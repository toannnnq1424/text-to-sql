# Private native data runtime

The application reuses actual PostgreSQL/MySQL/SQL Server native source
implementations from the supplied database-tools snapshot. See
[data-tool-runtime/NOTICE.md](../../data-tool-runtime/NOTICE.md),
[provenance hashes](data-tool-runtime-provenance.json) and the
[private contract](../contracts/data-tool-runtime.md). The supplied source is fully present under `vendor/upstream/data-tool-platform`.
The private Go module uses a local `replace` and directly calls the actual
PostgreSQL/MySQL/SQL Server `Config.Initialize` factories. It builds their dependency
closure, including common telemetry/auth libraries with noop tracing; the upstream
MCP/HTTP tool server and arbitrary execution tools are not started. Go dependencies are pinned by go.mod/go.sum and Docker images by digest.

Compose starts the native executor by default and Java delegates approved query
execution to it. The executor shares a dedicated private network with Java and a
database network with the registered local engines. AI and file parsers receive
neither its token nor database credentials. It receives reader settings privately
per request, so adding a registered database does not require a new data folder.
The host launcher filters worker secrets out of AI/frontend environments.

`python3 infra/local/compose.py up` builds/starts all application workers, including
native data runtime and file-service. `configure` generates distinct random
service tokens in ignored0600 files under `.local/compose-app/`; the files are not
prerequisites supplied by a developer's machine. The backend upload volume is
owned by UID10001 and persisted separately from database and application images.
The Python semantic engine currently requires Linux x86_64; Compose declares
amd64 explicitly, so ARM hosts require Docker's x86_64 emulation support.

Checks:

```sh
cd data-tool-runtime
go test -race ./...
```

Native DB integration additionally sets `NLA_RUNTIME_INTEGRATION=true`, the
provisioned local reader passwords, MySQL admin password for one disposable BIT
fixture, and `DATA_TOOL_MYSQL_PUBLIC_KEY`. These variables are test-only; the
runtime container has no administrative credentials. The live test creates and
cleans exactly one uniquely named MySQL type fixture. Tests cover actual typed
DB3 results, cancellation/recovery, pool reuse/rotation/active leases/eviction,
authentication, host deny, UTF-8 and row bounds. Java client/guard tests cover
transport bounds, failure/timeout mapping and no executor call before SqlGuard.

Full source is present. Only the listed native factories and their guarded app
callers are active. Other tools/connectors/auth providers/deployments have not
been enabled or verified merely by importing their source. Exact current source
and the SQL Server connection patch are recorded in the
[full source adoption](full-source-adoption.md) and patch manifest.
