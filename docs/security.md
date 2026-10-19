# Security boundary và dữ liệu

Đặc tả mục tiêu cho triển khai; chưa là khẳng định hệ thống đã an toàn hoặc kiểm thử.

## Query

Java parse AST recursive và resolve identifiers (CTE, subquery, aliases, quoted names), chỉ một SELECT/CTE read-only. Reject DML/DDL, multi statement, comment injection, SELECT INTO, locking/write side effects, vendor export clauses, dangerous functions, filesystem/network/system access, stored procedure CALL/EXEC, cross-dataset/schema references và identifier không resolve được. Không dùng regex làm security layer duy nhất; không coi từ đầu tiên SELECT hoặc JDBC setReadOnly là bằng chứng đủ.

Allowlist theo dataset, kiểm tra physical table/column và semantic rules, giới hạn complexity/joins phù hợp, safe LIMIT/TOP/OFFSET AST-aware không phá ORDER BY. Dialect mismatch phải controlled error; không regex sửa SQL để chạy cho qua. Read-only DB principal với quyền tối thiểu theo engine là lớp bảo vệ riêng. Unknown/dangerous function fail closed. SQL Server read-only phải dùng grants/database policy và credential đúng, không dựa transaction hint giả định.

Baseline configurable server bounds: max 1000 materialized rows, max 5 MiB result payload, statement timeout 15s, tổng deadline 60s. Apply limit +1 khi phù hợp để biết truncated, byte accounting đo dữ liệu thực serializable, không chỉ số hàng. Cancel/close JDBC statement/connection khi timeout; tránh giữ runaway query. Không cho export vượt giới hạn mặc định; nâng limits là quyết định quản trị có audit.

## Principal và network

Java validate token, role và resource-level authorization mọi registry/query/history/catalog/export. Python dùng service auth trên private network; browser không có route generation trực tiếp. Registry host/port không là URL tự do: chỉ admin được cấu hình endpoint, có allowlist/network egress policy để tránh SSRF và truy cập metadata/internal services ngoài warehouse được phép. Cấu hình TLS/verify certificate cho kết nối deployment; không disable SSL verification để sửa lỗi.

## Credentials và logs

Credential reference trỏ secret provider/env binding, không secret trực tiếp trong DTO/log. Query reader khác ingestion writer và provisioning admin. Python không nhận reader/writer credentials. Log correlationId + safe metadata, không API key, token, connection string password, raw provider body hoặc data row nhạy cảm. Question/SQL có thể chứa nội dung nhạy cảm: audit truy cập có hạn quyền, retention policy và redaction, không log tràn toàn bộ mặc định.

## Semantic/AI/UI

Treat question/schema description/examples là untrusted content; system rules không bị prompt injection override. Provider chỉ nhận relevant authorized metadata đã lọc; không gửi data rows/secrets. Python strict JSON, enum/size limit, controlled errors; Java independently validates. FE render text, chart JSON allowlist và references hợp lệ; không executable AI JS/HTML/React. CSV export sanitize spreadsheet formulas cho string cell.

## Ghi dữ liệu

Provisioning/ELT chỉ dùng scripts/pipelines đã review, trusted source, environment/identity riêng. Trigger ingestion không nhận câu SQL tùy ý hoặc URL tải bất kỳ. Idempotency, rejected row accounting và transaction/checkpoint theo engine phải được test. Không có general SQL upload executor trong app chính. SQL Import chỉ xem xét sau ở future-extensions.md.

## Evidence bắt buộc

Security corpus cho cả 3 engines: nested CTE/subquery, quoted identifiers, comments/multi statement, unknown/schema-qualified tables, SELECT INTO/export, function side effects, unauthorized dataset, SQL injection qua question/search/sort/metadata, query timeout, payload limits, credential/log redaction, auth và CSV formula injection. Unit/parser tests kết hợp runtime DB grant tests, không thay nhau.
