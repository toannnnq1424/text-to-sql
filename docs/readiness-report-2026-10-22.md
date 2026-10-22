# Báo cáo triển khai và QA ngày 22/10/2026

Nhánh `module/production-readiness`. Báo cáo phân biệt code đã triển khai, bằng chứng runtime và những phần chưa đạt. Tài liệu giải thích cơ chế đầy đủ nằm ở [application deep dive](application-deep-dive.md) và [phát triển schema docs/semantic layer](schema-and-semantic-development.md).

## Kết quả code

### AI và core SQL

- Retrieval tiếng Việt có/không dấu, CamelCase/underscore, schema-qualified names, typo đơn/compound bảo thủ; không đổi physical identifiers hoặc tạo question→SQL lookup trong runtime.
- Giữ metric/dimension/join anchors khi câu hỏi nêu bảng; bảng trùng tên giữa schema hoặc ứng viên gần ngang nhau được xử lý mơ hồ. Sửa nhầm `table.column` thành một schema không tồn tại khi column trùng tên một bảng khác.
- Predicate AST cho yêu cầu tie-break bằng primary key đơn rõ ràng: giữ entity grain và thứ tự/chiều khóa trong outer aggregate. Alias được nhận diện; quoted literals không bị hiểu nhầm là yêu cầu. Không tự rewrite SQL hoặc hứa hiểu mọi intent; composite/nested/ambiguous cases ngoài predicate này.
- Cùng giới hạn tối đa một correction/hai model calls và tổng50s trong deadline Java60s; không retry provider/network/security errors để làm đẹp kết quả. Native planner/compaction, Java guard/lineage và read-only execution vẫn bắt buộc.

### Backend

- Shared admission cho text/API/offline và structured semantic query: mặc định8active/process, configurable1..64, không hàng chờ vô hạn.
- Hết slot trả429 `QUERY_BUSY`, retryable=true trước history/provider; release slot mọi nhánh lỗi/persistence/interruption/public mapping.
- Giữ interrupt flag từ HTTP client, kiểm deadline sau từng stage và kiểm lại quyền/connection/Dataset config ngay trước reader execution. Không dùng quyền cũ sau một lần inference kéo dài.

### Frontend

- Selector labels/listbox identities, Home/End/Escape/focus return, notification dismissal, local tabs roving focus, native SQL-confirmation modal/description, table header/scroll-region accessibility và heading cho404/loading/error.
- Sửa contrast được phát hiện trên UI thật: muted/status/discovery/SQL line numbers/mobile mode label; inline source link có underline.
- Sửa preview upload bị bỏ lại khi rời route, kể cả response upload đến trễ; không discard run đã được chấp nhận/đang chạy chỉ vì component unmount. Explicit reset/TTL vẫn quản lý spool theo contract.
- Dataset cùng tên có description thật + shortID và fullID accessible/tooltip, chọn đúng identity thay vì đoán theo tên hoặc lấy option đầu.
- Biểu đồ đọc đủ các trang snapshot đã lưu trong bound1.000dòng/5MiB, không chỉ20dòng preview; actualUI kiểm24bars/24groups. Không rerun model/SQL khi đọc trang, page lỗi báo lỗi thay vì âm thầm vẽ thiếu. Review phát hiện trường hợp chart fallback thành bảng có thể dựng1.000×200 ô cùng lúc; đã sửa thành bảng snapshot phân trang local20dòng/lượt, giới hạn DOM và giữ copy/số dòng chính xác. Query lỗi không còn gắn nhãn SQL đã thực thi thành công.
- Không dùng mock response để làm đầy màn hình. Hình thức theo navy/sidebar/blue/cards/tables của ảnh gốc; không tuyên bố pixel-perfect.

## Data warehouse và nạp qua UI

[AdventureWorksDW projection](../data/adventureworks/README.md) dùng nguồn Microsoft đã pin URL/commit/SHA/license:12bảng,145.524dòng nguồn thuộc các cột đã chọn, gồm hai facts60.398/60.855dòng. Đây không là toàn bộ AdventureWorks và không chứa giá trị tổng hợp giả.

Phân biệt hai đường kiểm chứng:

1. **Administrative provisioning:** dựng database mới cô lập trên PostgreSQL/MySQL/SQL Server, PK/FK thật, dedicated reader, kiểm counts/quantity/revenue/country/year joins và ghi no-op bị từ chối. Đây không thay module app.
2. **Recorded application UI:** thao tác thật React→Java để đăng ký/discover/allowlist, upload/preview/validate/confirm/run và xem kết quả. API chỉ dùng xác thực setup hoặc assertions đọc độc lập; không dùng POST API để giả một lần nạp trên UI.

