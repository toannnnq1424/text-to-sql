# Hướng dẫn infra

Áp dụng `../AGENTS.md`; đọc architecture, security, acceptance và BE role. Compose chạy PostgreSQL, MySQL, SQL Server; `infra/local/` chứa launcher và kiểm thử tích hợp. Giữ metadata store tách warehouse data, tách writer/query credentials, không đưa secrets vào Git. Không claim MSSQL chạy được trên mọi host; kiểm chứng image/CPU support. Chỉ provision database local cô lập bằng script đã pin, không tự chạy seed trên warehouse người dùng.

Bắt buộc áp dụng `../docs/implementation-rules.md`: không chia version, skeleton/placeholder hoặc hoãn phần bắt buộc; hoàn chỉnh module trong scope cùng implementation thật, validation, error handling, security, tests cần thiết và tích hợp. Ảnh mock là chuẩn style UI, không yêu cầu truyền dữ liệu giả vào sản phẩm.
