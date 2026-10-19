# Phạm vi và cách đọc yêu cầu

## Đang làm và chưa làm

Phiên 2026-10-19 chuẩn bị repository, đọc đủ ba prompt, lưu nguyên bản, định nghĩa contract, hướng dẫn vai trò, kế hoạch phối hợp, ảnh và tiêu chí nghiệm thu. Chưa dựng app, gọi provider, tạo warehouse hay tải database mẫu. Những nội dung đặc tả là mục tiêu cho task triển khai sau.

## Quy tắc triển khai bắt buộc

Áp dụng đầy đủ [implementation-rules.md](implementation-rules.md) theo bổ sung trực tiếp của người dùng: không chia version, không skeleton/placeholder, không hoãn implementation/validation/error handling/security/test hoặc tích hợp, không giảm target để chạy demo. Ảnh mock là chuẩn phong cách UI, không yêu cầu dữ liệu giả trong giao diện sản phẩm.

## Mục tiêu chính

Nền tảng đa warehouse/domain, tiếng Việt/Anh, React → Java → Python; Java truy vấn PostgreSQL/MySQL/SQL Server với read-only credential. Bao gồm registry warehouse/dataset, discovery, semantic layer, query, results, catalog, history/audit, ingestion có kiểm soát, evaluation, technical monitoring và settings. UI phải đẹp và sát ảnh ngay từ bước đầu; API provider AI được ưu tiên trước local training.

## Xung đột đã giải quyết

| Nguồn | Chốt áp dụng |
|---|---|
| Prompt FE/BE yêu cầu SQL Import và cross-dialect DDL | Theo trao đổi mới nhất: ghi thành mở rộng chỉ khi thực sự cần; không đưa vào app chính hoặc DoD hiện tại. Xem `future-extensions.md`. |
| Prompt dùng “không chia version” | Target nghiệm thu đầy đủ cả 3 engine; được chia task/gate kỹ thuật và phát triển song song, không tuyên bố PostgreSQL-only là hoàn thành. |
| Ảnh có dashboard e-commerce | Giữ layout/phong cách, thay nội dung bằng platform metrics và metadata API; không cố định revenue/orders trong core. |
| Ảnh có sidebar hoặc tab lặp/khác nhau | Dùng shell ảnh 01–10, route map chuẩn trong `ui-reference.md`; ảnh 11–14 chỉ bổ sung chi tiết. Thêm Warehouses theo prompt FE bằng cùng phong cách. |
| Dataset selector trong một số ảnh không có warehouse | Giữ hai selector global riêng theo contract; dataset luôn thuộc warehouse. |
| Ảnh hiển thị model cũ hoặc deterministic | Chỉ là dữ liệu minh họa; model runtime cấu hình qua environment, không cố định theo ảnh. |
| Prompt yêu cầu tự xây hoàn chỉnh | Là đặc tả đích, không là lệnh bắt đầu code trong phiên tài liệu này. |

## Baseline quyết định

Tài liệu contract hiện tại là baseline `1.0.0` do phiên chuẩn bị tổng hợp; không có nghĩa ba service đã ký duyệt hoặc chạy tương thích. Trước khi tách code, mỗi vai trò review model/fixtures thuộc phạm vi mình và ghi nhận tại gate C0. Khi C0 đạt, dùng cùng commit contract cho cả ba luồng. Không cần hỏi lại các quyết định đã rõ; chỉ nêu điểm chưa giải được ảnh hưởng contract.

Không đưa người dùng vào một approval flow bổ sung để làm các bước chuẩn bị thông thường. Việc chốt C0 là kiểm tra tương thích kỹ thuật, không phải yêu cầu xin phép thực hiện task đã được giao.
