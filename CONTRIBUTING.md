# Quy trình đóng góp

Đọc AGENTS.md, [implementation-rules.md](docs/implementation-rules.md), acceptance và role tương ứng trước khi làm. Repository có ứng dụng React, Spring Boot, Python AI service, data provisioning và Docker Compose; thay đổi runtime phải kiểm tra caller thật trong phạm vi được giao.

- Nhánh công việc dùng `module/<scope>`. Mỗi task nêu ownership, contract baseline, acceptance.
- Shared API/model/schema changes cần cập nhật docs/contracts + fixtures + impacted role notes cùng PR trước khi consumers lệ thuộc; không duy trì ba contract riêng.
- Prompt `.txt` là archive giữ nguyên; thay đổi yêu cầu ghi scope/decision log.
- Thêm ảnh cần provenance; 14 ảnh hiện tại đã được người dùng cho phép. Bulk data/binaries/keys không commit mặc định.
- PR mô tả kết quả hành vi, contract/data/security/visual tác động thực tế, evidence tests và phần chưa chạy. Không list PASS cho test chưa chạy.
- Task tài liệu kiểm tra link local, JSON parse, manifest hashes, nội dung xung đột; runtime task dùng acceptance matrix. Không tạo test app giả cho thay đổi docs.
- Format toàn bộ file nguồn liên quan theo [quy tắc code style](docs/code-style.md); tránh các dòng chứa nhiều lệnh hoặc module bị nén thành một dòng.
- `.env` thật ignored; nếu cần `.env.example` chỉ có safe dummy values. Không log/token/provider key trong PR.
- Chưa chọn open-source license; không tự gán license cho mã/ảnh/dataset của người khác.

## Nhật ký sau mỗi commit/push

Bắt buộc đọc và cập nhật `docs/work-log.md` trong mỗi commit công việc: vai trò/conversation, thời gian UTC+07, nhánh, phạm vi đã làm, trạng thái thực, checks và phần còn thiếu/phụ thuộc. Sau push kiểm tra SHA local/remote và báo trong bàn giao. Không claim tích hợp hoàn thành bằng mock/UI/contract; không ghi secrets. Entry của chính commit dùng subject + branch thay hash tự tham chiếu.
