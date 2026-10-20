# Source kits được nhập vào dự án

Hai thư mục chứa toàn bộ snapshot người dùng cung cấp (ngoại trừ một `.env` ví dụ):

- `semantic-engine/`: semantic/native engine, Python SDK/CLI, servers, tests và examples.
- `data-tool-platform/`: source/tool framework, native driver factories, server, tests và configs.

Tổng417.117 dòng code theo inventory; source kits có nhiều khả năng hơn phần đang được ứng dụng sử dụng. SDK semantic được cài trực tiếp từ source này và Go executor import trực tiếp native factories từ source module này. Các server/connector còn lại chưa tự được kích hoạt.

Đọc [bản đồ caller/build/tests và phần chưa bật](../../docs/integrations/full-source-adoption.md), [inventory gốc](../../docs/integrations/full-source-inventory.json) và [các integration patches](../../docs/integrations/full-source-patches.json). Chạy `python3 infra/upstream/verify.py` sau sửa. Giữ nguyên license/notice và attribution bắt buộc. Branding, examples và hướng dẫn upstream trong snapshot không phải UI hoặc cấu hình deployment của sản phẩm.
