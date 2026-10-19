# Nguồn warehouse / sample database / dataset

Lưu đầy đủ sáu nguồn người dùng đã cung cấp. Đây là danh mục đầu vào và định hướng sử dụng, chưa tải, seed, port hoặc kiểm chứng schema/data trong repository. Không phải nguồn nào cũng là data warehouse star schema. Trước khi dùng, pin release/commit, kiểm tra license, ghi checksum, giới hạn dung lượng và hướng dẫn tái tạo; không mặc định được redistribute dữ liệu vì mã nguồn có trên GitHub.

| Nguồn | Link gốc | Loại và cách dùng dự kiến | Lưu ý |
|---|---|---|---|
| AdventureWorksDW | [README Microsoft](https://github.com/microsoft/sql-server-samples/blob/master/samples/databases/adventure-works/README.md), [thư mục AdventureWorks](https://github.com/microsoft/sql-server-samples/tree/master/samples/databases/adventure-works) | Warehouse mẫu Microsoft có fact/dimension; dùng chứng minh analytical queries trên SQL Server | Phân biệt AdventureWorks OLTP với AdventureWorksDW. Nếu port PostgreSQL/MySQL phải viết mapping/seed và kiểm chứng result equivalence, không chỉ đổi tên file. |
| TPC-DS | [gregrahn/tpcds-kit](https://github.com/gregrahn/tpcds-kit) | Benchmark warehouse, fact/dimension và truy vấn phân tích phức tạp; dùng stress/schema-context/evaluation | Build toolkit và generate dữ liệu với scale phù hợp; lưu seed/config. Đây là bản toolkit có sửa đổi, có EULA; không tự coi các query templates là portable toàn bộ 3 engine. |
| Pagila | [xzilla/pagila](https://github.com/xzilla/pagila) | PostgreSQL sample DB, thuận tiện demo Text-to-SQL | Thiên transactional, không gọi warehouse star schema. Có schema/data scripts; provisioning quản trị riêng, không upload execute trong app. |
| Chinook | [lerocha/chinook-database](https://github.com/lerocha/chinook-database) | Database mẫu nhỏ về nhạc/bán hàng, có script cho PostgreSQL/MySQL/SQL Server; ứng viên smoke test tương đương 3 engine | Customer/invoice/track/artist dễ hiểu; vẫn là sample DB giao dịch. Chốt cùng phiên bản/dữ liệu trước khi so kết quả, không giả mọi script có schema/collation giống nhau. |
| Northwind PostgreSQL | [pthom/northwind_psql](https://github.com/pthom/northwind_psql) | Database mẫu bán hàng, `northwind.sql`, tiện demo join/filter local | Không là warehouse chuẩn; native PostgreSQL, cần port có kiểm chứng nếu dùng cho 3 engines. |
| Olist Brazilian E-Commerce | [Kaggle link người dùng](https://www.kaggle.com/olistbr/brazilian-ecommerce/home/), [trang dataset](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce) | CSV e-commerce khoảng 100.000 đơn hàng theo mô tả nguồn người dùng; phù hợp ELT raw→staging→warehouse/mart | Orders/customers/products/payments/reviews/geolocation; kiểm tra schema/license/access khi triển khai. Không tải/commit dữ liệu cá nhân mặc định; xác định grain và join fan-out trước metrics. |

## Hướng lựa chọn cho triển khai

Đề xuất kỹ thuật, chưa chọn dataset cố định: Chinook dùng smoke test nhanh cho cả ba engines; một bộ synthetic canonical hai domain (commerce/market-price) có seed cố định dùng contract/CI; AdventureWorksDW hoặc Olist dùng minh chứng warehouse/data engineering sâu hơn khi có task. Pagila/Northwind là lựa chọn demo PostgreSQL tiện, không được thay việc nghiệm thu cả 3 engine. TPC-DS dành bài kiểm tra lớn khi hạ tầng/token budget phù hợp, không bắt tải bộ khổng lồ trong bước đầu.

Nguồn bên ngoài không tự động thành “dataset trong app”. Quy trình rõ ràng:

1. Quản trị/data engineer lấy dữ liệu tin cậy và dựng database/schema bằng script đã review ở môi trường riêng.
2. Tạo runtime read-only user với phạm vi cần thiết; writer thuộc pipeline riêng.
3. Admin đăng ký Warehouse (engine/endpoint/credential reference), test connection, discover metadata.
4. Đăng ký Dataset với allowlist, semantic mapping, metric/dimension/rule, version.
5. Java validate semantic model với physical metadata, sau đó ACTIVE và xuất hiện trong selectors/catalog.
6. Chạy câu hỏi mẫu + expected result qua Java cho từng engine; lưu provenance và evaluation evidence.

## Hồ sơ provenance cần bổ sung khi thực sự lấy data

`source URL`, upstream release/commit, access date, license/redistribution terms, file checksums, generator seed/scale, row counts, schema/grain, transformation mapping per engine, data-quality checks, timezone/currency, data sensitivity, retention. Lưu metadata/scripts nhẹ trong `data/`; bulk files qua storage/cache ignored. Không có hành động download/execution trong phiên tài liệu này.

Các link là nguồn được người dùng cung cấp; danh mục không khẳng định tất cả download đã được truy cập hoặc chạy thử. TPC-DS/Chinook/Pagila/Northwind đã đối chiếu landing repository; Microsoft link chưa fetch được và Kaggle không trả nội dung có thể kiểm chứng trong phiên chuẩn bị, nên phải xác minh trước khi dùng.
