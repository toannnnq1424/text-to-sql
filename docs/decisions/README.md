# Decision log — baseline 2026-10-19

Các quyết định dưới đây tổng hợp yêu cầu người dùng và lựa chọn thiết kế của phiên chuẩn bị. Contract là baseline cần cross-role review tại C0, không ghi như đã có ba implementation ký duyệt.

| ID | Quyết định | Lý do / tác động |
|---|---|---|
| D001 | Monorepo frontend/backend/ai-service/data/infra và shared docs/contracts | Một nguồn contract, giao conversation riêng rõ ownership |
| D002 | React chỉ Java; Java security/execution; Python candidate-only | Không bypass security hoặc lộ warehouse credentials |
| D003 | Warehouse/Dataset/Query canonical + strict engine enum | Tránh ba prompt thành ba model không tương thích |
| D004 | Contract trước, sau đó FE/BE/AI song song | Java bắt đầu từ ngày đầu, mocks theo cùng baseline |
| D005 | Cả ba engines là target nghiệm thu bắt buộc | Không PostgreSQL-only rồi để vendor khác future work |
| D006 | UI shell canonical ảnh 01–10; 11–14 bổ sung | Giải quyết ảnh lặp, giữ sidebar cố định và active route đúng |
| D007 | Domain content metadata-driven; home platform overview | Không copy e-commerce business assumptions từ ảnh |
| D008 | API AI trước, deterministic offline có nhãn; local training optional | Đạt feature tích hợp nhanh và CI tái lập |
| D009 | Warehouse provisioning ngoài app; SQL Import optional nếu cần | Theo điều chỉnh trực tiếp mới nhất; supersede prompt import DoD |
| D010 | Lưu đủ sáu nguồn data và cả 14 ảnh | Theo yêu cầu người dùng; ảnh được phép commit |
| D011 | Decimal/BIGINT string, bounded result snapshot, chart allowlist | Giữ precision, giới hạn tài nguyên, paging/export nhất quán |
| D012 | Repo GitHub tên text-to-sql; ban đầu private, đã chuyển public theo yêu cầu người dùng ngày 2026-10-19 | Yêu cầu trực tiếp mới nhất supersede lựa chọn private ban đầu |
| D014 | Ảnh mock chỉ là chuẩn style UI, không yêu cầu dữ liệu giả vào sản phẩm | Sửa cách diễn đạt cũ; runtime dùng API thật, test doubles tách riêng |
| D015 | Không chia version; module hoàn chỉnh với implementation thật, validation/error/security/tests và tích hợp trong cùng lần triển khai | Quy tắc người dùng bổ sung, chi tiết tại implementation-rules.md; không giảm scope hoặc hoãn target vào future work |
| D013 | PostgreSQL metadata store tách warehouse, auth OIDC/JWT + resource scopes | Quyết định kiến trúc đề xuất để triển khai; cấu hình cụ thể review ở C0 |

Khi thay đổi: ghi ID mới/điều gì supersede, lý do, field/API/role/fixture bị ảnh hưởng và evidence validation; sửa docs liên quan cùng PR. Không sửa archive prompt để làm như nguồn gốc đã nói điều khác.
