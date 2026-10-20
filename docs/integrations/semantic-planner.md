# Native semantic planner runtime reuse

## Runtime path

The Python service exposes authenticated `POST /internal/v1/semantic-plan`. `QueryService` invokes it on the candidate SQL and the current authorized `CatalogService.context`, then runs Java `SqlGuard` over the rewritten SQL and compares the planner's physical source lineage before execution. The planner never connects to warehouses or executes SQL. Its manifest contains only physical table/column metadata and discovered in-dataset foreign keys; it does not yet compile configured metric expressions into Wren measures. The scope and exact payload are in the [private semantic-planner contract](../contracts/semantic-planner.md).

## Adopted source and changes

| Source file / artifact | Snapshot source SHA-256 | Runtime copy / pin | Adaptation |
|---|---|---|---|
| Wren `wren/src/wren/mdl/cte_rewriter.py` | `ca2ae7482b16cf54ad6f2b6798f09d95bae540431d07a2944ff208375fdcce01` | `ai-service/third_party/wren_semantic/cte_rewriter.py` | Kept upstream rewrite/column resolution; changed Wren package imports to local neutral module, added source attribution; invoked with `fallback=False`. |
| Wren `wren/src/wren/mdl/wren_dialect.py` | `96e0834c1d6a5ecdcc66580abe8d710f4431f835ba0e5f1d42534ca77f9b6f27` | `ai-service/third_party/wren_semantic/wren_dialect.py` (same SHA) | Retained upstream dialect implementation. |
| Wren `wren-core-py` native bindings | source file `wren-core-py/src/extractor.rs`: `c3d3358435f0c56239f326e7a16e19c7bd132ae20fb0b426fe406e15e38c7b15` | `wren-core-py==0.4.0` | Calls native `ManifestExtractor`, `SessionContext.transform_sql`, and exposes planner source; no local Rust reimplementation. |
| SQLGlot | Wren `uv.lock` pins 29.0.1 | `sqlglot==29.0.1` | Same pinned AST parser/rewriter version as the adopted source. |
| Wren `wren/src/wren/mdl/__init__.py` | `d60f1c97ace46ace99db0a54c2b3627928915b73229bec172dab51a631ef7042` | `ai-service/third_party/wren_semantic/session_context.py` | Adapted cached native factory;8-entry bound,64KiB manifest cache eligibility, synchronized creation/per-session lease, no cached query or result. |
| Wren root LICENSE | `3da122eeaedca9b81aa873d2cb090c66eeaa1594e776efab631fbf0d1cebfeed` | `ai-service/third_party/wren_semantic/LICENSE` | Retained with adapted source; Apache attribution remains in module header and this record. |

Product-owned `ai-service/semantic_planner.py` validates the manifest, normalizes the three allowed application dialects, maps JDBC scalar types, binds every physical source to a generated logical model alias, invokes the real native planner, and returns rewritten SQL with lineage. `SemanticPlannerClient` builds the manifest only from the Java-authorized catalog context, validates the response, and fails closed on planner/unavailable errors. Java's existing AST guard remains authoritative after rewrite.

## Verification and boundaries

- Python tests cover native planning for PostgreSQL, MySQL, SQL Server, a declared join, unknown physical table rejection, dialect mismatch, strict unknown fields, internal service authentication/correlation, and response lineage.
- Java tests cover server-built authorized manifests, omission of relationships outside the dataset and Java guard acceptance of rewritten physical SQL.
- The AI image builds on `linux/amd64`; PyPI wheel metadata has no Linux arm64 wheel for this native package. Compose must explicitly run that service on amd64 (emulation is possible on arm hosts and may be slower).
- Actual container API smoke uses the native SQL Server rewrite and confirms HTTP 200/source lineage. It is not a database execution or semantic-result equivalence test.
- Provider smoke is unrelated and remains NOT RUN without user-configured provider credentials. Metric/model semantic compilation, broader window/CTE/dialect compatibility, native metric compilation and native amd64 production resource/load behavior remain INCOMPLETE. Live query result equivalence on DB3 is recorded in the integration work log.

### Bounded native session reuse

The supplied SDK factory uses an unbounded `@cache`. The adapted factory retains at most8 native sessions for manifests up to65,536 UTF-8 bytes (base64 form); larger inputs bypass retention. Full manifest plus data source forms the key, so metadata/allowlist changes cannot reuse a different catalog. Creation is serialized to avoid duplicate initialization on concurrent misses and each context has a lease lock. Rewriters and SQL ASTs remain request-local. Native manifests contain metadata only. This optimization does not cache provider calls or answers and does not assert a production memory/latency benchmark.

New tests execute actual native rewrites: repeated different queries reuse one session; changed authorized metadata gets a new session; concurrent SQLServer rewrites preserve independent aliases/lineage; large manifests do not remain in cache. The native service continues to require private auth and Java independent validation.
