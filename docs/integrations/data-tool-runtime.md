# Private native data runtime

The application reuses actual PostgreSQL/MySQL/SQL Server native source
implementations from the supplied database-tools snapshot. See
[data-tool-runtime/NOTICE.md](../../data-tool-runtime/NOTICE.md),
[provenance hashes](data-tool-runtime-provenance.json) and the
[private contract](../contracts/data-tool-runtime.md). The small Go module builds
only three native driver closures rather than importing the upstream cloud-wide
server. Go dependencies are pinned by go.mod/go.sum and Docker images by digest.

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

This is reuse of the listed native execution and pool code, not a claim that all
upstream MCP tools, connectors, auth providers or deployment targets are present.
