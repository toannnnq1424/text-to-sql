# Data

## Dataset hiện đang chạy

[Chinook](chinook/README.md) được provision vào database Docker cô lập để kiểm chứng adapter PostgreSQL, MySQL và SQL Server, semantic catalog và query flow. Các nguồn warehouse khác do người dùng cung cấp được liệt kê trong [docs/data-sources.md](../docs/data-sources.md); không có nguồn nào tự động được nhập vào ứng dụng.

**Giới hạn cần phân biệt:** `data/chinook/` và `scripts/docker_chinook.py` chỉ dựng sample Chinook cố định có provenance để bootstrap môi trường phát triển/kiểm thử. Đây không phải importer tổng quát, không phải workflow nạp dữ liệu trong application, và không được nhân bản thành `data/<tên nguồn>` cho mỗi warehouse người dùng kết nối. Database đã tồn tại phải được đăng ký kết nối và discovery qua app; file người dùng nạp phải đi qua module import chung. Các luồng này là acceptance bắt buộc; xem trạng thái thiếu hiện tại tại [current review](../docs/current-review.md). Không được coi việc provision Chinook là bằng chứng chúng đã hoàn thành.

## Provisioning an toàn

1. `python3 scripts/docker_chinook.py init` tạo secrets cục bộ với quyền file riêng tư.
2. `python3 scripts/docker_chinook.py up` khởi động database services.
3. `python3 scripts/docker_chinook.py provision` tải các script native từ release đã pin, xác minh checksum và nhập vào database mới.
4. Script kiểm tra số dòng từng bảng và quyền read-only; provenance runtime nằm trong `.local/`.

Chỉ chạy provisioning này trên các database cô lập do Compose quản lý. Script chỉ tải release đã pin, xác minh checksum rồi nhập schema/data Chinook; không dùng nó để nạp SQL tùy ý lên warehouse người dùng. Tài khoản warehouse runtime chỉ đọc; pipeline writer tách biệt theo từng engine. Secrets, file tải về, database volumes và report local đều bị Git ignore.

## Cấu trúc

- `chinook/`: provenance và license của upstream.
- `scripts/`: tải, xác minh, provisioning, semantic registration và smoke/evaluation helpers.
- `downloads/`, `generated/`: cache/runtime data, không commit.
