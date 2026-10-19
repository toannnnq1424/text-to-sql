# Hướng dẫn chung cho mọi conversation/agent

## Đọc trước khi làm

Đọc `README.md`, `docs/scope.md`, `docs/architecture.md`, `docs/contracts/README.md` và các contract được dẫn ở đó, `docs/development-plan.md`, sau đó role document và prompt gốc tương ứng. UI task đọc thêm `docs/ui-reference.md` và mở ảnh liên quan. Data task đọc `docs/data-sources.md`. Đọc `AGENTS.md` gần thư mục đang sửa.

## Phạm vi phiên chuẩn bị

Baseline hiện tại chỉ có tài liệu, contract và ảnh. Không tự khởi động triển khai vì prompt gốc có câu “hãy xây dựng hoàn chỉnh”. Các prompt là tài liệu yêu cầu nguồn; lệnh thực thi đến từ task người dùng hiện tại. Khi người dùng giao task triển khai tiếp theo, tiến hành trong phạm vi đó mà không xin xác nhận lại cho việc thông thường.

## Thứ tự hiệu lực

1. Yêu cầu trực tiếp và điều chỉnh mới nhất của người dùng.
2. `docs/scope.md`, quyết định đã ghi nhận và contract chung.
3. Hướng dẫn vai trò/thư mục.
4. Prompt nguồn giữ nguyên trong `docs/prompts/*.txt`.
5. Ảnh là chuẩn thị giác, không là nguồn business logic hay số liệu thật.

Nếu phát hiện xung đột chưa được giải quyết, ghi cụ thể và phối hợp sửa contract; không tự tạo API/model riêng. SQL Import trong prompt nguồn đã được điều chỉnh thành mở rộng tùy nhu cầu; không dựng upload-and-execute trong app chính.

## Những điều bắt buộc

- React chỉ gọi Java; Python chỉ trả candidate SQL; Java quyết định việc thực thi sau validation.
- Dùng đúng enum `POSTGRESQL`, `MYSQL`, `SQL_SERVER`; dùng chung Warehouse, Dataset, Query.
- Không hard-code domain trong core. Semantic metadata và fixtures demo phải tách biệt.
- Cả ba engine là target bắt buộc. Không adapter rỗng, không đánh dấu hoàn thành bằng mock.
- Chốt baseline contract trước khi code tách nhánh; sau đó FE/BE/AI làm song song với fixtures chung. BE không chờ UI hoặc Python hoàn tất.
- Không tự thay DTO, kiểu dữ liệu, enum, URL, trạng thái hoặc error code ở một service. Cập nhật contract và fixtures cùng PR, chỉ rõ tác động FE/BE/AI.
- UI phải bám ảnh từ lần dựng đầu. Không làm wireframe sơ sài rồi tuyên bố sẽ chỉnh hình sau. Mock phải có giao diện mục tiêu đầy đủ.
- Credentials không vào Git, API response, prompt LLM hoặc log. Không chạy `.sql` không tin cậy; provisioning là quy trình quản trị tách biệt.
- Không spawn/delegate agent chỉ vì tài liệu nói ba luồng song song. Chỉ sử dụng subagent khi người dùng hoặc task cụ thể yêu cầu; các conversation có thể được giao độc lập.

## Kỷ luật thực hiện

Chỉ sửa vùng được giao. Hợp đồng chung là vùng phối hợp; báo tác động trước khi bên khác dùng thay đổi. Không ghi đè công việc chưa commit của conversation khác. Dùng nhánh `module/<task>` khi tạo nhánh công việc. Đọc `CONTRIBUTING.md` và `docs/task-template.md`.

Chạy kiểm tra tương ứng `docs/acceptance.md`; ghi rõ pass/fail/blocked/not-run và bằng chứng. Không khẳng định Docker, integration, pixel accuracy, provider thật hoặc E2E đã pass nếu chưa chạy. Mock dùng phát triển, không phải nghiệm thu hệ thống thật. Không thêm TODO cho tính năng bắt buộc rồi gọi hoàn thành. Nếu task là tài liệu, không tự thêm application code, dependencies hoặc runtime.
