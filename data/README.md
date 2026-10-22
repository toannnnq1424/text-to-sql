# Data

## Dataset hiện đang chạy

[Chinook](chinook/README.md) được provision vào database Docker cô lập để kiểm chứng adapter PostgreSQL, MySQL và SQL Server, semantic catalog và query flow. [AdventureWorksDW](adventureworks/README.md) bổ sung projection 12 bảng fact/dimension với 145.524 dòng nguồn thật; provisioning quản trị đã kiểm chứng count, exact decimal và reader chỉ đọc trên cả ba engine. Registry/semantic/upload qua app là các nghiệm thu riêng; provisioning không tự đăng ký nguồn vào app.

Danh mục đầy đủ sáu nguồn người dùng cung cấp nằm trong [docs/data-sources.md](../docs/data-sources.md). TPC-DS, Pagila, Northwind và Olist vẫn là nguồn tham khảo, chưa tải/provision trong đợt này.

**Giới hạn cần phân biệt:** các thư mục sample và script provisioning chỉ phân phối nguồn đã pin/provenance để dựng môi trường phát triển/kiểm thử riêng. Đây không phải importer tổng quát và không được nhân bản thành `data/<tên nguồn>` cho mỗi warehouse người dùng kết nối. Database đã tồn tại phải được đăng ký kết nối và discovery qua app; file người dùng nạp phải đi qua module import chung. Các luồng này là acceptance bắt buộc; xem bằng chứng hiện hành tại [project status](../docs/project-status.md) và [work log](../docs/work-log.md). Không coi sample provisioning hoặc fixture offline là bằng chứng đã hoàn thành caller UI/import/LLM.

## Provisioning an toàn

1. `python3 data/scripts/docker_chinook.py init` tạo secrets cục bộ với quyền file riêng tư.
2. `python3 data/scripts/docker_chinook.py up` khởi động database services.
3. `python3 data/scripts/docker_chinook.py provision` tải các script native từ release đã pin, xác minh checksum và nhập vào database mới.
4. Script kiểm tra số dòng từng bảng và quyền read-only; provenance runtime nằm trong `.local/`.

Chỉ chạy provisioning này trên các database cô lập do Compose quản lý. Script chỉ tải release đã pin, xác minh checksum rồi nhập schema/data Chinook; không dùng nó để nạp SQL tùy ý lên warehouse người dùng. Tài khoản warehouse runtime chỉ đọc; pipeline writer tách biệt theo từng engine. Secrets, file tải về, database volumes và report local đều bị Git ignore.

AdventureWorksDW có [lệnh tải/provision/verify riêng](adventureworks/README.md), database `nla_adventureworks_dw` và reader riêng; không ghi đè Chinook. Có thể xuất nguồn thật thành CSV/XLSX/Parquet và các định dạng khác bằng `infra/local/adventureworks-runtime.py prepare-files --binary` để thao tác Nạp file qua UI có ghi hình. SQL Import dùng projection 606 dòng bốn cột trong quota, không nhận nguyên installer upstream. File chuẩn bị không tự nạp hay đăng ký gì.

Đã ghi hình flow CSV 606 dòng trên cả ba engine, SQL Import 606 dòng trên ba engine, JSON 606 dòng và fact CSV 60.398 dòng trên PostgreSQL, cùng transformation MySQL→PostgreSQL. Reader độc lập kiểm đủ bốn lớp và toàn bộ giá trị nguồn/canonical tương ứng; 13 extension có preview qua UI, không claim tất cả đã persist. CSV giữ empty string khác JSON null tường minh; [hồ sơ sample](adventureworks/README.md) ghi rõ policy, oracle, report và giới hạn bằng chứng. Nghiệm thu chức năng/data không tự chứng minh mọi accessibility/visual state hoặc chất lượng LLM.

## Cấu trúc

- `chinook/`: provenance và license của upstream.
- `adventureworks/`: manifest projection 12 bảng, PK/FK/type mapping, license và hướng dẫn nguồn chính thức.
- `scripts/`: tải, xác minh, provisioning, semantic registration và smoke/evaluation helpers.
- `.local/` ở repository root: cache/file xuất/oracle/report/secrets runtime, không commit.