| Luồng được quay                          | Kết quả thật                                                | Đọc database độc lập                                                             |
| ---------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Registry/discovery/Dataset               | 3engine, mỗi Dataset chọn đúng12bảng                        | Reader/projection scopes, không lấy33bảng discovery SQL Server làm12bảng Dataset |
| CSV DimProduct                           | 606dòng×11cột,4layers×3engine SUCCESS                       | 12/12layer tables, mọi canonical cell,211missingprices, SUM295326.3961           |
| JSON DimProduct                          | 606dòng×11cột,4layers PostgreSQL SUCCESS                    | 4/4layers, mọi source cell kể cả nullable STRING/NULL                            |
| CSV FactInternetSales                    | 60.398dòng×17cột,4layers PostgreSQL SUCCESS                 | 4/4layers, mọi source cell/orderline key, SUM29358677.2207 và quantity60398      |
| SQL Import native files                  | 606dòng×4cột×3engine SUCCESS                                | 3/3tables, mọi source record,211NULLprices, SUM295326.3961                       |
| Transformation pipeline MySQL→PostgreSQL | 606dòng×11cột, preview/mapping/save/run4layers SUCCESS      | 4/4layers khớp mọi source cell, NULL/decimal/time                                |
| 13file extensions                        | Mỗi format parse/preview606dòng×11cột qua UI, reset/discard | Parser offline14cases gồm bulk; không gọi preview là đã persist cả13format       |

Tổng27đối chiếu tables/layers qua readers độc lập PASS. CSV empty-string khác JSON null: nguồn STRING NULL xuất ra ô CSV trống được giữ thành chuỗi rỗng theo canonical CSV; numeric/date missing có mapping riêng. JSON và DB→DB pipeline chứng minh giữ NULL gốc. Không làm mất khác biệt này trong oracle để báo PASS.

SQL Import vẫn là subset parse/map/plan có kiểm soát, không execute installer upstream nguyên văn. Bulk60k đi qua file ingestion vì vượt giới hạn SQL-import một file. Source fixture preparation chỉ xuất file/hash/oracle offline, không thay caller UI.

## QA browser và video

Mọi browser context đợt này có `recordVideo`; credentials/tokens không xuất hiện trên video. Runners chính: [readiness-browser.mjs](../infra/local/readiness-browser.mjs), [readiness-demo.mjs](../infra/local/readiness-demo.mjs). Không intercept/thay response: helper clone response chỉ để quan sát body thật khi Chromium loại body cũ sau React navigation.

Full-route audit đã đi qua107screen/state ở1440/1024/390, gồm Catalog detail, Query tabs, ingestion/evaluation/SQL-run detail, editor/forms/menus và404. Không document overflow, mỗi main có một h1, không unhandled browser error; năm keyboard checks PASS. Hai axe findings cuối ở inline source link và mobile mode label được sửa và có targeted recorded recheck; đọc report gốc cùng report recheck, không sửa report FAIL cũ thành PASS. Selector cùng tên và bulk preview keyboard-focus được kiểm thêm sau sửa.

Video feature demo hoàn chỉnh có actual OIDC login/logout, chọn rõ Ollama/qwen3:4b, hỏi không dấu có typo→COUNT347 thật, SQL/explanation/provenance, structured semantic query24groups→bar/pie, index/search local embeddings, tạo/lưu/chạy quality606rows và xem model Settings. Không gọi online inference hoặc sửa profile online.

Các lần runner lỗi label/body/prefix/native-option locators được giữ riêng; không hạ product validation. Một lần demo inference timeout khi nhiều browser/video encoder cùng tải được giữ là FAIL, lần chạy sau là một lượt demo khác, không sửa mẫu số corpus.

Video/report local được giữ ở `.local/compose-app/readiness-browser/`, không đẩy public Git:

| Thư mục evidence                               | Nội dung                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `registration-complete`, `registration-scoped` | Tạo và hoàn tất ba kết nối/Dataset; có cả lần retry được ghi nhận       |
| `file-ingestion`, `file-ingestion-complete`    | CSV606 qua ba engine                                                    |
| `file-formats`                                 | 13format preview/reset                                                  |
| `sql-import`                                   | Upload/plan/confirmation/Escape/run trên ba engine                      |
| `warehouse-pipeline-products`                  | Pipeline đúng DimProduct606 MySQL→PostgreSQL                            |
| `bulk-ingestion-complete`                      | File fact60.398dòng qua UI                                              |
| `json-ingestion`                               | JSON giữ nullable strings/NULL                                          |
| `all-routes-final`, `focused-complete`         | 107states và5targeted states sau fixes,0axeviolations/0errors ở recheck |
| `feature-demo-snapshot`                        | Demo16chương/24groups, `report.json` lưu thời điểm từng chương          |
| `chart-snapshot-ui`                            | UI query thật chia 24 dòng thành20+4, không gửi API mutation/model/SQL  |

