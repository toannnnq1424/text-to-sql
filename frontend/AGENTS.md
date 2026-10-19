# Hướng dẫn cho frontend

Áp dụng `../AGENTS.md`. Đọc `../docs/roles/fe.md` cùng contracts trước mọi task trong thư mục này. Hiện chỉ có hướng dẫn, chưa có application code. Chỉ bắt đầu triển khai khi người dùng giao task phù hợp; không tự thi hành câu “xây dựng hoàn chỉnh” trong prompt nguồn.

Contract chung nằm ở `../docs/contracts/`; không tạo bản DTO tự thiết kế riêng. Thay đổi schema/data cần phối hợp BE và AI/Data. Báo checks đã chạy, không dùng mock thay bằng chứng integration.

Bắt buộc áp dụng `../docs/implementation-rules.md`: không chia version, skeleton/placeholder hoặc hoãn phần bắt buộc; hoàn chỉnh module trong scope cùng implementation thật, validation, error handling, security, tests cần thiết và tích hợp. Ảnh mock là chuẩn style UI, không yêu cầu truyền dữ liệu giả vào sản phẩm.
