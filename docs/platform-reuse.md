# Tái sử dụng semantic engine và data tool runtime

## Quyết định và trạng thái

Theo yêu cầu trực tiếp của người dùng ngày 2026-10-20, ưu tiên tận dụng sâu hai bộ mã nguồn trong Downloads thay vì tự viết lại những phần đã có implementation phù hợp. Tên dịch vụ/thành phần của sản phẩm dùng `semantic-engine` và `data-tool-runtime`; giao diện, logo, tài liệu hướng dẫn người dùng và telemetry của sản phẩm dùng tên Natural Language Analytics Warehouse.

Đã khảo sát hai snapshot và tích hợp có chọn lọc vào caller thật: [semantic context index/provider payload](integrations/semantic-context.md) trong Python và [native metadata descriptions](integrations/native-metadata.md) trong Java discovery. Danh tính snapshot và hash nguồn ở [reviewed-snapshots.json](integrations/reviewed-snapshots.json), hồ sơ chi tiết ở từng integration. Đây không phải việc đưa toàn bộ hai codebase, planner hoặc MCP server vào runtime. Không gọi danh sách connector upstream là danh sách engine đã nghiệm thu của app.

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
| `wren-core`, `wren-core-py` | Dùng planner/optimizer qua private semantic service hoặc binding, trả physical candidate SQL và lineage cho Java kiểm tra | Plan và SQL sau rewrite đều được kiểm tra; SQL thực thi dùng identity/quyền của caller, không chỉ kiểm tra SQL trước rewrite |
| `ibis-server/app/mdl`, `custom_sqlglot`, dialect tests | Tận dụng semantic rewrite và xử lý dialect thực đã có | Pin bộ phiên bản tương thích; không regex-rewrite để chạy cho qua; so sánh kết quả, decimal, null, timestamp và join fan-out trên database thật |
| `ibis-server/app/model/metadata`, `data_source.py`, `connector.py` | Dùng implementation discovery/type mapping và connector theo capability | Timeout/row/byte limits của app phải được truyền xuống; default timeout upstream không mặc nhiên đáp ứng 15s của app |
| Python SDK/CLI trong `wren/` | Học/tái sử dụng lifecycle project, model validation, profile/env reference và local-file handling | Profile không trở thành kho secrets mới trong Git; không chạy CLI bằng shell trên input người dùng |
| `mcp-server/app` | Tận dụng tool discovery và semantic metadata facade khi cần agent tooling | Không expose query/credential route trực tiếp cho browser hoặc LLM; tool được cấp quyền cụ thể, không bật cả toolset mặc định |
| `internal/sources`, `internal/tools`, `internal/prebuiltconfigs` của tool runtime | Tận dụng driver, pooling, metadata tool và truy vấn có tham số | Chọn tool allowlist; không tự bật `execute_sql`, DDL, admin, filesystem/network tools; parameterize values và validate identifiers riêng |
| `internal/auth`, `internal/telemetry` | Tận dụng service auth, trace/metrics và lifecycle connection | JWT/service identity không thay principal/resource grants của Java; redact SQL/data/secrets; trace giữ correlation ID của app |
| Tests, examples và cấu hình build của cả hai | Chọn lọc corpus làm regression và kịch bản tương thích | Ghi provenance; test upstream chưa chạy trong app không tính PASS; không trộn test fixture vào production payload |

Tận dụng tối đa nghĩa là ưu tiên code hoạt động và test hữu ích, không sao chép toàn bộ hai repository hoặc giữ hai implementation cạnh tranh không có caller thật. Module legacy, demo UI, logo/marketing, package phát hành và tool quản trị ngoài nhu cầu chỉ đưa vào khi có consumer cụ thể. README của semantic snapshot ghi nguồn đã archive/chuyển repository; phải pin snapshot và xác định nguồn bảo trì trước khi chọn artifact, không tải `latest` tùy ý. Các package manifests trong snapshot cũng có version khai báo khác nhau giữa các phần, nên phải kiểm tra lockfile/build thực trước khi chọn wheel.

## Ranh giới tích hợp

Luồng AI chính tiếp tục là React → Java → Python AI → LLM; Python AI trả candidate SQL và không nhận credentials warehouse. Java sở hữu registry, OIDC, role/resource authorization, allowlist, validation, execution decision, snapshots, history, audit, import và ingestion.

Khi tái sử dụng planner, Java gọi một semantic service private để plan/rewrite trên metadata đã được cấp quyền. Kết quả quay về Java dưới dạng candidate cần kiểm tra độc lập. Khi tái sử dụng connector hoặc tool runtime, Java gọi private executor có service auth sau khi hoàn tất authorization/validation; credentials chỉ được resolve trong executor tin cậy này. Đây là service riêng về trách nhiệm với Python AI generation, dù có thể cùng dùng Python runtime. Không chuyển warehouse credentials hoặc quyền execute sang AI service.

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
