# Tái sử dụng semantic engine và data tool runtime

## Quyết định và trạng thái

Theo yêu cầu trực tiếp của người dùng ngày 2026-10-20, ưu tiên tận dụng sâu hai bộ mã nguồn trong Downloads thay vì tự viết lại những phần đã có implementation phù hợp. Tên dịch vụ/thành phần của sản phẩm dùng `semantic-engine` và `data-tool-runtime`; giao diện, logo, tài liệu hướng dẫn người dùng và telemetry của sản phẩm dùng tên Natural Language Analytics Warehouse.

Đã khảo sát hai snapshot và tích hợp caller thật: [semantic context index/provider payload](integrations/semantic-context.md), native Wren semantic planner/rewrite, cùng [native metadata descriptions](integrations/native-metadata.md) trong Java discovery. Danh tính snapshot/hash ở [reviewed-snapshots.json](integrations/reviewed-snapshots.json), hồ sơ chi tiết ở từng integration. Wren integration dùng pinned native package and adapted upstream CTE rewrite; it does not mean the full upstream repositories, SDK/CLI, connector server or MCP server are included. Go native executor/pooling cho cả ba database đã chạy trong Compose và được Java gọi sau SQL validation; source preview/test/run cũng dùng executor này. Không tích hợp toàn bộ MCP tool server hoặc các cloud connectors.

Người dùng cho biết đã mua và được phép xử lý các bộ nguồn. Các file được kiểm tra hiện có giấy phép gốc Apache-2.0, không phải MIT; không thấy Git metadata trong hai thư mục tải xuống nên không tự suy đoán commit từ hậu tố `main`. Chưa có một thỏa thuận cấp quyền riêng trong các file đã kiểm tra.

## Hai bộ nguồn làm gì

| Bộ nguồn, tên nội bộ khi tích hợp | Chức năng đọc được trong code | Giá trị cho dự án |
|---|---|---|
| Semantic engine | Manifest/MDL mô tả model, metric, dimension, relationship; Rust/DataFusion lập kế hoạch semantic SQL; Python bindings; Python SDK/CLI; FastAPI metadata, validation, dry-plan và connector query; MCP facade | Dùng lại mô hình ngữ nghĩa, phân giải quan hệ/metric, planner và corpus kiểm thử dialect; giảm việc tự đoán join hoặc tự viết SQL transpiler |
| Data tool runtime | Go server cho MCP/HTTP; nguồn dữ liệu, tool SQL có tham số và toolset trong YAML; nhiều driver; connection pooling; auth; telemetry; schema/metadata và tool quản trị | Dùng lại transport, source lifecycle, schema discovery, tool có tham số, pooling và observability; có thể cung cấp giao diện công cụ riêng cho tác vụ được cho phép |

Hai bộ này không tự thay thế LLM provider, authentication/resource grants, registry, query history, import preview/confirm hay UI hiện tại. Semantic planner cần model nghiệp vụ đã cấu hình; tool runtime cần cấu hình tool và quyền đúng. Không coi MCP là model AI hoặc khả năng trả lời câu hỏi tự nhiên không cần model.

## Bản đồ phần có thể tái sử dụng

Các đường dẫn trong cột nguồn là đường dẫn tương đối của snapshot trong inventory, không phải module đã có trong repository này.

| Phần nguồn | Cách áp dụng | Ràng buộc và bằng chứng cần có |
|---|---|---|
| `wren-core-base`, schema manifest, `mdl.schema.json` | Chuyển semantic model hiện tại sang manifest có model/metric/relationship/grain rõ; validate trước activate | Mapping giữ version, allowlist, timezone, loại dữ liệu, nullability; round-trip và lỗi reference có tests; không tạo semantic definition giả |
| `wren-core-py==0.4.0`, `wren-core` native binding and adapted CTE rewrite | Implemented in Python private semantic-plan endpoint and called by Java QueryService. Java compiles a request-scoped manifest from the authorized dataset, Python runs native manifest resolution/session transformation and CTE physical rewrite, and returns lineage. | Java SqlGuard runs after rewrite and compares physical source sets before JDBC. Requests are strict, private, bounded, three-dialect and fail closed. No warehouse credentials reach Python. See [semantic-planner contract](contracts/semantic-planner.md), [provenance](integrations/semantic-planner.md), and tests. No claim of upstream metric/measure plan (the current manifest intentionally contains physical tables, columns and discovered relationships only). |
| Wren `ibis-server/app/mdl`, `custom_sqlglot`, dialect tests | Dialect parsing, Wren CTE dialect source and curated test patterns inform native rewrite integration. | SQLGlot and native package are pinned; no regex SQL rewrite. Must still verify semantic result equivalence and join fan-out against actual DBs for broader semantic models. |
| `ibis-server/app/model/metadata`, `data_source.py`, `connector.py` | Dùng implementation discovery/type mapping và connector theo capability | Timeout/row/byte limits của app phải được truyền xuống; default timeout upstream không mặc nhiên đáp ứng 15s của app |
| Python SDK/CLI trong `wren/` | Học/tái sử dụng lifecycle project, model validation, profile/env reference và local-file handling | Profile không trở thành kho secrets mới trong Git; không chạy CLI bằng shell trên input người dùng |
| `mcp-server/app` | Tận dụng tool discovery và semantic metadata facade khi cần agent tooling | Không expose query/credential route trực tiếp cho browser hoặc LLM; tool được cấp quyền cụ thể, không bật cả toolset mặc định |
| `internal/sources`, `internal/tools`, `internal/prebuiltconfigs` của tool runtime | Tận dụng driver, pooling, metadata tool và truy vấn có tham số | Chọn tool allowlist; không tự bật `execute_sql`, DDL, admin, filesystem/network tools; parameterize values và validate identifiers riêng |
| `internal/auth`, `internal/telemetry` | Tận dụng service auth, trace/metrics và lifecycle connection | JWT/service identity không thay principal/resource grants của Java; redact SQL/data/secrets; trace giữ correlation ID của app |
| Tests, examples và cấu hình build của cả hai | Chọn lọc corpus làm regression và kịch bản tương thích | Ghi provenance; test upstream chưa chạy trong app không tính PASS; không trộn test fixture vào production payload |

