# Hướng mở rộng có điều kiện

Không thuộc phạm vi triển khai chính hoặc điều kiện hoàn thành hiện tại. Không tự triển khai các mục này từ prompt nguồn; cần task thực tế sau này.

## SQL Import / cross-dialect provisioning

Theo điều chỉnh mới nhất của người dùng: chỉ phát triển sau này **nếu thực sự cần thiết**. Câu hỏi sản phẩm trước tiên là người dùng có cần dựng warehouse trong app không, hay workflow provisioning riêng + đăng ký kết nối đã đủ. Hiện app chỉ kết nối warehouse có sẵn; không có upload/execution `.sql` tùy ý trong query/ingestion endpoint.

Nếu có nhu cầu được giao rõ, phạm vi cần thiết kế riêng:

- Admin/operator-only, môi trường provisioning tách query runtime và credential read-only.
- Validate/preview trước: source AUTO_DETECT/POSTGRESQL/MYSQL/SQL_SERVER, target warehouse, statements, unsupported features, warnings, limits, audit.
- Không execute file tùy ý; AST parser + allowlisted analytical DDL/data subset, source provenance, size/time/resource bounds. Dry-run không hứa rollback được mọi DDL trên cả 3 engines.
- Native source=target vẫn phải validate; source khác target cần canonical DatabaseDefinition/Schema/Table/Column/PK/FK/Index và type mapping, không regex convert.
- Scope tiềm năng: CREATE SCHEMA/TABLE, PK/FK/UNIQUE/INDEX, identity/auto-increment, basic DEFAULT, INSERT và common scalar types. Stored procedures/triggers/network/filesystem/vendor features ngoài subset trả UNSUPPORTED_IMPORT_FEATURE, không silently skip.
- Phân biệt parse/dialect mismatch/unsupported errors, idempotency, destructive operation policy, sandbox staging và recovery plan. Admin chọn target, review concrete plan trước execution.
- API/UI/jobs/tests/docs/permissions là task mở rộng đồng bộ, không bật lại `/api/v1/import/sql` chỉ vì có trong prompt archive.

Không cam kết hỗ trợ mọi SQL dump hoặc tự động chuyển toàn bộ features giữa ba vendors.

## Local inference và training

API provider client được ưu tiên vì nhanh tích hợp và dễ đo. Abstraction TextToSqlModelClient cần cho phép bổ sung endpoint local (ví dụ server cung cấp API tương thích) sau, không thay Java↔Python contract. Local inference khác fine-tuning/training; không cần training chỉ để chạy model local.

Khi có lý do (privacy, offline, cost, latency, quality) mới benchmark model local, hardware/RAM/VRAM/context budget, license và ba dialect với cùng test suite. Chỉ cân nhắc fine-tune khi prompt/RAG/context selection/provider baseline đã đo được gap; cần dữ liệu SQL có quyền dùng, train/dev/test tách biệt, no evaluation leakage, reproducible run/model version, quality + latency/cost comparison. Java security boundary không thay đổi dù model local hay trained.

## Nguồn data lớn / nâng quy mô

TPC-DS scale lớn, Olist ELT đầy đủ, port AdventureWorksDW và advanced warehouses/multi-tenant scheduling triển khai theo task/hạ tầng thật. Danh mục nguồn vẫn giữ tại data-sources.md để không mất ý tưởng, không đồng nghĩa đã tải hoặc hỗ trợ toàn bộ trong phiên này.
