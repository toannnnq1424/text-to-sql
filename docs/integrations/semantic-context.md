# Semantic context index and provider payload

## Reused behavior

The AI service now uses a dependency-free, content-keyed schema index in its actual API generation path. `ai-service/context_index.py` adapts the useful shape of Wren Engine's schema description and indexing approach: canonical semantic-context snapshots feed cached per-table, metric, dimension, and example term sets; the selector uses those indexes to retrieve the relevant definitions without making another model/API request. The selector retains full qualified table identity, logical name, physical name, description, grain, every column and its nullable state, metric expressions and references, dimension synonyms, all business rules, and the declared shortest join paths between required tables. If the selected complete context cannot fit, it returns `INSUFFICIENT_CONTEXT` instead of truncating an object or relationship.

The provider payload is serialized once and that exact UTF-8 body is sent over HTTP. `LLM_REQUEST_MAX_BYTES` limits the complete request body, including model name, system message, response schema, user message, and JSON/context overhead. HTTP headers and the provider response are outside this request-body limit. The default is 48,000 bytes. Only examples for the requested SQL dialect enter the provider payload. Retrieval runs on every provider request, including when a full snapshot would fit; this avoids routinely sending the entire authorized catalog. It selects at most five dialect-matched examples, retains SQL-referenced tables and declared join paths, and fails closed if the complete selected context exceeds the byte bound. Retrieved metadata strings remain untrusted prompt data.

## Measured result

Two distinct measurements are recorded. The production-selector comparison serializes the prior same-dialect top-eight example context and the current selected context for the same under-budget snapshots. For Chinook, the exact request body fell from **12,438 to 5,177 bytes** (**58.38%**); for synthetic support, from **10,428 to 6,429 bytes** (**38.35%**). `test_provider_boundary_compacts_same_snapshot_without_losing_join_context` separately tests a stress snapshot containing 40 unrelated archival tables with 30 columns apiece, plus three required tables and a two-edge join path: the unselected full body is **240,412 bytes** and the captured selected HTTP body is **22,894 bytes** (**90.47%** smaller). The stress ratio is not presented as an ordinary before/after production-call saving. These are mocked request-size measurements, not token billing, provider latency, answer quality, or Java execution. No additional paid/API call is made for indexing or selection.

The cache key is the canonical serialized structural semantic context, so a schema, semantic version, rule, or metadata change creates a separate index. Only the transient `referenceTime` is excluded from that key, and the current value is overlaid on every outgoing request. The bounded LRU holds at most 32 snapshots. Index data is derived in process and contains no connection credentials or row values; strict input models reject unrecognized credential-bearing fields before the provider path.

## Source attribution and license

Reviewed the locally supplied Wren Engine source archive at `/Users/toanlamsaoduocc/Downloads/wren-engine-main`. That archive had no `.git` metadata, so a source revision cannot be established from the local copy. Wren Engine is Copyright 2024 Canner, Inc. and is distributed under Apache License 2.0; the unmodified license text is retained at [`ai-service/third-party/licenses/WREN-APACHE-2.0.txt`](../../ai-service/third-party/licenses/WREN-APACHE-2.0.txt).

The adapted approach is limited to schema description, deterministic indexing, and caching; this service does not import Wren's embedding/vector-store dependencies, model downloads, query planner, or product-specific manifest. SHA-256 values below identify the inspected source files from the supplied local snapshot:

| Source file | SHA-256 |
|---|---|
| `wren/src/wren/memory/schema_indexer.py` | `95c14466966fc38b58fa0185f233ff87c7900afa2c02765591f383cf91d5ca72` |
| `wren/src/wren/memory/store.py` | `b3fcec6561ebeb802d5ca50fc23778de94e55fb856fa9269af37a28c4f9e2858` |
| `mcp-server/app/wren.py` | `2f4f2ae2bd9339b8daedd727f1a2fbd7b6181a95bcadc0d8d6e7d26576e1a610` |

`store.py` and `mcp-server/app/wren.py` were inspected for their retrieval/cache boundaries; their implementations were not copied. The runtime remains API-provider based. Local embeddings are not downloaded or substituted, and a real provider call remains unverified until a valid provider configuration is supplied.
