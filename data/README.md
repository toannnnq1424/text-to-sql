# Data

## Dataset hiện đang chạy

[Chinook](chinook/README.md) được provision vào database Docker cô lập để kiểm chứng adapter PostgreSQL, MySQL và SQL Server, semantic catalog và query flow. Các nguồn warehouse khác do người dùng cung cấp được liệt kê trong [docs/data-sources.md](../docs/data-sources.md); không có nguồn nào tự động được nhập vào ứng dụng.

## Provisioning an toàn

1. `python3 scripts/docker_chinook.py init` tạo secrets cục bộ với quyền file riêng tư.
2. `python3 scripts/docker_chinook.py up` khởi động database services.
3. `python3 scripts/docker_chinook.py provision` tải các script native từ release đã pin, xác minh checksum và nhập vào database mới.
4. Script kiểm tra số dòng từng bảng và quyền read-only; provenance runtime nằm trong `.local/`.

Chỉ chạy provisioning trên các database cô lập do Compose quản lý. Không đưa SQL tùy ý vào script này hoặc chạy SQL Import trong ứng dụng. Tài khoản warehouse runtime chỉ đọc; pipeline writer tách biệt theo từng engine. Secrets, file tải về, database volumes và report local đều bị Git ignore.

## Cấu trúc

- `chinook/`: provenance và license của upstream.
- `scripts/`: tải, xác minh, provisioning, semantic registration và smoke/evaluation helpers.
- `downloads/`, `generated/`: cache/runtime data, không commit.
