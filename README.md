# Natural Language Analytics Warehouse

Nền tảng Text-to-SQL đa warehouse, đa domain: đặt câu hỏi tiếng Việt/Anh, nhận dữ liệu, biểu đồ, SQL, giải thích và thông tin thực thi.

**Trạng thái: đã chuẩn bị tài liệu, chưa triển khai ứng dụng.** Không có lệnh chạy app ở thời điểm này. Các API, mô hình và kiểm thử dưới đây là đặc tả mục tiêu, chưa phải tính năng đã chạy. Ngày lập baseline: 2026-10-19.

```text
React → Java Spring Boot → Python AI Service → LLM API
                ↓
       PostgreSQL / MySQL / SQL Server
```

React chỉ gọi Java. Java là security boundary và nơi thực thi SQL. Python chỉ trả candidate SQL; không nhận credential warehouse, không truy cập warehouse production.

## Bắt đầu một conversation mới

1. Đọc [AGENTS.md](AGENTS.md), [phạm vi và ưu tiên](docs/scope.md), [kiến trúc](docs/architecture.md).
2. Đọc [domain contract](docs/contracts/domain.md), [public API](docs/contracts/public-api.md), [Java ↔ Python](docs/contracts/java-python.md), [semantic model](docs/contracts/semantic-model.md).
3. Đọc hướng dẫn theo vai trò: [FE](docs/roles/fe.md), [BE](docs/roles/be.md), [AI/Data](docs/roles/ai-data.md), rồi prompt gốc tương ứng trong [docs/prompts](docs/prompts/README.md).
4. Đọc [kế hoạch phối hợp](docs/development-plan.md) và [ma trận nghiệm thu](docs/acceptance.md). Chỉ triển khai khi được giao task triển khai.

Mẫu giao việc:

> Đọc AGENTS.md, docs/roles/be.md và các contract liên quan. Thực hiện task BE được giao theo contract chung; báo thay đổi contract trước khi phụ thuộc vào nó. Không triển khai thay phần FE/AI.

Tương tự thay `be.md` bằng `fe.md` hoặc `ai-data.md`. `AGENTS.md` trong từng thư mục tự bổ sung quy tắc cho phần đó.

## Nguyên tắc đã thống nhất

- Chốt `Warehouse`, `Dataset`, `Query` và Java → Python trước khi tách việc; không cầm ba prompt rồi tự thiết kế ba hệ thống riêng.
- Sau gate contract, React, Java và Python bắt đầu song song từ cùng baseline với mock hợp đồng. Java bắt đầu từ ngày đầu.
- Target cuối bao gồm cả PostgreSQL, MySQL, SQL Server; các mốc tích hợp không phải cách trì hoãn engine hay chia phiên bản sản phẩm.
- UI bám ảnh từ bước dựng đầu; sidebar cố định trên desktop và thống nhất trên mọi route. Dữ liệu/domain lấy từ API.
- AI ưu tiên gọi provider API; deterministic mode phục vụ CI/demo; local inference/training là hướng mở rộng.
- App kết nối warehouse đã tồn tại. SQL Import là mở rộng tùy nhu cầu, không là điều kiện hoàn thành phạm vi chính.

## Bản đồ tài liệu

| Tài liệu | Nội dung |
|---|---|
| [Scope](docs/scope.md) | Yêu cầu hiệu lực, xử lý mâu thuẫn prompt |
| [Architecture](docs/architecture.md) | Ranh giới, module, ownership |
| [Contracts](docs/contracts/README.md) | Model, API, lỗi, fixtures dùng chung |
| [UI reference](docs/ui-reference.md) | 14 ảnh, route, thứ tự ưu tiên, tiêu chí thị giác |
| [Data sources](docs/data-sources.md) | Đủ 6 nguồn người dùng cung cấp và cách sử dụng |
| [Security](docs/security.md) | SQL, credential, auth, giới hạn thực thi |
| [Development plan](docs/development-plan.md) | Gate và task song song |
| [Acceptance](docs/acceptance.md) | Bằng chứng hoàn thành từng phần và E2E |
| [Future extensions](docs/future-extensions.md) | SQL Import có kiểm soát, local AI/training |
| [Decision log](docs/decisions/README.md) | Quyết định baseline và điều kiện thay đổi |
| [Task template](docs/task-template.md) | Giao task cho conversation mới |
| [Contributing](CONTRIBUTING.md) | Quy trình thay đổi và PR |

Thư mục dự kiến: `frontend/`, `backend/`, `ai-service/`, `data/`, `infra/`. Hiện chỉ chứa hướng dẫn; chưa tạo scaffold ứng dụng. Ảnh gốc đã được người dùng cho phép đưa lên GitHub, lưu trong [images](images/README.md). Không kèm bộ dữ liệu bên thứ ba hoặc secrets. Repository chưa chọn giấy phép phát hành mã nguồn.
