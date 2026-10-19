# Hướng dẫn infra

Áp dụng `../AGENTS.md`; đọc architecture, security, acceptance và BE role. Compose/CI là công việc sau khi giao triển khai; hiện chưa có runtime. Phải có đủ ba engine và ba app services, tách metadata store với warehouse data, tách writer/query credentials, private Python network, env examples không secrets. Không claim MSSQL chạy được trên mọi host; kiểm chứng actual image/CPU support và CI tương thích. Không tự chạy script seed trên warehouse người dùng.
