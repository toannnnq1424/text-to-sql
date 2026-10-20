# Mở rộng tương thích nguồn dữ liệu

Yêu cầu ghi nhận ngày 2026-10-20: định hướng dài hạn vượt ngoài PostgreSQL, MySQL và SQL Server, tận dụng hai bộ nguồn đã khảo sát tại [platform-reuse.md](platform-reuse.md). Ba engine hiện tại, login, SQL Import và in-app ingestion vẫn là target bắt buộc hiện hành; danh mục này không hoãn hoặc giảm acceptance đó.

**Trạng thái:** bảng dưới ghi khả năng tìm thấy trong source snapshot, chưa phải connector đã chạy trong app. Không thêm engine enum/adapter placeholder/màn hình giả chỉ để thể hiện danh sách dài. Connector cloud cần tài khoản/quyền/hạ tầng thực trước khi kiểm chứng.

## Danh mục người dùng yêu cầu

| Nguồn | Evidence trong semantic snapshot | Evidence trong tool-runtime snapshot | Điều phải phân biệt khi áp dụng |
|---|---|---|---|
| Amazon S3 | `s3_file` và object-storage metadata | Chưa xác lập connector S3 trực tiếp qua inventory đã đọc | Bucket/prefix, format và query engine; không là SQL dialect |
| Apache Spark | `spark`, Spark metadata | `dataproc`, `serverlessspark` | Local/cluster Spark khác dịch vụ Spark được quản lý; job/cancel/cost khác JDBC |
| Apache Doris | `doris`, custom dialect/metadata | Chưa xác lập implementation Doris trực tiếp | Không nhận MySQL wire compatibility làm bằng chứng query semantic tương đương |
| Athena | `athena`, metadata/DTO | Chưa xác lập connector Athena trực tiếp | Workgroup, catalog, region, output location, IAM và scan cost |
| BigQuery | `bigquery`, project/dataset connection | `bigquery` | Project/dataset/location, IAM, job limits và decimal types |
| ClickHouse | `clickhouse`, metadata | `clickhouse` | Server types, query settings, limits và decimal/timezone |
| Databricks | `databricks`, token/service-principal DTO | Chưa xác lập connector Databricks trực tiếp | SQL warehouse/cluster, catalog/schema, OAuth và job timeout |
| DuckDB | `duckdb`, DuckDB metadata | Chưa xác lập connector DuckDB trực tiếp | Embedded file/database lifecycle, extensions và filesystem isolation |
| Google Cloud Storage | `gcs_file`, object-storage metadata | `cloudstorage` | Object API tool không tự đồng nghĩa SQL-over-file query support |
| Local files | `local_file`, object-storage metadata | File resources có trong framework, không đồng nghĩa SQL connector | Allowed roots, format, size, symlink/path traversal, read-only mount |
| MinIO | `minio_file`, object-storage metadata | Chưa xác lập connector MinIO trực tiếp | Endpoint/TLS/bucket allowlist và S3-compatible không phải engine dialect |
| MySQL | `mysql`, metadata | `mysql`, `cloudsqlmysql` | Target hiện tại; native JDBC đang có, phải so sánh trước khi thay executor |
| Oracle | `oracle`, metadata | `oracle` | Driver/native dependencies, quoting, NUMBER, pagination, service name |
| PostgreSQL | `postgres`, metadata | `postgres`, `cloudsqlpg`, `alloydbpg` | Target hiện tại; managed services có auth/network khác self-hosted |
| Redshift | `redshift`, IAM connection | Chưa xác lập connector Redshift trực tiếp | Không suy luận toàn bộ khả năng từ PostgreSQL wire protocol |
| SQL Server | `mssql`, metadata | `mssql`, `cloudsqlmssql` | Target hiện tại; TOP/OFFSET, datetime2, TLS và read-only grants |
| Snowflake | `snowflake`, metadata | `snowflake` | Account/role/warehouse, keypair/OAuth, query cost/cancel |
| Trino | `trino`, metadata | `trino` | Catalog/schema, federation authorization và underlying source rights |

Nguồn evidence là `ibis-server/app/model/data_source.py`, `ibis-server/app/model/metadata/factory.py`, Python SDK extras và các thư mục `internal/sources`/`internal/tools` trong snapshot đã pin hash. “Chưa xác lập” là chưa có evidence từ khảo sát, không kết luận upstream không thể hỗ trợ.

Các nguồn khác như MongoDB, Redis, Elasticsearch, Spanner, SQLite, Neo4j, Couchbase và CockroachDB có module trong tool snapshot, có thể khảo sát khi có task cụ thể. Non-relational tool không tự biến thành warehouse SQL: cần contract/semantics và UI capability phù hợp.

## Mô hình connector khi mở rộng

- Tách `sourceType`/connector kind, SQL dialect, connection/auth và capabilities; storage S3/GCS/local/MinIO không thêm như SQL dialect. Schema thay đổi phải có migration, contract fixtures và consumer tests FE/BE/AI, không tự sửa enum runtime hiện tại.
- Dùng capability thực cho discovery, read-only query, semantic planning, ingest, SQL import, preview/dry-run, cancellation và transaction. Không mặc định connector nào cũng cho ghi hoặc import DDL. Chỉ hiển thị thao tác được capability và quyền của caller cho phép.
- Connection config khác nhau theo nguồn: JDBC host/port không đủ cho bucket, cloud project, catalog, cluster hoặc serverless job. Secret references và workload identity ở server; không gửi key/token/private paths vào LLM hoặc browser responses.
- Giữ logical Dataset làm phạm vi được cấp quyền: physical table với SQL engine, hoặc object/file collection có allowed prefix/root/format với file sources. Discovery và query đều kiểm tra scope, không chỉ selector.
- Tái sử dụng code đã hoạt động qua private service/binding/connector phù hợp, có pin dependency và provenance. Không tạo nhánh `if vendor` rải trong React, AI prompt hay business core.

## Điều kiện nghiệm thu một nguồn mới

Một connector phải có luồng đăng ký → kiểm tra kết nối → discovery → dataset/semantic validation → hỏi đáp qua Java → result/history/export/UI thật. Thử null/large integer/decimal/timezone, empty result, filter/pagination, timeout/cancel/size limit, session expiry, forbidden resources, secret/log redaction và malformed input.

Với object/file sources, thử path traversal/symlink/SSRF, prefix và egress restrictions, file type/size, wildcard expansion và credential scoping; không tự tải URL hoặc load DuckDB extension tùy ý. Với cloud query, chứng minh job cancellation, scan/cost/time limits và IAM tối thiểu. Import/ingestion chỉ nghiệm thu cho capability được cam kết, có failure/recovery/idempotency và persisted state thật.

Không báo `SUPPORTED` từ việc import thư viện, build thành công hay tool upstream có tên tương ứng. Báo PASS/FAIL/BLOCKED/NOT RUN theo [acceptance.md](acceptance.md) với source/engine/service version và evidence thật.
