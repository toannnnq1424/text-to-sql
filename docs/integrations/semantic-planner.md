# Native semantic planner runtime reuse

## Runtime path

The Python service exposes authenticated `POST /internal/v1/semantic-plan`. `QueryService` invokes it on the candidate SQL and the current authorized `CatalogService.context`, then runs Java `SqlGuard` over the rewritten SQL and compares the planner's physical source lineage before execution. The planner never connects to warehouses or executes SQL. Its manifest contains only physical table/column metadata and discovered in-dataset foreign keys; it does not yet compile configured metric expressions into Wren measures. The scope and exact payload are in the [private semantic-planner contract](../contracts/semantic-planner.md).

## Adopted source and changes

| Source / artifact | Runtime consumer | Integration |
|---|---|---|
| `vendor/upstream/semantic-engine/wren` | `WrenEngine.plan_for_dataset` from the app adapter → SDK `dry_plan` | SDK installed from repository source; strict_mode=True, fallback=False, leased native context override. SDK manifest extraction, policy and CTE/dialect implementation run directly. |
| SDK `wren/mdl/get_session_context` | `third_party/wren_semantic/session_context.py` | Calls the actual factory without its unbounded decorator; finite application cache and serialized leases remain. |
| SDK `wren/type_mapping.py::parse_type` | Manifest type normalization | Parameterized physical types use the SDK parser; unknown types fail closed. |
| `wren-core-py==0.4.0` | SDK native planner | Pinned compiled wheel; Rust source is included but is not rebuilt locally for the image. |
| `sqlglot==29.0.1` | SDK and app AST/lineage checks | Pinned compatible dependency. |
| Root upstream LICENSE | Vendored source and AI image license directory | Apache-2.0 notices retained. |

The previous small `third_party/wren_semantic/cte_rewriter.py` and `wren_dialect.py` copies are removed. The full source now owns those imports. Exact baseline source hashes and the SDK engine patch hash are in the [full inventory](full-source-inventory.json) and [patch manifest](full-source-patches.json); [adoption map](full-source-adoption.md) distinguishes source presence from active runtime capabilities.

The project-specific fork in `wren/src/wren/nla_planning.py`, called through the modified `WrenEngine.plan_for_dataset`, owns physical identifier binding, type normalization, native resolution and post-rewrite physical-lineage equality. It rejects writable nested queries and ambiguous physical identifiers; the engine planning-only flag blocks connector creation. Product-owned `ai-service/semantic_planner.py` now handles strict DTOs and maps this result to the existing private contract, without keeping a duplicate planner. `SemanticPlannerClient` builds the manifest only from the Java-authorized catalog context, validates the response, and fails closed on planner/unavailable errors. Java's existing AST guard remains authoritative after rewrite.

## Verification and boundaries

- Python tests cover native planning for PostgreSQL, MySQL, SQL Server, a declared join, unknown physical table rejection, dialect mismatch, strict unknown fields, internal service authentication/correlation, and response lineage.
- Java tests cover server-built authorized manifests, omission of relationships outside the dataset and Java guard acceptance of rewritten physical SQL.
- The AI image builds on `linux/amd64`; PyPI wheel metadata has no Linux arm64 wheel for this native package. Compose must explicitly run that service on amd64 (emulation is possible on arm hosts and may be slower).
- Packaged query API and browser checks execute on all three databases. Chinook144cases and cross-domain108cases check actual result equivalence through the source fork and native executor. They use deterministic semantic examples, not a real LLM provider.
- Provider smoke is unrelated and remains NOT RUN without user-configured provider credentials. Native metric/model measure compilation, broader window/CTE/dialect compatibility and native amd64 production resource/load behavior remain INCOMPLETE. Live query result equivalence on DB3 is recorded in the integration work log.

### Bounded native session reuse

The supplied SDK factory uses an unbounded `@cache`. The application lease wrapper around the actual SDK factory retains at most8 native sessions for manifests up to65,536 UTF-8 bytes (base64 form); larger inputs bypass retention. Full manifest plus data source forms the key, so metadata/allowlist changes cannot reuse a different catalog. Creation is serialized to avoid duplicate initialization on concurrent misses and each context has a lease lock. Rewriters and SQL ASTs remain request-local. Native manifests contain metadata only. This optimization does not cache provider calls or answers and does not assert a production memory/latency benchmark.

New tests execute actual native rewrites: repeated different queries reuse one session; changed authorized metadata gets a new session; concurrent SQLServer rewrites preserve independent aliases/lineage; large manifests do not remain in cache. The native service continues to require private auth and Java independent validation.


### Native identity compaction

The source fork now qualifies physical columns before model binding and calls `nla_compaction.py` after the real native dry-plan/rewrite. This removes generated `nla_model_*` identity CTEs and nested full-column projections from simple counts and other supported queries. It does not short-circuit the native engine or replace the native result with the original candidate. SQLGlot29.0.1 `merge_subqueries` is reused within verified identity bodies; only direct physical identities are inlined into their callers. Caller CTEs and nonidentity operations remain intact, and physical lineage is checked on both the native and compacted statements.

The added compaction suite executes native plans for all three dialects against an independent in-memory DuckDB fixture and compares rows, column types and labels with the original SQL. It covers null-sensitive counts, distinct, exact decimal sums, filters, grouped limits, meaningful CTEs, self joins, dates, windows and star projection order. These are local semantic regression checks; actual PostgreSQL/MySQL/SQL Server caller checks are recorded separately in the work log. The updated planner and compaction source hashes are in the full-source patch manifest; the original snapshot inventory is unchanged.
