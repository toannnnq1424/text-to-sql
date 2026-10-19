# Hướng dẫn cho backend

Áp dụng `../AGENTS.md`. Đọc `../docs/roles/be.md` cùng contracts trước mọi task trong thư mục này. Backend Spring Boot và JDBC adapters cho PostgreSQL, MySQL, SQL Server đã được triển khai; kiểm tra code và integration tests hiện tại trước khi chỉnh sửa. Không coi contract/mock là tính năng hoàn tất.

Contract chung nằm ở `../docs/contracts/`; không tạo bản DTO tự thiết kế riêng. Thay đổi schema/data cần phối hợp BE và AI/Data. Báo checks đã chạy, không dùng mock thay bằng chứng integration.

Bắt buộc áp dụng `../docs/implementation-rules.md`: không chia version, skeleton/placeholder hoặc hoãn phần bắt buộc; hoàn chỉnh module trong scope cùng implementation thật, validation, error handling, security, tests cần thiết và tích hợp. Ảnh mock là chuẩn style UI, không yêu cầu truyền dữ liệu giả vào sản phẩm.
