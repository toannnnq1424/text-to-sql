# Hướng dẫn cho ai-service

Áp dụng `../AGENTS.md`. Đọc `../docs/roles/ai-data.md` cùng contracts trước mọi task trong thư mục này. Python AI service đã có deterministic mode và provider API path; giữ contract Java ↔ Python và xác thực service-token. Chạy tests hiện hữu và không đưa warehouse credentials vào AI service.

Contract chung nằm ở `../docs/contracts/`; không tạo bản DTO tự thiết kế riêng. Thay đổi schema/data cần phối hợp BE và AI/Data. Báo checks đã chạy, không dùng mock thay bằng chứng integration.

Bắt buộc áp dụng `../docs/implementation-rules.md`: không chia version, skeleton/placeholder hoặc hoãn phần bắt buộc; hoàn chỉnh module trong scope cùng implementation thật, validation, error handling, security, tests cần thiết và tích hợp. Ảnh mock là chuẩn style UI, không yêu cầu truyền dữ liệu giả vào sản phẩm.
