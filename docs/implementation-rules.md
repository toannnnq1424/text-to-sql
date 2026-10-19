# Quy tắc triển khai trực tiếp tới target cuối

Áp dụng bắt buộc cho mọi module và conversation khi được giao triển khai. Tài liệu này ghi nguyên tắc bổ sung trực tiếp của người dùng ngày 2026-10-19; không tự khởi động code trong phiên chuẩn bị tài liệu.

## Target và tính hoàn chỉnh

Không chia version. Ngay trong lần triển khai được giao, hệ thống phải hỗ trợ hoàn chỉnh nhiều loại analytical warehouse/database theo target đã xác định: PostgreSQL, MySQL và SQL Server. Phát triển trực tiếp tới target cuối trong các prompt, sau các điều chỉnh scope được người dùng chấp thuận.

Không được phát triển theo kiểu:

- version 1 rồi version 2;
- skeleton trước rồi hoàn thiện sau;
- tạo framework/abstraction trước nhưng để implementation chính cho giai đoạn sau;
- tạo endpoint placeholder;
- tạo màn hình placeholder;
- để TODO cho các chức năng cốt lõi;
- mock một chức năng rồi mô tả như đã hoàn thành;
- chỉ làm happy path trước rồi để validation, error handling, security hoặc test cho giai đoạn sau;
- implement một phần target rồi ghi các phần còn lại là future work, roadmap hoặc extension point.

Nguyên tắc bắt buộc:

- Làm module nào thì module đó phải hoàn chỉnh trong phạm vi đã cam kết.
- Code đến đâu phải có implementation thật đến đó.
- Mỗi chức năng phải đi kèm validation, error handling và test cần thiết.
- Nếu một abstraction được tạo ra cho một chức năng bắt buộc thì implementation tương ứng cũng phải được hoàn thành.
- Không được tạo class/interface chỉ để “chuẩn bị cho tương lai” nếu target hiện tại yêu cầu chức năng đó hoạt động.
- Không được báo một chức năng là hoàn thành nếu mới chỉ có UI, API contract, mock hoặc stub.
- Không được để phần tích hợp giữa các module đến một “version sau”.
- Không được giảm scope đã cam kết chỉ để sản phẩm chạy demo.

## Ảnh mock là chuẩn phong cách UI

“Mock images” là các ảnh tham chiếu do người dùng cung cấp, dùng để tuân theo style, bố cục, typography, spacing, màu sắc, sidebar cố định và các tương tác/thành phần UI phù hợp ngay từ bước dựng đầu. Không có nghĩa là truyền dữ liệu giả vào giao diện, hard-code số liệu trong ảnh hoặc dựng một bản demo bằng dữ liệu giả.

Giao diện sản phẩm phải dùng dữ liệu từ API Java và warehouse/dataset đã đăng ký. Không có dữ liệu thì hiển thị empty state đúng thiết kế; API lỗi thì hiển thị error state. Không chèn dữ liệu giả để che integration chưa hoàn chỉnh hoặc làm màn hình có vẻ đã hoạt động. Nội dung trong ảnh không bắt core cố định domain thương mại điện tử.

## Test doubles và phát triển song song

Mock/stub/fixture chỉ là công cụ kiểm thử cô lập hoặc hỗ trợ tạm thời khi phối hợp song song theo contract, nếu task cần; không phải yêu cầu dữ liệu của giao diện sản phẩm. Chúng phải được tách trong test/dev có chủ đích, không là implementation của chức năng bắt buộc, không fallback âm thầm trong runtime, và không là bằng chứng hoàn thành.

FE/BE/AI bắt đầu song song sau khi chốt contract. Mỗi chức năng phải có implementation, validation, error handling, security liên quan và test cần thiết ngay trong cùng phạm vi công việc; test doubles chỉ cô lập dependency, không cho phép trì hoãn phần implementation do mình phụ trách. Tích hợp thật và E2E thuộc cùng lần triển khai, không đẩy sang version sau. Gate C0–C4 là điểm kiểm chứng phụ thuộc và bằng chứng tích hợp, không là các phiên bản sản phẩm hoặc lý do tách validation/security/test sang cuối.

DeterministicModelClient là chức năng offline được yêu cầu riêng, phải implement thật đúng phạm vi đó. Nó không thay thế feature gọi provider API thật hoặc chứng minh chất lượng AI production. Sample database/generator đã provision thật có thể dùng cho demo/evaluation với nguồn gốc rõ ràng; khác với response UI giả làm như warehouse đã trả dữ liệu.

## Scope và hướng mở rộng

SQL Import chỉ phát triển sau nếu thực sự cần, theo quyết định trực tiếp đã có của người dùng; local training là tùy chọn và không thay ưu tiên provider API. Các mục này có thể lưu ở future-extensions.md vì người dùng đã xác định ngoài scope chính. Không được chuyển một chức năng bắt buộc khác sang file đó để né hoàn thành target.

Version của contract, schema, semantic model, API namespace hoặc dependency không phải cách chia phiên bản sản phẩm để trì hoãn target. Đọc cùng scope.md và acceptance.md; báo blocker trung thực, không biến blocker thành lý do tuyên bố phần chưa triển khai đã hoàn tất.
