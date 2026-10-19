# Mẫu giao việc cho conversation mới

Copy và điền scope, không giao cả ba prompt làm ba codebase tự thiết kế.

```text
Đọc AGENTS.md, docs/scope.md, docs/roles/<fe|be|ai-data>.md,
AGENTS.md trong thư mục phụ trách, các contract liên quan và prompt nguồn tương ứng.

Task:
Contract baseline commit:
Gate C0 status / điểm cần hoàn tất trước khi code độc lập:
Ownership (allowed paths):
Dependencies / shared fixtures:
User-facing outcome:
Acceptance scenarios:
Checks cần chạy:
Out of scope:

Thực hiện task trong scope đã giao. Không tự đổi shared contract, enum, API hoặc demo
schema khác các vai trò. Nếu có gap, mô tả cụ thể và cập nhật shared docs/fixtures
phối hợp trước khi tạo consumer riêng. Dùng mock theo contract khi integration chưa sẵn.
Báo thay đổi, evidence, checks not run và blocker; không claim E2E bằng mock.
```

Ví dụ task đầu sau C0:

- FE: shell + Query Workspace/Result sát ảnh 01/02/03/07/09, MSW theo shared fixture, scope frontend.
- BE: registry + query pipeline + adapter contract cho cả ba engines với mock AI, scope backend và infra đã thống nhất.
- AI/Data: FastAPI contract + configurable provider API client + deterministic fixtures + thống nhất canonical data/evaluation cùng BE, scope ai-service/data.

Các task có thể chạy đồng thời sau C0. Không có nghĩa phiên tài liệu này tự tạo chat/agent hay bắt đầu implementation. Khi giao sửa contract, phải bao gồm impact review của cả ba vai trò, không chỉ đổi body trong một file.
