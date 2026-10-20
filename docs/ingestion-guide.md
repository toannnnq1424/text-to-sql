# Hướng dẫn nạp dữ liệu

## Chọn đúng cách nạp

- **Nạp file**: đưa toàn bộ CSV, Excel, JSON, Parquet và các định dạng được liệt kê trên màn hình vào warehouse. App nhận diện cột, cho xem trước, tạo bảng và đăng ký dataset sau khi nạp thành công.
- **Nguồn warehouse**: lấy dữ liệu từ một kết nối database đã đăng ký, rồi chuyển vào các bảng đích đã chuẩn bị. Lưu nguồn một lần để dùng lại; không nhập từng bản ghi.
- **SQL Import**: nhập file SQL qua kiểm tra và kế hoạch xác nhận riêng. App không chạy nguyên văn file SQL bất kỳ.

Nếu chưa có kết nối database, vào **Warehouses** để thêm kết nối, kiểm tra và khám phá metadata. Dataset xác định những bảng/schema được phép dùng; đây không phải mật khẩu hoặc một kết nối khác.

## Đăng ký nguồn database trong ba bước

Trong **Nạp dữ liệu → Nguồn warehouse**, bấm **Đăng ký nguồn**.

1. **Chọn dữ liệu**: chọn kết nối nguồn, dataset và bảng từ danh sách thật. Mặc định lấy các cột của bảng; mở **Chọn cột cần lấy** để bỏ cột không cần. Bấm **Xem trước và tiếp tục** để Java tạo SELECT đúng dialect, kiểm tra quyền/SQL và đọc tối đa 20 dòng. Tên và kiểu cột được nhận diện tự động, kể cả khi bảng rỗng. Nếu cần lọc, tổng hợp hoặc ghép bảng, chọn **Dùng SQL nâng cao**; không phải nhập lại alias và kiểu của từng cột.
2. **Chọn nơi nhận**: đặt tên nguồn dễ nhớ, chọn kết nối/dataset đích và bốn bảng có sẵn. Danh sách lấy từ metadata thật bằng tài khoản ingestion trong các schema dataset cho phép. Bốn bước được giải thích ngay trên màn hình: dữ liệu gốc (Raw), dữ liệu chuẩn hóa (Staging), kho dữ liệu (Warehouse), dữ liệu phân tích (Mart). Mỗi bước cần một bảng riêng, có tên/kiểu cột khớp kết quả nguồn. Quy tắc cột không trống, độ dài chuỗi, số dòng/dung lượng/thời gian chờ nằm trong phần nâng cao.
3. **Kiểm tra và lưu**: xem lại nguồn, đích, cột và SELECT. Bấm **Kiểm tra nguồn và bảng đích**. Chỉ khi kiểm tra đạt mới bật **Lưu nguồn dữ liệu**. Đổi cấu hình phải kiểm tra lại. Lưu chỉ ghi cấu hình; chưa chuyển dữ liệu.

Sau khi lưu vào warehouse/dataset đang chọn, nguồn mới được chọn sẵn ở **Nguồn dữ liệu**. Bấm **Chạy pipeline mới** để nạp, rồi theo dõi từng bước và lịch sử. Nếu lưu vào warehouse/dataset khác, chọn đích tương ứng ở thanh đầu trang trước khi chạy.

Quản trị viên đăng ký/sửa/kiểm tra nguồn. Người vận hành có thể chạy nguồn đã được cấp quyền. Kết nối nguồn chỉ đọc; tài khoản ghi do máy chủ quản lý và không được gửi cho trình duyệt hoặc AI.

## Khi chưa thể tiếp tục

- **Không có bảng nguồn**: kiểm tra dataset/allowlist, kết nối và quyền đọc; đổi kết nối sẽ xóa lựa chọn dataset/bảng cũ để tránh dùng nhầm nguồn.
- **Không tải được bảng đích**: quản trị viên kiểm tra ingestion writer và quyền metadata trong warehouse đích.
- **Bảng đích không khớp**: chọn bốn bảng có tên/kiểu cột đúng với dữ liệu nguồn. Luồng nguồn database sử dụng bảng đã chuẩn bị, không tự tạo hoặc cấp thêm quyền; nếu dữ liệu nằm trong file và cần tạo bảng mới, dùng **Nạp file**.
- **Nguồn vượt giới hạn**: thu hẹp SELECT hoặc điều chỉnh giới hạn trong phạm vi máy chủ cho phép. Không tự cắt dữ liệu rồi báo nạp toàn bộ thành công.
- **Kiểm tra thất bại**: cấu hình chưa được lưu. Xem lỗi, quay lại bước liên quan và kiểm tra lại; không tự chạy pipeline khi chỉ mới lưu nguồn.

Contract API, giới hạn và ranh giới ghi được mô tả ở [public API](contracts/public-api.md), [file ingestion](contracts/file-ingestion.md) và [security](security.md).
