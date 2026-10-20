# Nguồn warehouse / sample database / dataset

## Trạng thái dữ liệu hiện tại

Đã provision Chinook release `v1.4.5` với script native và checksum xác minh vào ba database Docker PostgreSQL, MySQL, SQL Server. Xem [provenance và lệnh tái tạo](../data/chinook/README.md). Chinook là sample transactional dùng smoke/integration tests, không phải warehouse star schema.

Lưu đầy đủ sáu nguồn người dùng đã cung cấp. Chinook đã tải/provision/kiểm chứng trong môi trường Docker local; năm nguồn khác vẫn là danh mục đầu vào, chưa tải hoặc seed. Không phải nguồn nào cũng là data warehouse star schema. Trước khi dùng thêm, pin release/commit, kiểm tra license, ghi checksum, giới hạn dung lượng và hướng dẫn tái tạo; không mặc định được redistribute dữ liệu vì mã nguồn có trên GitHub.

Phân biệt sample dataset ở đây với connector platform. Hai bộ mã nguồn mới do người dùng chỉ định ngày 2026-10-20 được khảo sát tại [platform-reuse.md](platform-reuse.md), inventory hash tại [reviewed-snapshots.json](integrations/reviewed-snapshots.json); danh mục engine/storage/file mở rộng nằm ở [future-connectors.md](future-connectors.md). Khảo sát source code không có nghĩa đã tải dữ liệu hoặc kết nối được các dịch vụ đó.

| Nguồn | Link gốc | Loại và cách dùng dự kiến | Lưu ý |
|---|---|---|---|
| AdventureWorksDW | [README Microsoft](https://github.com/microsoft/sql-server-samples/blob/master/samples/databases/adventure-works/README.md), [thư mục AdventureWorks](https://github.com/microsoft/sql-server-samples/tree/master/samples/databases/adventure-works) | Warehouse mẫu Microsoft có fact/dimension; dùng chứng minh analytical queries trên SQL Server | Phân biệt AdventureWorks OLTP với AdventureWorksDW. Nếu port PostgreSQL/MySQL phải viết mapping/seed và kiểm chứng result equivalence, không chỉ đổi tên file. |
| TPC-DS | [gregrahn/tpcds-kit](https://github.com/gregrahn/tpcds-kit) | Benchmark warehouse, fact/dimension và truy vấn phân tích phức tạp; dùng stress/schema-context/evaluation | Build toolkit và generate dữ liệu với scale phù hợp; lưu seed/config. Đây là bản toolkit có sửa đổi, có EULA; không tự coi các query templates là portable toàn bộ 3 engine. |
| Pagila | [xzilla/pagila](https://github.com/xzilla/pagila) | PostgreSQL sample DB, thuận tiện demo Text-to-SQL | Thiên transactional, không gọi warehouse star schema. Có schema/data scripts; provisioning quản trị riêng, không upload execute trong app. |
| Chinook | [lerocha/chinook-database](https://github.com/lerocha/chinook-database) | **Đã nạp và kiểm chứng** trên PostgreSQL/MySQL/SQL Server từ release `v1.4.5`; chi tiết ở [data/chinook](../data/chinook/README.md) | Customer/invoice/track/artist dễ hiểu; vẫn là sample DB giao dịch, không phải star schema. |
| Northwind PostgreSQL | [pthom/northwind_psql](https://github.com/pthom/northwind_psql) | Database mẫu bán hàng, `northwind.sql`, tiện demo join/filter local | Không là warehouse chuẩn; native PostgreSQL, cần port có kiểm chứng nếu dùng cho 3 engines. |
| Olist Brazilian E-Commerce | [Kaggle link người dùng](https://www.kaggle.com/olistbr/brazilian-ecommerce/home/), [trang dataset](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce) | CSV e-commerce khoảng 100.000 đơn hàng theo mô tả nguồn người dùng; phù hợp ELT raw→staging→warehouse/mart | Orders/customers/products/payments/reviews/geolocation; kiểm tra schema/license/access khi triển khai. Không tải/commit dữ liệu cá nhân mặc định; xác định grain và join fan-out trước metrics. |

## Hướng lựa chọn cho triển khai

Chinook hiện dùng để smoke test nhanh cả ba engines. Các nguồn AdventureWorksDW, TPC-DS, Pagila, Northwind và Olist vẫn là nguồn tham khảo do người dùng cung cấp; chưa được đưa vào runtime. Một bộ dữ liệu warehouse star-schema riêng có thể được chọn cho nhiệm vụ tiếp theo nhưng không thay thế yêu cầu tương thích ba engine hiện tại.

Nguồn bên ngoài không tự động thành “dataset trong app”. Quy trình rõ ràng:

1. Quản trị/data engineer lấy dữ liệu tin cậy và dựng database/schema bằng script đã review ở môi trường riêng.
2. Tạo runtime read-only user với phạm vi cần thiết; writer thuộc pipeline riêng.
3. Admin đăng ký Warehouse (engine/endpoint/credential reference), test connection, discover metadata.
4. Đăng ký Dataset với allowlist, semantic mapping, metric/dimension/rule, version.
5. Java validate semantic model với physical metadata, sau đó ACTIVE và xuất hiện trong selectors/catalog.
6. Chạy câu hỏi mẫu + expected result qua Java cho từng engine; lưu provenance và evaluation evidence.

## Hồ sơ provenance

`source URL`, release/commit, license/redistribution terms, file checksums, row counts, schema/grain, transformation per engine, data-quality checks, timezone/currency, sensitivity and retention. Chinook provenance and expected row counts are recorded in `data/chinook/source.json`; upstream SQL payloads and database credentials are excluded from Git. The remaining listed sources have not been downloaded or provisioned.

## File người dùng tải lên ứng dụng

Nguồn file không cần một folder trong repo. Trong Nạp dữ liệu→Nạp file, upload CSV/TSV/TXT, XLSX, JSON/JSONL/NDJSON, Parquet, Arrow/Feather/IPC, ORC hoặc Avro. App tự đọc header và suy kiểu từ toàn bộ bản ghi, cho chọn sheet/delimiter và chỉnh mapping, preview rồi xác nhận kế hoạch vào một namespace đã cấp quyền. Java dùng prepared batches, kiểm chứng mart bằng reader, đăng ký Dataset có provenance/hash; không execute nội dung file như SQL. Chi tiết bounds/lifecycle tại [file contract](contracts/file-ingestion.md). Source registry DB→DB vẫn dành cho query/pipeline đã được quản trị; không thay flow upload bằng việc nhập thủ công từng dòng/cột.
