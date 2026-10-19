# Hướng dẫn chung cho mọi conversation/agent

## Đọc trước khi làm

Đọc `README.md`, `docs/scope.md`, `docs/implementation-rules.md`, `docs/architecture.md`, `docs/contracts/README.md` và các contract được dẫn ở đó, `docs/development-plan.md`, sau đó role document và prompt gốc tương ứng. UI task đọc thêm `docs/ui-reference.md` và mở ảnh liên quan. Data task đọc `docs/data-sources.md`. Đọc `AGENTS.md` gần thư mục đang sửa.

## Trạng thái hiện tại

Repository đang có frontend, backend, Python AI service, data provisioning, Docker Compose và các bài kiểm chứng. Các prompt gốc là yêu cầu nguồn, không tự phát sinh task ngoài yêu cầu hiện tại. Tiếp tục phát triển theo chỉ đạo người dùng và cập nhật trạng thái sau mỗi commit/push.

## Thứ tự hiệu lực

1. Yêu cầu trực tiếp và điều chỉnh mới nhất của người dùng.
2. `docs/scope.md`, quyết định đã ghi nhận và contract chung.
3. Hướng dẫn vai trò/thư mục.
4. Prompt nguồn giữ nguyên trong `docs/prompts/*.txt`.
5. Ảnh là chuẩn thị giác, không là nguồn business logic hay số liệu thật.

Nếu phát hiện xung đột chưa được giải quyết, ghi cụ thể và phối hợp sửa contract; không tự tạo API/model riêng. Quyết định SQL Import optional cũ đã được supersede: app phải có import đã validate/preview, không có arbitrary upload-and-execute.

## Những điều bắt buộc

- React chỉ gọi Java; Python chỉ trả candidate SQL; Java quyết định việc thực thi sau validation.
- Dùng đúng enum `POSTGRESQL`, `MYSQL`, `SQL_SERVER`; dùng chung Warehouse, Dataset, Query.
- Không hard-code domain trong core. Semantic metadata và fixtures demo phải tách biệt.
- Cả ba engine là target bắt buộc. Không adapter rỗng, không đánh dấu hoàn thành bằng mock.
- Chốt baseline contract trước khi code tách nhánh; sau đó FE/BE/AI làm song song với fixtures chung. BE không chờ UI hoặc Python hoàn tất.
- Không tự thay DTO, kiểu dữ liệu, enum, URL, trạng thái hoặc error code ở một service. Cập nhật contract và fixtures cùng PR, chỉ rõ tác động FE/BE/AI.
- UI phải tuân theo style/bố cục của ảnh mock người dùng cung cấp ngay từ bước dựng đầu; ảnh mock không có nghĩa là truyền dữ liệu giả lên UI. Giao diện sản phẩm dùng API thật; thiếu dữ liệu/lỗi phải hiển thị state tương ứng, không chèn dữ liệu giả.
- Không hardcode runtime business content (warehouse/dataset identity, schema/category counts, descriptions, query/result values) trong React hoặc bootstrap rồi trình bày như live data. Lấy physical state từ database APIs; semantic content phải lấy từ active semantic API/config, có provenance và empty state khi chưa cấu hình. Static labels/icons/layout constants được phép; fixtures chỉ dành cho tests.
- Login/OIDC, role/resource authorization, in-app SQL Import đã validate/preview và data ingestion đều là scope bắt buộc. Không chuyển chúng thành future extension; không execute arbitrary SQL file.
- Tuân thủ đầy đủ `docs/implementation-rules.md`: không chia version, không skeleton/placeholder, không trì hoãn implementation, validation, error handling, security, test hoặc tích hợp bắt buộc. Làm module nào hoàn chỉnh module đó trong scope cam kết; không giảm scope để chạy demo.
- Abstraction cho chức năng bắt buộc phải đi kèm implementation thật. UI/contract/mock/stub chưa phải chức năng hoàn thành; không chuyển phần target còn thiếu thành future work/roadmap/extension point.
- Không kết thúc task bằng cấu trúc, interface, endpoint/screen, happy path hoặc fixture Chinook nếu acceptance yêu cầu luồng tổng quát. Đối chiếu acceptance trước khi code; nghiệm thu bằng caller thật, persistence/warehouse thật và test tích hợp. Nếu còn thiếu thì ghi INCOMPLETE/BLOCKED cùng nguyên nhân, tuyệt đối không mô tả phần dựng khung như feature đã xong hoặc né phần còn thiếu bằng cách chuyển sang task khác.
- `data/chinook/` là sample có provenance, không phải khuôn bắt người dùng thêm folder mỗi lần kết nối/nạp warehouse. Kết nối database có sẵn đi qua registry/discovery; import do người dùng thực hiện phải đi qua module chung trong app. Chỉ thêm thư mục nguồn khi repo phân phối thêm sample dataset có provenance đầy đủ.
- Credentials không vào Git, API response, prompt LLM hoặc log. Không chạy `.sql` không tin cậy; provisioning là quy trình quản trị tách biệt.
- Không spawn/delegate agent chỉ vì tài liệu nói ba luồng song song. Chỉ sử dụng subagent khi người dùng hoặc task cụ thể yêu cầu; các conversation có thể được giao độc lập.

## Kỷ luật thực hiện

Chỉ sửa vùng được giao. Hợp đồng chung là vùng phối hợp; báo tác động trước khi bên khác dùng thay đổi. Không ghi đè công việc chưa commit của conversation khác. Dùng nhánh `module/<task>` khi tạo nhánh công việc. Đọc `CONTRIBUTING.md` và `docs/task-template.md`.

Chạy kiểm tra tương ứng `docs/acceptance.md`; ghi rõ pass/fail/blocked/not-run và bằng chứng. Không khẳng định Docker, integration, pixel accuracy, provider thật hoặc E2E đã pass nếu chưa chạy. Mock/stub chỉ dùng test hoặc hỗ trợ phối hợp tạm thời khi cần, tách biệt runtime sản phẩm; không thay implementation thật hay nghiệm thu hệ thống. Không thêm TODO cho tính năng bắt buộc rồi gọi hoàn thành. Nếu task là tài liệu, không tự thêm application code, dependencies hoặc runtime.

## Nhật ký sau mỗi commit/push

Bắt buộc đọc và cập nhật `docs/work-log.md` trong mỗi commit công việc: vai trò/conversation, thời gian UTC+07, nhánh, phạm vi đã làm, trạng thái thực, checks và phần còn thiếu/phụ thuộc. Sau push kiểm tra SHA local/remote và báo trong bàn giao. Không claim tích hợp hoàn thành bằng mock/UI/contract; không ghi secrets. Entry của chính commit dùng subject + branch thay hash tự tham chiếu.
