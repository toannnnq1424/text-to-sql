# BE — Java / Spring Boot / Data Platform / Security

Đọc AGENTS, scope, architecture, toàn bộ contracts, security, acceptance; prompt nguồn `docs/prompts/02-backend.txt`. SQL Import/cross-dialect DDL không thuộc DoD chính; chỉ là mở rộng có điều kiện. Không tạo endpoint execute file SQL.

## Ownership và stack

`backend/` và phối hợp `infra/`; Java 21, Spring Boot, Maven, Web, JDBC, Flyway, Jackson, Bean Validation, RestClient/WebClient, AST parser phù hợp cả ba dialect, JUnit 5, Mockito, Testcontainers. JDBC PostgreSQL/MySQL/SQL Server. Không mặc định JSqlParser đủ mọi syntax: chọn/kiểm chứng parser bằng corpus cả ba dialect trước khi dùng làm security boundary.

## Bắt đầu từ ngày đầu sau C0

1. Public/internal DTO + OpenAPI/schema fixtures dùng chung; auth resource scoping; metadata store migrations; registry/semantic/discovery APIs. Làm Python stub theo fixture để không chờ AI.
2. Implement WarehouseAdapter contract và cùng bộ test cho cả ba engine: testConnection, discoverSchemas/Tables/Columns/Relationships, executeReadOnlyQuery, applySafeLimit, configureTimeout, quoteIdentifier, normalizeIdentifier, getSqlDialect, getCapabilities.
3. PostgreSql/MySql/SqlServer adapters và dialect implement thật. Quote, limit/TOP/OFFSET, date, casts, boolean, timestamp, catalog/schema qualification khác nhau; không regex rewrite SQL hay normalize lowercase mọi tên.
4. Query pipeline đúng architecture; parse AST recursive, read-only/allowlist, dangerous functions, timeout/row/byte bounds; trả result metadata, chart đã validate, history/audit kể cả lỗi.
5. History/catalog large lists, ingestion orchestration registered pipeline, evaluation metrics/case detail, monitoring/platform summary, settings.
6. Tích hợp Python thật và React thật theo kế hoạch chung. Không chờ UI hoàn tất để mới bắt đầu Java.

Credential runtime chỉ SELECT; writer cho provisioning/ingestion dùng profile, principal và network riêng. App metadata Flyway không chạy trên warehouse nguồn. Engine/dialect lấy registry, không nhận từ browser. Semantic physical mapping sai phải INVALID_SCHEMA, không tự sửa SQL để “chạy được”. Snapshot result bounded, Decimal/BIGINT serialization đúng contract.

## Hoàn thành task

mvn test + adapter Testcontainers cho PostgreSQLContainer/MySQLContainer/MSSQLServerContainer + security corpus + schema/DTO contract checks + evaluation/E2E 3 engines. Không UnsupportedOperationException ở API bắt buộc, không adapter placeholder. Nếu SQL Server container không chạy trên host, ghi blocked và chạy trên host/CI phù hợp trước nghiệm thu; không fake pass. Báo chính xác phần đã chạy với database/provider thật.
