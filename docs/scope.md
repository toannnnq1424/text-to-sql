# Phạm vi và cách đọc yêu cầu

## Trạng thái triển khai

Repository đã có FE/BE/Python services, Chinook trên ba Docker engines và một số đường đi E2E. Đây là trạng thái triển khai đang tiếp tục, chưa phải nghiệm thu đầy đủ sản phẩm. Theo phản hồi người dùng ngày 2026-10-19 sau khi xem UI, các phần login production, in-app SQL Import, độ sát mock, một số logic bộ lọc/layout và việc tải dữ liệu thực đầy đủ vẫn là yêu cầu bắt buộc còn phải hoàn tất. Ghi nhận cụ thể trong [current review](current-review.md) và [acceptance](acceptance.md).

## Quy tắc triển khai bắt buộc

Áp dụng đầy đủ [implementation-rules.md](implementation-rules.md) theo bổ sung trực tiếp của người dùng: không chia version, không skeleton/placeholder, không hoãn implementation/validation/error handling/security/test hoặc tích hợp, không giảm target để chạy demo. Ảnh mock là chuẩn phong cách UI, không yêu cầu dữ liệu giả trong giao diện sản phẩm.

## Mục tiêu chính

Nền tảng đa warehouse/domain, tiếng Việt/Anh, React → Java → Python; Java truy vấn PostgreSQL/MySQL/SQL Server với read-only credential. Bao gồm registry warehouse/dataset, discovery, semantic layer, query, results, catalog, history/audit, đăng nhập và phân quyền, nạp dữ liệu trong ứng dụng, SQL Import có kiểm soát, evaluation, technical monitoring và settings. Các module import/ingestion phải hoạt động thật với ba engines, có preview/validation/progress/result/error/audit; không thay bằng upload UI hoặc pipeline demo. UI phải đẹp và sát ảnh; API provider AI được ưu tiên trước local training.

## Xung đột đã giải quyết

| Nguồn | Chốt áp dụng |
|---|---|
| Prompt FE/BE yêu cầu SQL Import và cross-dialect DDL | Điều chỉnh mới nhất ngày 2026-10-19: SQL Import trực tiếp trong app là module bắt buộc trong target hiện tại. Hỗ trợ upload qua Java, source dialect `AUTO_DETECT`/PostgreSQL/MySQL/SQL Server, target warehouse, native import và cross-dialect subset thông qua parser + canonical schema model + generator. Phải có preview/validation, unsupported-feature errors, progress/result, authorization/audit và kiểm thử cả ba target. Không execute file SQL tùy ý: parse allowlisted DDL/INSERT subset, áp size/time/resource limits, xác nhận plan trước khi chạy. |
| Prompt yêu cầu login và authorization | Login người dùng thật là tiêu chí bắt buộc: cấu hình OIDC authorization-code flow, callback/logout/session expiry và role mapping đồng bộ backend. Local anonymous-read/token-admin chỉ dành cho loopback development, không thay login; không tự xây password store. |
| Prompt dùng “không chia version” | Target nghiệm thu đầy đủ cả 3 engine; được chia task/gate kỹ thuật và phát triển song song, không tuyên bố PostgreSQL-only là hoàn thành. |
| Ảnh có dashboard e-commerce | Giữ layout/phong cách, thay nội dung bằng platform metrics và metadata API; không cố định revenue/orders trong core. |
| Ảnh có sidebar hoặc tab lặp/khác nhau | Dùng shell ảnh 01–10, route map chuẩn trong `ui-reference.md`; ảnh 11–14 chỉ bổ sung chi tiết. Thêm Warehouses theo prompt FE bằng cùng phong cách. |
| Dataset selector trong một số ảnh không có warehouse | Giữ hai selector global riêng theo contract; dataset luôn thuộc warehouse. |
| Ảnh hiển thị model cũ hoặc deterministic | Chỉ là dữ liệu minh họa; model runtime cấu hình qua environment, không cố định theo ảnh. |
| Prompt yêu cầu tự xây hoàn chỉnh | Là target khi được giao triển khai; mọi module mandatory phải có code, validation, error handling, security, test và tích hợp thật trong cùng lần triển khai, không chuyển phần thiếu thành roadmap. |

## Baseline quyết định

Tài liệu contract hiện tại là baseline `1.0.0` do phiên chuẩn bị tổng hợp; không có nghĩa ba service đã ký duyệt hoặc chạy tương thích. Trước khi tách code, mỗi vai trò review model/fixtures thuộc phạm vi mình và ghi nhận tại gate C0. Khi C0 đạt, dùng cùng commit contract cho cả ba luồng. Không cần hỏi lại các quyết định đã rõ; chỉ nêu điểm chưa giải được ảnh hưởng contract.

Không đưa người dùng vào một approval flow bổ sung để làm các bước chuẩn bị thông thường. Việc chốt C0 là kiểm tra tương thích kỹ thuật, không phải yêu cầu xin phép thực hiện task đã được giao.

## Điều chỉnh model settings ngày2026-10-21

Theo yêu cầu trực tiếp mới, ADMIN được cấu hình LLM API key trong application, thay giới hạn cũ chỉ deployment env. Key write-only, encrypted server-side và có quyền/audit/URL policy, không trở thành public settings field. Query UI phải ghi rõ AUTO dùng profile mặc định nào, API chọn profile nào (online hay Ollama local), DETERMINISTIC không gọi AI, structured metric query không LLM. Contract [model providers](contracts/model-providers.md) có hiệu lực cho FE/BE/Python/infra.
