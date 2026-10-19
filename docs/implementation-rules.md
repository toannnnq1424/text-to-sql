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

## Cấm để lại skeleton và báo cáo sai mức hoàn thành

Không được kết thúc task ở trạng thái chỉ dựng cấu trúc, form, route, endpoint, interface, service rỗng, pipeline mẫu hoặc happy path rồi để phần triển khai thật cho task/lần sau. Quy tắc này áp dụng cả khi skeleton biên dịch được, trả dữ liệu Chinook, hoặc UI gọi được API: những điều đó không tự chứng minh chức năng tổng quát đã hoàn thành.

Trước khi sửa, đối chiếu code hiện có với target/acceptance và ghi nhận phần thiếu. Khi nhận một module, hoàn thành luồng end-to-end đã cam kết trong phạm vi đó ngay lần làm này: đầu vào thật → validation/authorization → xử lý nghiệp vụ → persistence/warehouse thật → trạng thái/kết quả/lỗi → UI/API caller → kiểm thử tích hợp phù hợp. Mọi abstraction bắt buộc phải có implementation hoạt động và consumer thật. Không để TODO, endpoint/screen placeholder, fixture runtime, dữ liệu mẫu hoặc script riêng cho một dataset đứng thay module tổng quát.

Chỉ được báo PASS khi có bằng chứng đường chạy thật đối với acceptance liên quan; test unit, build, contract, screenshot tĩnh hay demo một nguồn không đủ để tuyên bố module hoàn tất. Nếu chưa thể hoàn thành do blocker khách quan, báo phần đã làm và phần còn thiếu là INCOMPLETE/BLOCKED, nêu nguyên nhân cụ thể; không đổi tên trạng thái thành “đã dựng”, không ghi như đã hoàn thành, và không chuyển phần bắt buộc sang roadmap/future work. Không mở task triển khai khác như cách né phần dang dở đã nhận.

## Ảnh mock là chuẩn phong cách UI

“Mock images” là các ảnh tham chiếu do người dùng cung cấp, dùng để tuân theo style, bố cục, typography, spacing, màu sắc, sidebar cố định và các tương tác/thành phần UI phù hợp ngay từ bước dựng đầu. Không có nghĩa là truyền dữ liệu giả vào giao diện, hard-code số liệu trong ảnh hoặc dựng một bản demo bằng dữ liệu giả.

Giao diện sản phẩm phải dùng dữ liệu từ API Java và warehouse/dataset đã đăng ký. Không có dữ liệu thì hiển thị empty state đúng thiết kế; API lỗi thì hiển thị error state. Không chèn dữ liệu giả để che integration chưa hoàn chỉnh hoặc làm màn hình có vẻ đã hoạt động. Nội dung trong ảnh không bắt core cố định domain thương mại điện tử.

## Test doubles và phát triển song song

Mock/stub/fixture chỉ là công cụ kiểm thử cô lập hoặc hỗ trợ tạm thời khi phối hợp song song theo contract, nếu task cần; không phải yêu cầu dữ liệu của giao diện sản phẩm. Chúng phải được tách trong test/dev có chủ đích, không là implementation của chức năng bắt buộc, không fallback âm thầm trong runtime, và không là bằng chứng hoàn thành.

FE/BE/AI bắt đầu song song sau khi chốt contract. Mỗi chức năng phải có implementation, validation, error handling, security liên quan và test cần thiết ngay trong cùng phạm vi công việc; test doubles chỉ cô lập dependency, không cho phép trì hoãn phần implementation do mình phụ trách. Tích hợp thật và E2E thuộc cùng lần triển khai, không đẩy sang version sau. Gate C0–C4 là điểm kiểm chứng phụ thuộc và bằng chứng tích hợp, không là các phiên bản sản phẩm hoặc lý do tách validation/security/test sang cuối.

DeterministicModelClient là chức năng offline được yêu cầu riêng, phải implement thật đúng phạm vi đó. Nó không thay thế feature gọi provider API thật hoặc chứng minh chất lượng AI production. Sample database/generator đã provision thật có thể dùng cho demo/evaluation với nguồn gốc rõ ràng; khác với response UI giả làm như warehouse đã trả dữ liệu.

## Scope và hướng mở rộng

Theo điều chỉnh mới nhất ngày 2026-10-19, SQL Import trực tiếp trong application và data ingestion pipeline đều là module bắt buộc trong target hiện tại. Phải hoàn thiện end-to-end cho PostgreSQL, MySQL, SQL Server; không chuyển import UI/API/parser/cross-dialect mapping, ingestion source/run, validation/security/error handling, job progress/result hoặc tests sang `future-extensions.md`. Upload SQL phải parse subset allowlisted và review plan; không chạy file tùy ý.

`data/chinook/` và `data/scripts/docker_chinook.py` chỉ là fixture/provisioning có provenance để dựng bộ mẫu kiểm thử cố định. Chúng không phải module import tổng quát và không được dùng làm lý do yêu cầu người dùng tạo `data/<source>` cho mỗi warehouse. Warehouse có sẵn phải dùng luồng registry/connection/discovery; import do người dùng khởi chạy phải dùng workflow chung trong application, lưu run/metadata theo contract. Chỉ thêm folder riêng khi repository thực sự phân phối một sample dataset được pin/versioned, kèm nguồn, giấy phép, checksum và cách tái tạo.

Local inference/training vẫn là tùy chọn và không thay ưu tiên provider API. Các hướng mở rộng khác chỉ lưu ở future-extensions.md khi người dùng xác định chúng ngoài scope chính. Không được chuyển một chức năng bắt buộc còn thiếu sang tài liệu đó để né hoàn thành target.

Version của contract, schema, semantic model, API namespace hoặc dependency không phải cách chia phiên bản sản phẩm để trì hoãn target. Đọc cùng scope.md và acceptance.md; báo blocker trung thực, không biến blocker thành lý do tuyên bố phần chưa triển khai đã hoàn tất.
