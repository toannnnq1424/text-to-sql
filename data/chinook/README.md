# Chinook sample database

Chinook là sample database nhỏ mô phỏng cửa hàng nhạc số. Trong repo này, nó dùng để kiểm thử khả năng kết nối và truy vấn thật của ba SQL dialect. Đây là transactional sample database, không phải data warehouse star schema.

## Nguồn và license

- Upstream: [lerocha/chinook-database](https://github.com/lerocha/chinook-database)
- Release: `v1.4.5`
- Upstream commit: `4a944a942426e1f3263fe539155fb7ef92b04b4a`
- License: [LICENSE.md](LICENSE.md) (MIT)
- Release script và SHA-256: [source.json](source.json)

Các script nguồn giữ trong cache bị ignore. Provisioner chỉ tải đúng asset đã pin, từ chối checksum không khớp, loại bỏ preamble tạo/chọn database của upstream, rồi chạy trong database Compose mới. Không đưa các file đó vào app và không nhận SQL tùy ý.

## Database được dựng

| Engine | Container | Port trên host | Database | Native upstream asset |
|---|---|---:|---|---|
| PostgreSQL 16 | `postgres` | `55432` | `nla_chinook` | `Chinook_PostgreSql.sql` |
| MySQL 8.4 | `mysql` | `53306` | `nla_chinook` | `Chinook_MySql.sql` |
| SQL Server 2022 CU22 | `sqlserver` | `51433` | `nla_chinook` | `Chinook_SqlServer.sql` |

Compose binds loopback only and stores generated credentials in ignored `.local/compose.env` and `.local/docker.env`. The SQL Server image targets `linux/amd64`; on Apple Silicon Docker may use emulation, which is useful for this local test but has higher resource use.

Expected source data includes 11 tables and 15,607 rows total. The provisioner checks every individual count from `source.json`; selected counts include 3,503 tracks, 2,240 invoice lines and 8,715 playlist tracks. It also attempts a no-op write using the runtime reader and requires the database to reject it.

Application metadata is stored separately in PostgreSQL database `nla_metadata`. Each warehouse has its own `nla_` pipeline raw/staging/warehouse/mart tables; those tables are filtered out of the published Chinook dataset. The exact runtime schemas and semantic mappings are documented in `../scripts/semantic-*.json`.

The checked-in `pipeline-*.json` files are provenance-bound Chinook sample pipelines, not a directory users must create for each warehouse. Each declares source and target IDs, an explicit source-object allowlist for local provisioning, typed output columns, required fields, string limits, row/byte/deadline bounds, writer credential reference, and four distinct target tables (`raw`, `stage`, `warehouse`, `mart`). `pipeline_config.py` validates the three sample definitions before local writer tables/permissions are provisioned. `sourceObjects` is provisioning metadata only; the application derives allowed objects from the registered dataset and validated query. New user sources belong in the application source registry; these sample files are not a substitute for that required feature.

SQL Import has a separate local identity, not the Chinook query reader or ELT writer. Run `python3 data/scripts/docker_chinook.py provision-import` after the database containers are initialized. It creates the dedicated `nla_import` namespace for each engine, adds passwords to the ignored `.local/compose.env` and `.local/docker.env`, and tests that an importer can create/write its namespace while being denied object creation in the Chinook source namespace. The writer also has namespace-scoped INDEX/REFERENCES permissions needed by validated indexes and foreign keys; no extra source-table write grant is added. PostgreSQL and SQL Server use a schema; MySQL uses a database/catalog because its schema maps to a database.

## Rebuild

From repository root:

```bash
python3 scripts/docker_chinook.py init
python3 scripts/docker_chinook.py up
python3 scripts/docker_chinook.py provision
python3 scripts/docker_chinook.py verify
```

Provisioning is intentionally non-destructive: it refuses to import over an existing database lacking its local provenance marker. To reset a disposable local install, stop services, remove the Compose volumes deliberately, remove `.local/chinook-*.json`, then rerun the commands above. Never use that reset against a database containing user data.

## Application SQL Import acceptance

With the Java implementation running against the isolated local Docker warehouses, run:

```sh
python3 data/scripts/verify_sql_import.py --base-url http://127.0.0.1:8080/api/v1
```

This is a real Java/API→database test, with no API mocks. It generates disposable tables in `nla_import` for all nine source-dialect/target-engine pairs, confirms an immutable plan, polls persisted progress, checks idempotency/digest rejection, and reads actual rows independently to verify decimal/null integrity. It tests unsafe SQL and invalid UTF-8 failures. Only its own uniquely named test tables are removed with the separate local provisioning credential; it never accepts arbitrary SQL input or runs against a non-loopback API. The ignored `.local/application-import-report.json` records outcomes/IDs without tokens or data rows. A successful runner does not replace OIDC, FE browser, timeout, constraint or complete ingestion acceptance.

Re-run `python3 data/scripts/provision_pipeline.py` on existing clones to add missing sample raw/warehouse tables and table-specific writer grants. Existing stage/mart data and user credentials are preserved. Generic user sources remain registry metadata, not folders under `data/`.