Đã mở ảnh thực để rà Query/SQL/charts/quality và responsive states. Automated axe không thay review thủ công mọi cách dùng hoặc pixel comparison với ảnh mock; số107không có nghĩa mọi tổ hợp role/input/network đã được thử.

## Kiểm thử và tải

| Phạm vi                       | Kết quả                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Java                          | 192tests/44suites, failures/errors/skips0; gồm DB3 và admission/interruption/reauth races   |
| AI                            | 441PASS,1onlineSKIP; runner3PASS riêng                                                      |
| Infra/data/runner helpers     | 63PASS,8subtestsPASS; gồm ba runner tests ở dòng trên, không cộng đôi                       |
| FE                            | 217tests/26files PASS, TypeScript/Vite build và Prettier PASS; frontend image mới đã deploy |
| Actual HTTP query concurrency | 20callers đồng thời:8SUCCESS,12QUERY_BUSY không tạo resource; request sau đó SUCCESS        |
| Source inventory/patches      | Hai snapshot và9patch records verify PASS; không chỉnh vendor trong đợt này                 |
| Secret/config                 | Known-local-secret scan PASS; file provider online giữ SHA, online inference NOT RUN        |

Test FE có lần timeout dưới tải đồng thời Docker/Ollama/Chromium/video encoding; giữ log và chạy lại với worker bounds khi idle. Không đổi assertion/timeout sản phẩm để gọi các lượt lỗi là PASS. Load test20callers là probe nhỏ trên local, không là production soak/distributed quota acceptance.

## Chất lượng model thật: phần chưa đạt

Corpus validation-only gồm15logicalcases×3engines, hỏi không trùng semantic examples; oracle độc lập từ read-only source snapshot, paging kết quả đầy đủ:

- **39/45PASS** tổng; positive answer accuracy **30/36**, controlled rejection **9/9**.
- Median12,106ms; p95 30,335ms; maximum33,482ms.
- Sáu FAIL: join-count và top-N trên ba engine, gồm model error, timeout và sai grain.
- Follow-up sau guard giữ report riêng: **1/6PASS,5FAIL**. PostgreSQL join chạy đúng; PostgreSQL top-N giữ đúng entity/tie nhưng thêm ID ngoài yêu cầu; bốn ca còn lại MySQL/SQL Server timeout.

Không lấy lượt thử tốt nhất để thay baseline, không loại timeout khỏi denominator, không bỏ cột ID khỏi actual rows để khớp đáp án. Predicate/guard làm code đáng tin hơn nhưng model nhỏ chưa ổn định trên các câu này. Các câu đã SUCCESS không chứng minh mọi câu hỏi mới đúng nghiệp vụ.

## Mức hoàn thiện và giới hạn

Ước lượng kỹ thuật theo target hiện tại: FE90%, BE94%, Data92%, AI82%; trọng số25/35/20/20 khoảng90%. Đây không là accuracy model hoặc phần trăm417k dòng upstream đã được tích hợp. Độ bất định vài điểm; có tests/merge không đồng nghĩa100%.

Phần còn INCOMPLETE: ổn định/độ đúng model tự do, top-N output intent và complex joins; ranking/date-role/multi-fact capability chưa đầy đủ trong structured semantic compiler; production HTTPS/IdP/recovery/commit-ack fault injection, long soak/distributed limits và full human visual/usability coverage. Online NOT RUN theo yêu cầu; cloud connectors/native Rust source build không được tính đã hỗ trợ chỉ vì source nằm trong repo. Các phần bắt buộc chưa đạt vẫn ghi thiếu, không chuyển thành roadmap để claim hoàn thành.

Tài liệu [deep dive](application-deep-dive.md) giải thích tại sao candidate/compiled/planned/driver SQL tồn tại và không chỉ là các cách LLM generate. Tài liệu [schema/semantic development](schema-and-semantic-development.md) giải thích physical schema→schema docs→business definitions→validate/activate→RAG/evaluation và những chỗ chưa tự động hóa.
