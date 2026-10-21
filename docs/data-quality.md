# Kiểm tra chất lượng dữ liệu

Mở **Chất lượng dữ liệu** trong sidebar và chọn warehouse/dataset. Màn này kiểm tra bảng thật bằng tài khoản chỉ đọc; không sửa, xóa hay tự làm sạch dữ liệu. ADMIN/OPERATOR có resource grant được cấu hình và chạy; VIEWER/ANALYST có grant xem quy tắc/lịch sử.

## Tạo và chạy quy tắc

1. Chọn **Thêm quy tắc**, đặt tên và chọn bảng/cột từ catalog của dataset hiện tại.
2. Chọn phép kiểm tra và điền giới hạn/danh sách/tham chiếu phù hợp trong bảng bên dưới.
3. Áp dụng vào bản nháp rồi **Lưu bộ quy tắc**. Revision conflict yêu cầu tải lại; không tự ghi đè thay đổi của người khác.
4. **Chạy kiểm tra** dùng bộ đã lưu. Server trả run ID và chạy nền; giao diện cập nhật tiến độ/kết quả theo từng quy tắc. Đổi dataset không chuyển cuộc chạy sang dataset mới.
5. Mở lịch sử để xem snapshot định nghĩa và số đếm lúc chạy; đổi quy tắc không thay kết quả cũ.

| Loại kiểm tra | Ý nghĩa số đếm |
|---|---|
| Không null | Số dòng có giá trị null ở cột đã chọn |
| Không trùng | Số bản ghi dư sau khi bỏ trùng, bỏ qua null; ba giá trị A,A,A có hai bản ghi dư |
| Trong miền số | Số giá trị không null nằm ngoài cận bao gồm min/max; dùng quy tắc không null riêng nếu cần |
| Giá trị cho phép | Số chuỗi không null ngoài danh sách; so sánh theo collation của database |
| Số dòng | Một assertion về tổng dòng, không phải số dòng dữ liệu lỗi; observed value là số dòng thật |
| Tham chiếu tồn tại | Số giá trị nguồn không null không tìm thấy ở cột tham chiếu; khóa đích trùng không nhân số đếm |

**PASSED**: tất cả quy tắc bật đạt. **FAILED**: có dữ liệu vi phạm. **ERROR**: thiếu quyền, schema thay đổi, mất kết nối, timeout hoặc dừng tiến trình khiến việc kiểm tra không hoàn tất; phần chưa kiểm không bị điền0. Lịch sử giữ phần đã chạy và lỗi an toàn. Dữ liệu có thể đổi giữa các quy tắc (`PER_CHECK`), không phải snapshot transaction chung của toàn warehouse.

## Phạm vi và vận hành

Tối đa20 quy tắc/bộ, mỗi statement tối đa15s và tổng run tối đa120s, hàng đợi có giới hạn. Aggregate đọc toàn bộ bảng được phép trong ngân sách, không lấy mẫu rồi trình bày như toàn bộ dữ liệu. Decimal/count là chuỗi chính xác; cận số dùng precision tối đa38/scale18, số dòng0..9223372036854775807. Binary/complex types không được dùng ở phép so sánh không hỗ trợ. Không nhập SQL tùy ý.

Sau restart, run dở được ghi ERROR thay vì tự chạy lại; các run hoàn tất và quy tắc vẫn còn. Khi schema đổi phải sửa quy tắc theo catalog mới; không tự đổi sang cột gần tên. Run chất lượng không gọi model AI và không đưa hàng dữ liệu vào prompt/memory.

[Contract, giới hạn và acceptance](contracts/data-quality.md), [nhật ký kiểm chứng thực](work-log.md). Độ tin cậy của bảng không bảo đảm SQL do AI sinh đúng ý nghiệp vụ; ngữ nghĩa, quyền và validation của truy vấn vẫn được kiểm riêng.