Tận dụng tối đa nghĩa là ưu tiên code hoạt động và test hữu ích, không sao chép toàn bộ hai repository hoặc giữ hai implementation cạnh tranh không có caller thật. Module legacy, demo UI, logo/marketing, package phát hành và tool quản trị ngoài nhu cầu chỉ đưa vào khi có consumer cụ thể. README của semantic snapshot ghi nguồn đã archive/chuyển repository; phải pin snapshot và xác định nguồn bảo trì trước khi chọn artifact, không tải `latest` tùy ý. Các package manifests trong snapshot cũng có version khai báo khác nhau giữa các phần, nên phải kiểm tra lockfile/build thực trước khi chọn wheel.

## Ranh giới tích hợp

Luồng AI chính là React → Java → Python AI/provider candidate → native semantic planner/rewrite in Python → Java SqlGuard/lineage → private native executor. Both Python calls use the internal token and receive no warehouse credentials. Java owns registry, OIDC, role/resource authorization, dataset allowlist, post-rewrite validation, execution decision, snapshots, history, audit, import and ingestion.

The current planner shares the private Python AI process but has a separate authenticated endpoint and contract. Java passes a per-query allowlisted manifest and candidate SQL; the native result returns as candidate and still requires Java validation. If later adopting upstream connector/tool runtime, Java must keep private executor service auth after authorization; credentials remain in the trusted executor. Do not move warehouse credentials or execution authority to the AI service.

Mỗi lần tích hợp phải chọn rõ ai thực thi mỗi capability, tránh một query bị chạy cả JDBC và MCP. Chỉ thay executor hiện tại khi đã có implementation thật, caller, validation và acceptance tương ứng; không tạo adapter rỗng để giữ tên connector.

## Quy tắc tên, branding và giấy phép

