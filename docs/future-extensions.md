# Hướng mở rộng có điều kiện

Chỉ lưu hướng người dùng đã xác định ngoài scope chính hoặc công việc tăng quy mô. SQL Import có kiểm soát, in-app data ingestion và login/authorization hiện là yêu cầu bắt buộc trong [scope.md](scope.md), không đưa vào đây. Không chuyển phần bắt buộc còn thiếu sang roadmap để né nghiệm thu. Tuân thủ [implementation-rules.md](implementation-rules.md).

## Local inference và training

API provider client được ưu tiên vì nhanh tích hợp và dễ đo. Local inference có thể được cân nhắc khi có lý do về privacy, offline, cost, latency hoặc quality; local inference khác fine-tuning/training và không cần training chỉ để chạy model local.

Chỉ cân nhắc fine-tune khi prompt/RAG/context selection/provider baseline đã đo được gap; cần dữ liệu SQL có quyền sử dụng, train/dev/test tách biệt, không evaluation leakage, reproducible run/model version, và so sánh quality + latency/cost. Java security boundary không thay đổi dù model local hay trained.

## Nguồn data lớn / nâng quy mô

TPC-DS scale lớn, Olist ELT đầy đủ, port AdventureWorksDW và multi-tenant scheduling triển khai theo task/hạ tầng thật. Danh mục nguồn vẫn giữ tại [data-sources.md](data-sources.md); điều đó không có nghĩa đã tải hoặc hỗ trợ các nguồn này.

## Thêm connector, cloud storage và file sources

Người dùng yêu cầu ghi định hướng mở rộng ngày 2026-10-20: Amazon S3, Apache Spark, Apache Doris, Athena, BigQuery, ClickHouse, Databricks, DuckDB, Google Cloud Storage, local files, MinIO, Oracle, Redshift, Snowflake, Trino và các nguồn khác, bên cạnh ba engine hiện tại. Danh mục/evidence và điều kiện nghiệm thu tại [future-connectors.md](future-connectors.md). Ưu tiên tận dụng hai bộ nguồn đã khảo sát theo [platform-reuse.md](platform-reuse.md), không dựng adapter placeholder, không sửa enum một phía và không gọi khả năng upstream là implementation đã chạy của app. Các phần mandatory hiện tại không chuyển sang mục này.
