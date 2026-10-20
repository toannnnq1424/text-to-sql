# Native metadata descriptions: data tool runtime reuse

Java discovery now consumes adapted native catalog comment queries from the reviewed data tool runtime source. This completes a bounded, live caller path for that source: registered warehouse reader → native table/column descriptions → existing catalog DTO → authorized Java→Python semantic context. The change preserves the public API and does not introduce a new tool server or execution endpoint.

## Source and adaptation

The three source files and exact SHA-256 identifiers are in [native-metadata-provenance.json](native-metadata-provenance.json). They belong to the downloaded snapshot identified by [reviewed-snapshots.json](reviewed-snapshots.json); no Git metadata exists in the downloaded directory, so `main` is not treated as a commit pin.

| Engine | Adapted behavior | Runtime use |
|---|---|---|
| PostgreSQL | `pg_class`/`pg_namespace`, `obj_description`, `pg_attribute`/`col_description` | Native table and column comments, including quoted physical names |
| MySQL | `INFORMATION_SCHEMA.TABLES.TABLE_COMMENT` and `COLUMNS.COLUMN_COMMENT` | Native comments; a view's `VIEW` type marker is not reported as an authored description |
| SQL Server | `sys.objects`/`sys.schemas`/`sys.columns`, `sys.extended_properties` with class1 `MS_Description` | Table and column extended properties missing from JDBC REMARKS |

Adapted SQL lives in `backend/src/main/resources/metadata/`. `NativeMetadataDescriptions` binds the selected schema with `PreparedStatement`; it never interpolates user SQL or names. The upstream JSON aggregation, owner/index/trigger/default payload, Go runtime and arbitrary SQL tools were excluded from this integration.

Apache-2.0 source copyright/license notices remain in the SQL files. The unchanged source license and adaptation notice are included in `third_party/data-tool-runtime/` and `META-INF/licenses/data-tool-runtime/` inside the packaged Java artifact. Product UI retains its own neutral branding; upstream identifiers here provide technical provenance only.

## Runtime behavior and bounds

`JdbcWarehouseAdapter.discoverTables` fetches descriptions once per selected schema and shares that snapshot across all tables/columns in that schema. Existing JDBC discovery still supplies physical identity, types, nullability, primary keys and relationships. The added queries do not multiply by table/column count; standalone `discoverColumns` uses one schema snapshot for its request.

Each added catalog request has a 5-second JDBC timeout, at most 10,000 returned comment rows, a 2MiB UTF-8 comment budget and at most 4,000 characters per description. Overflow raises controlled SQLState `54000`; no unbounded materialization or silent fake description is returned. Unknown/blank comments use the existing bounded JDBC remark or an empty string. Comments are descriptive untrusted data, never instructions, row values, query templates or credential fields.

Permission/connection errors propagate through the existing safe `CatalogService` mapping (`WAREHOUSE_CONNECTION_ERROR`). Logging contains engine/SQLState/vendor code only; no SQL body, native vendor error text, descriptions or credentials. The loader does not request elevated privileges or change grants; reader privileges remain separate from provisioning accounts.

The dataset allowlist is applied by the existing catalog service before physical descriptions enter AI context. `CatalogService.context` already returns those physical table/column objects, so the metadata enriches the same existing `description` fields without a parallel schema/DTO or field added to Python.

## Verification

Run with Java21:

```bash
cd backend
mvn -q -Dtest=NativeMetadataDescriptionsTest,NativeDescriptionContextTest test
```

With the isolated Docker databases provisioned and private environment available:

```bash
python3 infra/local/test_backend.py -Dtest=NativeMetadataLiveTest,NativeMetadataDescriptionsTest,NativeDescriptionContextTest,LiveWarehouseTest
```

`NativeMetadataLiveTest` creates a unique empty fixture table using each engine's isolated provisioning account, adds Unicode native comments, grants the existing reader SELECT and verifies discovery through `nla_reader`. It checks uncommented columns, absent schemas, cleared comments and denied reader writes, then removes the fixture. A SQL Server user created solely for the test receives `DENY SELECT` on the catalog view; the actual permission229 error is verified and the user removed without changing shared reader grants.

The unit suite checks schema binding, case/Unicode preservation, missing comment fallback, row bounds, resource closure, one extra bulk query per schema and safe permission-error/context propagation. The targeted suite and existing live warehouse regression total18 tests PASS on the task host. Database evidence is actual PostgreSQL/MySQL/SQL Server; Python provider/LLM behavior, application image rebuild and browser refresh after final merge are not implied by these tests. Exact branch/commit evidence is in [work log](../work-log.md).