- Không dùng logo, tên sản phẩm upstream, badge marketing, liên kết quảng bá, email hỗ trợ upstream hoặc câu khẳng định được upstream bảo trợ trong UI và tài liệu sản phẩm. Dùng tên trung tính đã chốt ở trên.
- Không đổi mù quáng import path, Go module path, crate/package name hoặc chuỗi protocol: cần sửa dependency/build/tests đồng bộ nếu fork namespace. Tên kỹ thuật của dependency có thể được giữ trong lockfile/provenance; không trình bày nó như thương hiệu của app.
- Giữ giấy phép và notice thuộc phần mã thực sự tái sử dụng; đánh dấu các file đã sửa và duy trì bảng provenance. Không xóa `LICENSE`, `NOTICE`, copyright hoặc gán MIT cho nguồn Apache-2.0 để đổi branding. Apache-2.0 mục 4 yêu cầu kèm license và giữ các notice liên quan khi phân phối; mục 6 không cấp quyền dùng thương hiệu làm tên sản phẩm. Xem [văn bản giấy phép chính thức](https://www.apache.org/licenses/LICENSE-2.0).
- Khi có thỏa thuận riêng cho phép thay các điều kiện này, lưu tham chiếu và phạm vi quyền trong hồ sơ nguồn trước khi thay notice; tài liệu thương mại nhạy cảm không đưa vào repo public. Không coi lời mô tả đã mua source là bản license thay thế cho mọi dependency bên thứ ba.
- Chưa chọn giấy phép phát hành cho code tự viết của repository này; giữ tách biệt với điều kiện của thành phần upstream và dataset. Chỉ tạo third-party distribution notices khi biết chính xác code/artifact được đóng gói, không liệt kê toàn bộ hai source như dependency đã ship.

## Cách triển khai và nghiệm thu

1. Chọn module cụ thể, source snapshot/commit/artifact và dependency closure, cập nhật provenance/notice; chọn điểm gọi thật trong Java/semantic service/tool runtime.
2. Chốt contract và fixtures về request, result, lỗi, lineage, capabilities, credential references và time/row/byte budgets trước khi đổi consumers. Không tự nới engine enum ở một service.
3. Hoàn thiện một luồng trong scope cam kết, gồm validation, auth, execution, persistence, UI state và tests ngay trong cùng lần triển khai. Ba engine hiện tại vẫn bắt buộc; không dùng tái sử dụng upstream để hoãn phần import/ingestion/login còn thiếu.
4. Chạy compatibility/security corpus và caller thật trên database thật; ghi rõ native/cross-dialect và capability nào PASS. Tool runtime có thể có write/admin tools nhưng sản phẩm chỉ được expose capability đã duyệt.
5. Chỉ đánh dấu connector hỗ trợ khi discovery, query, serialization, giới hạn, quyền, lỗi và UI tích hợp đều có evidence. Danh mục mở rộng được ghi riêng tại [future-connectors.md](future-connectors.md) theo yêu cầu người dùng, không biến thành claim runtime đã hỗ trợ.

## Tác động theo vai trò

| Vai trò | Cần làm khi áp dụng |
|---|---|
| BE | Giữ security boundary, registry/capability model, private client, checks trước/sau rewrite, grants và immutable result/import/run |
| AI | Tận dụng semantic context/lineage; không nhận execution tool hay credential; provider API và structured candidate vẫn bắt buộc |
| Data | Mapping physical↔semantic, manifest compiler, provenance, schema/grain/types và fixture đa domain; file/object source không tự là SQL database |
| FE | Connector forms và capabilities do API trả, empty/error/unavailable state; không gắn tên/biểu tượng upstream hoặc bịa trạng thái connector |
| Infra | Pin artifacts, private network/service auth, egress/storage allowlist, timeouts/resource limits, notices và reproducible deployment |

Nguồn nhận diện để kiểm tra provenance: [semantic source](https://github.com/Canner/wren-engine), [tool runtime source](https://github.com/googleapis/mcp-toolbox). Các tên nguồn chỉ phục vụ nhận diện kỹ thuật và attribution, không dùng làm tên sản phẩm.

## Tích hợp runtime mở rộng ngày2026-10-20

Luồng mặc định hiện là React→Java→generation/context selection→native semantic core/CTE planning→Java AST/lineage check→private Go executor→database. Native core là dependency compiled thực0.4.0, cùng phần nguồn CTE/dialect được thích nghi từ snapshot; không tự viết một planner rỗng rồi gọi là tích hợp. Go runtime dùng nguồn driver/pool/cursor/normalization thích nghi từ bộ thứ hai, có caller Java thật và cancellation/types DB3. [Native planner](integrations/semantic-planner.md), [native executor](integrations/data-tool-runtime.md), [bulk file contract](contracts/file-ingestion.md) ghi chính xác phạm vi.

File parser áp dụng local-file dispatch và Arrow conversion từ nguồn đầu, mở rộng thành13 extension có upload đầy đủ/header/type inference/preview. Java nạp batch vào bốn lớp và đăng ký dataset; không bắt thêm sample folder hoặc gõ từng dòng/cột. Nguồn dữ liệu đầu vào là bytes người dùng upload và dữ liệu lưu thực; fixtures chỉ trong kiểm thử.

Phần ngoài luồng được chạy/test này (toàn bộ upstream UI/server/cloud IAM/vector store, connectors đám mây chưa cấu hình, local training) không được trình bày như đã tích hợp. Việc tận dụng source được đo bằng capability và caller thực, không bằng chép thư mục hoặc số dòng; danh mục connector mở rộng vẫn là tài liệu riêng và không thay phạm vi bắt buộc hiện tại.

## Đăng ký nguồn và tái sử dụng phiên native — 2026-10-20

Luồng đăng ký nguồn mới dùng Catalog/adapter discovery thật, bao gồm native descriptions đã thích nghi từ các metadata tools; Java tạo SELECT từ bảng/cột được chọn, AST guard trước khi gọi bộ thực thi. Trong Compose, preview20 dòng và kiểm tra trước khi lưu đi qua Go native executor/pool đã thích nghi từ source PostgreSQL/MySQL/SQLServer. Đây là caller thật bổ sung cho implementation hiện có, không phải một bản copy tool server mới.

Áp dụng thêm `wren/src/wren/mdl/__init__.py:get_session_context` từ Downloads vào native planner: cache có giới hạn8 phiên, mỗi manifest được giữ tối đa64KiB dạng base64; manifest lớn vẫn được xử lý nhưng không lưu cache. Khóa đầy đủ theo manifest đã được Java cấp phép và dialect; thay metadata tạo phiên mới. Factory và từng phiên có lock, CTE rewriter/AST vẫn riêng từng request. Không cache SQL, câu hỏi, token, credentials, kết quả hoặc response LLM. Cơ chế này giảm khởi tạo native session, không có nghĩa giảm số lần gọi model/provider hoặc đã đo chi phí/token thực. Chi tiết source hash và tests ở [semantic planner](integrations/semantic-planner.md).
