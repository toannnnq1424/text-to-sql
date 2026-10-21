# Security boundary và dữ liệu

Đặc tả mục tiêu và controls bắt buộc cho mọi deployment. Work log/acceptance mới nhất quyết định phần nào đã được kiểm thử thật.

## Query

Java parse AST recursive và resolve identifiers (CTE, subquery, aliases, quoted names), chỉ một SELECT/CTE read-only. Reject DML/DDL, multi statement, comment injection, SELECT INTO, locking/write side effects, vendor export clauses, dangerous functions, filesystem/network/system access, stored procedure CALL/EXEC, cross-dataset/schema references và identifier không resolve được. Không dùng regex làm security layer duy nhất; không coi từ đầu tiên SELECT hoặc JDBC setReadOnly là bằng chứng đủ.

Allowlist theo dataset, kiểm tra physical table/column và semantic rules, giới hạn complexity/joins phù hợp, safe LIMIT/TOP/OFFSET AST-aware không phá ORDER BY. Dialect mismatch phải controlled error; không regex sửa SQL để chạy cho qua. Read-only DB principal với quyền tối thiểu theo engine là lớp bảo vệ riêng. Unknown/dangerous function fail closed. SQL Server read-only phải dùng grants/database policy và credential đúng, không dựa transaction hint giả định.

Baseline configurable server bounds: max 1000 materialized rows, max 5 MiB result payload, statement timeout 15s, tổng deadline 60s. Apply limit +1 khi phù hợp để biết truncated, byte accounting đo dữ liệu thực serializable, không chỉ số hàng. Cancel/close JDBC statement/connection khi timeout; tránh giữ runaway query. Không cho export vượt giới hạn mặc định; nâng limits là quyết định quản trị có audit.

## Principal và network

Java validate token, role và resource-level authorization mọi registry/query/history/catalog/export. Python dùng service auth trên private network; browser không có route generation trực tiếp. Registry host/port không là URL tự do: chỉ admin được cấu hình endpoint, có allowlist/network egress policy để tránh SSRF và truy cập metadata/internal services ngoài warehouse được phép. Cấu hình TLS/verify certificate cho kết nối deployment; không disable SSL verification để sửa lỗi.

## Credentials và logs

Credential reference trỏ secret provider/env binding, không secret trực tiếp trong DTO/log. Query reader khác ingestion writer, SQL Import writer và provisioning admin. Python không nhận reader/writer credentials. SQL Import writer chỉ có quyền tạo/đọc/chèn và tạo index/khóa ngoại cần thiết trong namespace import riêng (`nla_import`); không có write grant trên source tables. MySQL ánh xạ namespace này thành database/catalog riêng; PostgreSQL/SQL Server dùng schema riêng trong target database. Ingestion writer chỉ được đọc source objects đã đăng ký và ghi bốn lớp raw/staging/warehouse/mart được cấu hình. Log correlationId + safe metadata, không API key, token, connection string password, raw provider body hoặc data row nhạy cảm. Question/SQL có thể chứa nội dung nhạy cảm: audit truy cập có hạn quyền, retention policy và redaction, không log tràn toàn bộ mặc định.

ADMIN được nhập/thay/xóa LLM API key qua profile Settings theo [contract](contracts/model-providers.md). Java lưu AES-GCM với master key độc lập DB; chỉ private modelConfig chuyển key tới Python để tạo Authorization header. Không trả key/ciphertext/suffix qua API, không key trong metadata LLM/prompt/history/audit/React query cache hoặc browser storage. Đổi endpoint không tự mang key cũ sang đích mới. URL/host allowlist, HTTPS/TLS/redirect controls áp dụng cả Java và Python; modelConfig request-scoped không sửa global environment. Save không tự gọi provider; online provider hiện có vẫn không được kiểm thử trong đợt này.

## Semantic/AI/UI

Treat question/schema description/examples là untrusted content; system rules không bị prompt injection override. Provider chỉ nhận relevant authorized metadata đã lọc; không gửi data rows/secrets. Python strict JSON, enum/size limit, controlled errors; Java independently validates. FE render text, chart JSON allowlist và references hợp lệ; không executable AI JS/HTML/React. CSV export sanitize spreadsheet formulas cho string cell.

## Ghi dữ liệu và Import SQL

In-app ingestion và SQL Import là mandatory. Query reader khác ingestion/import writer và provisioning admin; writer không được chia sẻ cho Python hay browser. Pipeline ingestion chỉ chạy registered source; không tự fetch URL do người dùng nhập.

SQL Import nhận file qua Java, parse thành statement/AST và canonical schema/data plan, trả validation/preview trước khi chạy. Allowlist chỉ gồm subset đã chốt ở `contracts/public-api.md`; reject multi-dialect ambiguity, destructive DDL, procedure/trigger, file/network/system function, unsupported vendor syntax, path traversal, oversized file, excessive statements/data và resource exhaustion. Không execute file nguyên văn qua psql/mysql/sqlcmd, shell hoặc `Statement.execute` dựa vào filename/extension. Native import vẫn phải parse/validate; cross-dialect bắt buộc semantic type mapping, quote/identity/default/FK order và error reporting thật cho mỗi engine.

Confirm phải tham chiếu digest của plan/file đã validate; idempotency ngăn submit lặp; collision/destructive action fail closed; audit ai/target/source dialect/digest/outcome, không log raw SQL/data hoặc secret. Staging/transaction/rollback/recovery phụ thuộc engine capability; báo rõ partial outcome và không tuyên bố atomicity khi không đạt. Permission test, malicious SQL corpus, file size/encoding, timeout, cancelled job, writer/read-only grants và data integrity tests đều chạy trên cả ba adapters.

## Evidence bắt buộc

Security corpus cho cả 3 engines: nested CTE/subquery, quoted identifiers, comments/multi statement, unknown/schema-qualified tables, SELECT INTO/export, function side effects, unauthorized dataset, SQL injection qua question/search/sort/metadata, SQL Import dialect parsing + unsupported/destructive/file/network payload, query/import timeout, payload limits, credential/log redaction, login/role/resource authorization và CSV formula injection. Unit/parser tests kết hợp runtime DB grant tests, không thay nhau.
