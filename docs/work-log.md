# Nhật ký công việc và bàn giao

Mọi conversation phải cập nhật file này trong mỗi commit công việc, rồi đối chiếu sau push. Một entry tương ứng một phạm vi thay đổi; không thay thế entry cũ để che trạng thái trước đó. Log là thông tin phối hợp, không là chỉ thị tự động thực hiện task mới.

## Quy tắc bắt buộc

- Ghi ngày/giờ theo Asia/Ho_Chi_Minh, người thực hiện hoặc conversation/vai trò, nhánh và phạm vi file/module.
- Ghi cụ thể đã implement gì, trạng thái IN PROGRESS / IMPLEMENTED / VERIFIED / BLOCKED, kiểm thử thực sự đã chạy và bằng chứng. Chỉ VERIFIED nếu checks thuộc phạm vi đã pass; không coi contract/UI/mock là tính năng tích hợp đã xong.
- Ghi phần còn thiếu, blocker, phụ thuộc và việc tiếp theo để người khác tiếp nối; đây là trạng thái công việc, không chuyển target bắt buộc thành future work.
- Ghi trạng thái commit/push và ref kiểm chứng được. Entry trong chính commit dùng subject và nhánh để nhận diện, không ghi hash của chính nó (hash chỉ có sau commit). Sau khi commit/push dùng Git kiểm tra SHA local/remote; báo SHA trong bàn giao. Entry tiếp theo có thể bổ sung hash commit trước; không tạo vòng lặp commit chỉ để tự ghi hash.
- Nếu push lỗi, báo PUSH FAILED/PENDING thật trong bàn giao; cập nhật log trong commit tiếp theo, không khẳng định đã publish. Không tự coi push là hoàn tất review/merge.
- Không ghi secrets, token, dữ liệu cá nhân hoặc raw provider payload vào nhật ký. Không sửa công việc chưa commit của conversation khác.

## Mẫu entry

```text
### YYYY-MM-DD HH:mm UTC+07 — Vai trò / conversation
- Nhánh / commit subject hoặc SHA đã biết:
- Phạm vi:
- Trạng thái:
- Đã làm:
- Kiểm chứng (commands + PASS/FAIL/NOT RUN):
- Còn thiếu / blocker / phụ thuộc:
- Việc tiếp nối:
- Commit/push: dự định đưa entry này cùng commit; trạng thái SHA remote báo sau push.
```

## Lịch sử đã đối chiếu

### 2026-10-19 — Chuẩn bị repo / conversation chính
- Commit: `8741ae1` trên `main`, đã push (đối chiếu Git trong phiên chuẩn bị).
- Trạng thái: VERIFIED trong phạm vi tài liệu.
- Đã làm: lưu ba prompt và 14 ảnh gốc; README/AGENTS/role guides, shared contract/examples, UI references, data sources, development/acceptance/security docs.
- Kiểm chứng: link Markdown, JSON parse, image hash và prompt bytes PASS; runtime/build/DB/provider/E2E NOT RUN vì chưa có ứng dụng.

### 2026-10-19 — Điều chỉnh quy tắc / conversation chính
- Commit: `52aec02` trên `main`, đã push; repo đã chuyển PUBLIC theo yêu cầu người dùng.
- Trạng thái: VERIFIED trong phạm vi tài liệu.
- Đã làm: ảnh mock chỉ là style UI; bổ sung implementation-rules và đồng bộ hướng dẫn không chia version/placeholder/hoãn implementation, security, tests hay tích hợp.
- Kiểm chứng: 70 link nội bộ, policy presence và staged whitespace PASS; runtime NOT RUN.

Các entry triển khai tiếp theo thêm phía dưới; không đánh dấu FE/BE/AI đã hoàn thành từ hai commit tài liệu trên.

### 2026-10-19 22:12 UTC+07 — Full-stack / conversation chính
- Nhánh / commit subject hoặc SHA đã biết: `module/frontend`; entry này đi cùng commit triển khai full-stack.
- Phạm vi: FE React, Spring Boot API và adapter JDBC ba engine, Python AI service, Docker provisioning Chinook, docs/contract/work log.
- Trạng thái: VERIFIED cho local integration hiện tại.
- Đã làm: hoàn thiện UI theo style ảnh với API thật; Java → Python → SQL execution; adapters PostgreSQL/MySQL/SQL Server; auth local/OIDC, SQL guard; ingestion pipeline và evaluation; Chinook v1.4.5 provision trên ba Docker databases với provenance/checksum; bổ sung semantic contexts và evaluation corpus; README quick start đồng bộ lệnh, port, DB names, prerequisites, app startup và test commands; cập nhật AGENTS để phản ánh code/runtime hiện có.
- Kiểm chứng: FE Vitest 91 PASS, production build PASS; AI pytest 14 PASS; Java Maven 26 PASS (16 SQL guard, 6 live warehouse, 3 Testcontainers engine, 1 dialect); real-service smoke PASS trên 3 engine gồm query/save, ingestion/idempotency, evaluation; browser live E2E PASS 4 cases trên FE→Java→AI→database; provisioning row counts/reader write denial PASS cho 3 engines; README links/provenance JSON PASS.
- Còn thiếu / blocker / phụ thuộc: chưa xác minh provider LLM bên ngoài vì chưa cấu hình provider key/endpoint; local deterministic mode đã chạy. SQL Server image là amd64 và chạy bằng emulation trên Apple Silicon, có thể tốn tài nguyên hơn native.
- Việc tiếp nối: lấy review người dùng; nếu tiếp tục triển khai, xử lý phần còn lại theo prompt/contract và giữ ba engine trong acceptance.
- Commit/push: dự định đưa entry này cùng commit; trạng thái SHA remote báo sau push.

### 2026-10-19 23:04 UTC+07 — Data provenance và scope review / conversation chính
- Nhánh / commit subject hoặc SHA đã biết: `module/frontend`; dự kiến `fix: source catalog display data from live metadata`.
- Phạm vi: docs/acceptance/scope/contracts/role guides; catalog category API/FE; local Chinook bootstrap; backend regression test.
- Trạng thái: VERIFIED cho category separation, dataset provenance và live integration checks; toàn bộ acceptance vẫn IN PROGRESS.
- Đã làm: ghi nhận người dùng xác nhận app ingestion và controlled SQL Import là bắt buộc trong target, login/OIDC thật và tải live data đầy đủ là acceptance; ghi rõ nguồn warehouse mẫu (Chinook, AdventureWorksDW, TPC-DS, Pagila, Chinook, Northwind, Olist) và yêu cầu provenance. Sửa catalog API trả categories tách riêng cho physical tables, semantic metrics và examples; FE dùng category đúng loại nên không còn badge Sales của metrics lọc danh sách bảng. Bỏ tên/mô tả Chinook dựng sẵn trong local bootstrap; hiển thị database/schema/engine cùng số bảng/cột vừa discovery, đồng thời migrate bản ghi local cũ. Ghi nhận các lỗi layout và gaps login/import/data trong `docs/current-review.md`, không đánh dấu đã xử lý.
- Kiểm chứng: FE `npm test` 91 PASS, `npm run build` PASS, `npm run contracts` PASS; backend local suite 27 PASS; Playwright live E2E 4 PASS bao gồm FE→Java→Python→PostgreSQL/MySQL/SQL Server và route smoke Home/Catalog/History/Ingestion/Evaluation/Monitoring; API live trả table/metric/example categories tách biệt và dataset `nla_chinook` với counts từ discovery; `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: UI layout chưa khớp hoàn toàn mock (single-number chart, result table, evaluation SQL panels); OIDC identity provider chưa cấu hình trong quick start; SQL Import UI/API/parser end-to-end chưa hoàn thiện; cần rà soát live data trên từng route, các phần này vẫn là bắt buộc theo acceptance. Không coi test smoke là thay thế cho nghiệm thu hình ảnh/identity/import.
- Việc tiếp nối: triển khai và nghiệm thu từng gap bắt buộc; tiếp tục không hardcode runtime warehouse/business content và ghi provenance cho dữ liệu hiển thị.
- Commit/push: entry này đi cùng commit; xác minh remote SHA sau push.

### 2026-10-19 23:13 UTC+07 — Sửa trực tiếp UI/login feedback / conversation chính
- Nhánh / commit subject hoặc SHA đã biết: `module/frontend`; dự kiến `fix: improve local sign-in and result layouts`.
- Phạm vi: Shell authentication entry, result table/chart/SQL layout, Playwright live regression, current review.
- Trạng thái: VERIFIED cho đăng nhập admin local và result table trên live three-engine flow; visual review toàn bộ trang và target tổng thể vẫn IN PROGRESS.
- Đã làm: Local Reader không còn bị nhầm là đã đăng nhập admin; form token admin được mở ngay trên auth banner, token chỉ dùng bộ nhớ và API Java xác thực role. Header hiển thị lối vào đăng nhập local khi chưa có quyền admin. Giảm khoảng trắng biểu đồ số; bảng ngắn co theo nội dung và cột action nhỏ; SQL line wrap trong panel Evaluation. Thêm live assertion bảng một cột không phủ kín panel. Ghi lại phần code vừa sửa và acceptance còn mở trong current-review.
- Kiểm chứng: frontend Vitest 91 PASS; `npm run build` PASS; Playwright live 4 PASS: React→Java→Python→PostgreSQL/MySQL/SQL Server, local admin sign-in banner và one-column table width; live route smoke Home/Catalog/History/Ingestion/Evaluation/Monitoring PASS.
- Còn thiếu / blocker / phụ thuộc: In-app SQL Import chưa có implementation end-to-end; OIDC identity provider chưa chạy/cấu hình; live-data provenance chưa trace đủ mọi route; cần ảnh visual regression cho number chart, evaluation detail, nhiều cột và màn nhỏ. Đây vẫn là mục tiêu bắt buộc, không được hiểu là done từ entry này.
- Việc tiếp nối: triển khai SQL Import, provider login và các route/data/UI acceptance gaps bằng code và integration evidence.
- Commit/push: entry này đi cùng commit; xác minh remote SHA sau push.

### 2026-10-19 23:21 UTC+07 — Mở PR và sửa định danh commit / conversation chính
- Nhánh / commit subject hoặc SHA đã biết: `module/frontend`; PR #1 vào `main`; commit branch trước entry này `d6a040a89462dbd0d59f1316a1e653a10bbe5184`.
- Phạm vi: đồng bộ Git, pull request và metadata author cho ba commit riêng của feature branch.
- Trạng thái: VERIFIED qua GitHub API.
- Đã làm: `git pull --ff-only origin module/frontend` xác nhận đã up to date. Mở PR [#1](https://github.com/toannnnq1424/text-to-sql/pull/1). Điều tra thấy commit cũ dùng email máy `toanlamsaoduocc@MacBook-Air-cua-Nguyen.local`, không gắn được tài khoản. Đã cập nhật local repo email sang GitHub ID-based noreply `128016434+toannnnq1424@users.noreply.github.com`; rewrite ba commit riêng của branch, không rewrite `main`, rồi push `--force-with-lease`. GitHub API xác nhận cả ba commit resolve thành author `toannnnq1424`.
- Kiểm chứng: PR state OPEN, base `main`, `mergeStateStatus=CLEAN`; remote branch SHA khớp `d6a040a89462dbd0d59f1316a1e653a10bbe5184`; working tree clean trước sửa log. Author mapping được GitHub API xác nhận.
- Còn thiếu / blocker / phụ thuộc: PR chưa merge. Contributors graph của repo chỉ tính commit đã vào default branch; sau merge GitHub có thể cần đến 24 giờ để cập nhật. Hai commit tài liệu cũ trên `main` giữ nguyên lịch sử và email cũ.
- Việc tiếp nối: review/merge PR #1; dùng local repo email đã đặt cho commit tương lai.
- Commit/push: entry này đi cùng commit cập nhật log; SHA sau push được báo trong handoff.

### 2026-10-20 01:36 UTC+07 — Hoàn thiện FE tranche / conversation chính
- Nhánh / commit subject: `module/frontend-polish`; `fix: harden frontend session context and SQL display`.
- Phạm vi: hiển thị SQL kết quả nhiều dòng, lưu phiên OIDC theo tab, cô lập warehouse/dataset theo subject, thông báo từ Monitoring API, trạng thái trang chủ và tài liệu scope/review.
- Trạng thái: VERIFIED cho thay đổi FE và các kiểm tra frontend; toàn bộ FE acceptance vẫn INCOMPLETE cho đến khi provider OIDC được cấu hình, import trong app hoàn tất và các route có kiểm chứng dữ liệu/provenance đầy đủ.
- Đã làm: chuyển formatter SQL thành component có line number/highlighting trong khi copy giữ nguyên SQL gốc; giữ user session qua reload trong tab; namespace lựa chọn và cache dữ liệu theo subject; nạp thông báo thực từ API monitoring kèm loading/error; thay nội dung mô tả lĩnh vực tĩnh bằng count từ API; thêm tests.
- Kiểm chứng: `npm test` 101 passed; `npm run build` PASS; `npm run test:e2e` 20 passed (các API trong E2E được giả lập, không phải live-system acceptance); `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: chưa cấu hình/kiểm chứng OIDC provider thật; SQL Import UI/API end-to-end còn thiếu; chưa nghiệm thu visual toàn bộ routes với ảnh tham chiếu; integration trên provider/warehouse thật không được chứng minh bởi E2E giả lập.
- Việc tiếp nối: mở PR FE riêng; sau đó thực hiện backend và AI/data theo các nhánh module, nghiệm thu bằng persistence/warehouse thật và cập nhật contract nếu phát sinh thay đổi.
- Commit/push: entry này được commit cùng thay đổi FE; SHA remote xác minh sau push.

### 2026-10-20 02:14 UTC+07 — Chuẩn hóa code frontend / conversation chính
- Nhánh / commit subject: `module/frontend-polish`; `style: format frontend sources and add format checks`.
- Phạm vi: format TypeScript/React/CSS/E2E, thêm lệnh Prettier tái sử dụng và tài liệu quy tắc style chung.
- Trạng thái: VERIFIED cho formatting và regression frontend; toàn bộ FE acceptance vẫn INCOMPLETE theo entry trước.
- Đã làm: format toàn bộ frontend sources và tests bằng Prettier; thêm `npm run format` và `npm run format:check`; đồng bộ EditorConfig, Black/isort config, code style documentation và AGENTS/CONTRIBUTING.
- Kiểm chứng: `npm run format:check` PASS; `npm test`, `npm run build`, `npm run test:e2e` chạy lại sau các thay đổi trên nhánh; `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: provider OIDC, SQL Import UI/API end-to-end và live-data/visual acceptance còn thiếu.
- Việc tiếp nối: cập nhật PR #2 và tiếp tục triển khai các workflow bắt buộc; code style không thay thế acceptance chức năng.
- Commit/push: entry này đi cùng commit; SHA remote xác minh sau push.


### 2026-10-20 02:11 UTC+07 — Chuẩn hóa AI/Data code / conversation chính
- Nhánh / commit subject: `module/ai-data`; `style: format AI and data source code`.
- Phạm vi: format Python AI service, tests và data scripts; chia system prompt thành các dòng đọc được; thêm cấu hình/hướng dẫn formatter.
- Trạng thái: VERIFIED cho formatter, AI regression và dữ liệu Chinook local; AI/Data acceptance tổng thể INCOMPLETE, không có thay đổi pipeline ingestion tổng quát hoặc SQL Import.
- Đã làm: format Black/isort; tách các câu SQL trong provisioning scripts thành nhiều dòng; nội dung system prompt được trình bày rõ hơn mà giữ các quy tắc sinh SQL hiện có.
- Kiểm chứng: `isort --check-only` PASS; `black --check` PASS; `pytest ai-service/test_app.py` 14 passed; `compileall` PASS; `python data/scripts/docker_chinook.py verify` xác nhận Chinook v1.4.5 cùng row counts và quyền reader chỉ đọc trên PostgreSQL, MySQL, SQL Server; `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: chưa thêm generic in-app ingestion/source registry; SQL Import end-to-end còn thiếu; chỉ Chinook sample được kiểm chứng, không đại diện cho toàn bộ data sources.
- Việc tiếp nối: triển khai các workflow data bắt buộc tổng quát bằng API/UI/warehouse thật; không coi sample provisioning là import tổng quát.
- Commit/push: entry này đi cùng commit; SHA remote xác minh sau push.

### 2026-10-20 02:36 UTC+07 — Khai báo quality/resource bounds cho pipeline sample / conversation chính
- Nhánh / commit subject: `module/ai-data`; dự kiến `feat: validate sample pipeline definitions`.
- Phạm vi: cấu hình pipeline Chinook ba engine, validator Python, bước provisioning writer, tests và ghi nhận gap source registry.
- Trạng thái: VERIFIED cho ba cấu hình sample và provisioning hiện có; ingestion source registry tổng quát vẫn INCOMPLETE.
- Đã làm: khai báo rõ output/required columns, giới hạn string, row, byte và timeout trên cả ba dialect; thêm validator từ chối field thừa/thiếu, identifier không an toàn, giới hạn ngoài bounds và credential không dùng environment reference. Chạy validate trước khi tạo quyền writer. Ghi rõ `data/chinook` chỉ là sample có provenance và không phải folder cần thêm cho từng warehouse; source registry/runtime vẫn là yêu cầu còn thiếu.
- Kiểm chứng: `pytest -q data/scripts/test_pipeline_config.py` — 7 passed; `python3 data/scripts/provision_pipeline.py` PASS; `python3 data/scripts/docker_chinook.py verify` PASS trên PostgreSQL/MySQL/SQL Server, expected counts và reader write denial khớp; Black/isort checks và `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: validator hiện chỉ kiểm tra ba config Chinook có sẵn; chưa có registry/API/UI để admin đăng ký pipeline khác từ application và chưa chứng minh cross-domain ingest tổng quát. Controlled SQL Import và OIDC provider cũng chưa hoàn tất.
- Việc tiếp nối: tích hợp registry-backed pipeline CRUD/validation/execution với FE và thêm test nguồn tùy biến trên cả ba engines; tiếp tục SQL Import/OIDC acceptance.
- Commit/push: entry này đi cùng commit; SHA remote xác minh sau push.

### 2026-10-20 12:40 UTC+07 — Typed pipeline metadata và writer riêng cho SQL Import / conversation chính
- Nhánh / commit subject hoặc SHA đã biết: `module/data-ingestion`; dự kiến `feat: provision isolated import writers and type pipeline outputs`.
- Phạm vi: validator/cấu hình pipeline sample, provisioning table theo logical column type, quyền import tách biệt cho PostgreSQL/MySQL/SQL Server, contract ingestion và tài liệu trạng thái.
- Trạng thái: VERIFIED cho schema/config validation và tài khoản writer hẹp trên ba Docker engine; generic ingestion runtime và import end-to-end qua Java/FE vẫn INCOMPLETE.
- Đã làm: thêm `sourceWarehouseId`/`sourceDatasetId`, explicit allowlist nguồn cho provisioning sample, canonical column types (`STRING`, `INTEGER`, `DECIMAL`, `BOOLEAN`, `DATE`, `TIMESTAMP`) và validation chéo cấu hình; table stage/mart được tạo theo type khai báo. Thêm writer `nla_importer` trong namespace `nla_import` riêng từng engine, không tái dùng reader/ELT writer; quyền ngoài namespace bị từ chối. Tài liệu contract chỉ rõ sample `sourceObjects` là metadata provisioning nội bộ, còn app phải lấy allowlist từ dataset đã đăng ký. Secrets lưu trong `.local/docker.env` bị ignore, không commit.
- Kiểm chứng: `pytest data/scripts/test_pipeline_config.py` — 15 passed; Black/isort check, compileall và `git diff --check` PASS; `docker_chinook.py provision-import` PASS, kiểm tra tạo/ghi/đọc probe và từ chối tạo ngoài namespace trên cả ba engine; `docker_chinook.py verify` PASS, row counts đúng (15,607 tổng) và reader write denied trên PostgreSQL/MySQL/SQL Server.
- Còn thiếu / blocker / phụ thuộc: pipeline app vẫn chỉ provision các config Chinook; chưa chứng minh API/UI đăng ký nguồn khác, chạy ingestion generic, hay upload-preview-confirm SQL Import qua caller thật và persistence. Cần tích hợp với BE/FE; OIDC provider cũng chưa cấu hình.
- Việc tiếp nối: đồng bộ contract branch này vào BE/FE; nghiệm thu import và ingestion bằng API/UI thật, dữ liệu lưu bền trên cả ba engine, và ghi outcome sau khi agent hoàn tất.
### 2026-10-20 01:56 UTC+07 — Chuẩn hóa code backend / conversation chính
- Nhánh / commit subject: `module/backend`; `style: format backend code for review`.
- Phạm vi: format toàn bộ Java backend và tests; bổ sung quy tắc formatter chung để không tiếp tục nén nhiều lệnh trên một dòng.
- Trạng thái: VERIFIED cho không thay đổi hành vi và regression suite backend; backend acceptance tổng thể INCOMPLETE, vì task này không triển khai SQL Import/ingestion tổng quát/OIDC.
- Đã làm: format Java bằng Google Java Format; bổ sung hướng dẫn code style và sửa hướng dẫn CONTRIBUTING đã lỗi thời, nói repo chỉ là bộ tài liệu.
- Kiểm chứng: `NLA_INTEGRATION=true NLA_TESTCONTAINERS=true mvn test` — 27 passed, 0 failed, 0 skipped; gồm 3 adapter Testcontainers và live warehouse tests trên ba engine; `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: không có thay đổi runtime trong task format; SQL Import end-to-end và các acceptance bắt buộc khác vẫn chưa triển khai/xác minh.
- Việc tiếp nối: hoàn tất implementation BE theo acceptance; không coi regression test hiện có là bằng chứng SQL Import hoặc ingestion tổng quát đã chạy.
- Commit/push: entry này đi cùng commit; SHA remote xác minh sau push.

### 2026-10-20 02:34 UTC+07 — Mở rộng ghi pipeline theo schema đã đăng ký / conversation chính
- Nhánh / commit subject: `module/backend`; dự kiến `feat: validate and write configured pipeline columns`.
- Phạm vi: `PipelineService`, kiểm tra cấu hình pipeline, ghi staging/mart và unit regression tests.
- Trạng thái: VERIFIED cho thực thi ingestion Chinook hiện có trên PostgreSQL, MySQL, SQL Server; target ingestion tổng quát và SQL Import vẫn INCOMPLETE.
- Đã làm: bỏ giả định `country/total` khỏi phần Java ghi pipeline; dùng danh sách cột đã đăng ký, quote identifier theo dialect, bind giá trị theo kiểu dữ liệu metadata nguồn, kiểm tra schema bảng đích, kiểm tra required fields/giới hạn text và giới hạn tài nguyên có trần. Lỗi chạy pipeline không còn mô tả cố định là dữ liệu Chinook.
- Kiểm chứng: `mvn test` — 27 tests, 0 failures, 5 integration/Testcontainers skipped trong lần unit run; `python3 infra/local/test_backend.py` PASS (Testcontainers cho 3 engine); `python3 infra/local/smoke.py` PASS trên dịch vụ thật, query/ingestion/idempotency/evaluation chạy trên ba database đã provision; Google Java Format và `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: runtime sources vẫn là ba pipeline Chinook cấu hình sẵn; chưa có đăng ký/configuration UI/API tổng quát, chưa có file upload SQL Import, OIDC provider chưa cấu hình. Unit và Chinook smoke không chứng minh mọi pipeline/schema tùy ý.
- Việc tiếp nối: mở rộng data configuration và tests trên nhánh `module/ai-data`; triển khai các API/UI mandatory còn thiếu với acceptance end-to-end.
- Commit/push: entry này đi cùng commit; SHA remote xác minh sau push.

### 2026-10-20 14:08 UTC+07 — Sửa source allowlist PostgreSQL khớp tên vật lý / conversation chính
- Nhánh / commit subject hoặc SHA đã biết: `module/data-ingestion`; dự kiến `fix: match postgres pipeline source table casing`.
- Phạm vi: cấu hình sample pipeline PostgreSQL và test đối chiếu tên bảng allowlist với physical table của ba engine.
- Trạng thái: VERIFIED cho tên bảng config; generic source registry/runtime vẫn INCOMPLETE theo entry trước.
- Đã làm: sửa allowlist PostgreSQL từ `"Invoice"` sang `"invoice"` vì provisioner tạo bảng không quote tên chữ thường; MySQL/SQL Server giữ `Invoice`. Nếu giữ identifier hoa và quote như cũ, lệnh `GRANT SELECT` trong provisioning mới sẽ tìm sai relation PostgreSQL.
- Kiểm chứng: `pytest data/scripts/test_pipeline_config.py` — 15 passed; Black/isort, compileall và `git diff --check` PASS; áp dụng lệnh `source_grants` với admin account lên PostgreSQL/MySQL/SQL Server local đều phân giải đúng physical table.
- Còn thiếu / blocker / phụ thuộc: đây chỉ là sửa config sample; không chứng minh ingestion app tổng quát hoặc SQL Import end-to-end.
- Việc tiếp nối: BE cần lấy follow-up Data commit trước khi nghiệm thu/cherry-pick config mẫu mới.
- Commit/push: entry này đi cùng commit; SHA remote xác minh sau push.

### 2026-10-20 16:39 UTC+07 — Bốn lớp pipeline và SQL Import matrix thật / conversation chính
- Nhánh / commit subject: `module/data-ingestion`; `feat: provision four pipeline layers and verify SQL import matrix`.
- Phạm vi: sample pipeline configs/validator/provisioning, import namespace grants, reusable local HTTP/database acceptance runner và provenance/security docs.
- Trạng thái: VERIFIED cho provisioning raw/staging/warehouse/mart và grant isolation; Java API SQL Import matrix PASS trên snapshot tích hợp đang phát triển. Bốn lớp ingestion qua caller thật/FE và Git SHA tích hợp cuối vẫn chờ nghiệm thu, không dùng provisioning để báo hoàn tất app.
- Đã làm: yêu cầu bốn target riêng `raw`, `stage`, `warehouse`, `mart`; thêm `nla_raw_sales`/`nla_warehouse_sales`, typed columns và SELECT/INSERT/DELETE grant cho sample writer trên ba engine. Existing clone thêm bảng thiếu mà không tạo lại tài khoản/ghi đè dữ liệu. Import writer có INDEX/REFERENCES hẹp trong namespace import để hỗ trợ index/FK đã validate. Thêm verify_sql_import.py chỉ chạy loopback/Docker sample: chín cặp source→target, upload/preview/digest/async confirm/poll/idempotency/run persistence, kiểm tra độc lập rows/decimal/NULL thật và controlled unsafe/UTF-8 failures; tự dọn đúng bảng test duy nhất, không nhận SQL tùy ý.
- Kiểm chứng: pytest pipeline config 16 PASS; Black/isort/compileall/diff check PASS; `provision_pipeline.py` PASS trên ba engine; `docker_chinook.py provision-import` PASS grant probes; `docker_chinook.py verify` PASS counts 15,607 và reader write denied cho cả ba. `verify_sql_import.py --base-url http://127.0.0.1:8086/api/v1` PASS cả chín cặp, real Java HTTP và DB, không mocks; source snapshot hash `e9dd4cea258f04a1b8eef5782a4fa5677c02e417ce605d8de940629b140cbbe3` (nối tên+bytes Parser/Executor/Service trong .local/import-http). Report an toàn nằm trong ignored .local/application-import-report.json.
- Còn thiếu / phụ thuộc: BE đang hoàn thiện runner bốn lớp và source registry; FE browser/import/ingestion và bộ kiểm chứng trên Git SHA cuối chưa chạy trong commit Data này. Script/config Chinook vẫn chỉ là provenance-bound sample; warehouse mới dùng registry chung, không tạo data/<source> mỗi lần.
- Việc tiếp nối: merge Data cùng BE/FE/OIDC branches rồi chạy lại API/browser/security acceptance; provider thật còn cần cấu hình server.
- Commit/push: entry đi cùng commit; xác minh SHA local/remote sau push/pull.

### 2026-10-20 12:24 UTC+07 — Hoàn thiện AI service và evaluation corpus / module AI
- Nhánh / commit subject hoặc SHA đã biết: `module/ai-completion`; dự kiến `feat: harden AI generation and expand evaluation corpus`.
- Phạm vi: `ai-service/app.py`, `ai-service/test_app.py`, corpus evaluation AI/Chinook, `docs/current-review.md` và tài liệu evaluation.
- Trạng thái: VERIFIED cho strict request/context validation, deterministic candidate cases, mocked provider HTTP/error paths, safe rejection và format checks; AI acceptance tổng thể INCOMPLETE.
- Đã làm: thay dict lồng lỏng bằng nested strict models; validate tham chiếu bảng/cột/metric/dimension/relationship/example, enum dialect và duplicate names; chọn example theo dialect; candidate checks cho multi-statement, comment, thao tác ghi, một số hàm/file/network và dialect mismatch; provider không fallback khi lỗi, bounds URL/timeout/response, lỗi trả về đã sanitize. Bổ sung provider mock cho success/unavailable/timeout/malformed/unsafe SQL, deterministic ambiguity/schema checks và corpus support tổng hợp chỉ dành evaluation. Đánh `logicalCaseId`/domain cho Chinook và support; corpus có 42 logical cases × 3 dialect = 126 case/dialect combinations theo cách đếm các bản dịch EN/VI chung intent. Không thay Java–Python contract.
- Kiểm chứng: `python3 -m pytest ai-service -q` — 36 passed, 1 skipped; real-provider smoke skip vì không có `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`; `isort --check-only` PASS; `black --check` PASS; `compileall` PASS; JSON parse mọi corpus PASS; `git diff --check` PASS. Một warning từ Starlette về đường tương thích `httpx` của TestClient, không làm fail tests.
- Còn thiếu / blocker / phụ thuộc: chưa smoke provider thật do chưa cấu hình env; synthetic support không có warehouse vật lý và chưa được thực thi qua Java, nên chưa chứng minh result equivalence; không tuyên bố provider-quality, Java executor integration hay full AI acceptance đã pass.
- Việc tiếp nối: tích hợp nhánh này với BE/FE, chạy provider thật khi có cấu hình bí mật hợp lệ, và đưa evaluation qua Java executor/warehouse thật cho đủ domain trong điều kiện nguồn dữ liệu có thật.
- Commit/push: entry này đi cùng commit; SHA sau push sẽ được đối chiếu và bàn giao riêng.

### 2026-10-20 14:41 UTC+07 — Rà soát context boundary AI / module AI
- Nhánh / commit subject hoặc SHA đã biết: `module/ai-completion`; dự kiến `fix: enforce selected AI context boundary`.
- Phạm vi: `ai-service/app.py`, `ai-service/test_app.py`, evaluation support fixture, role/evaluation/current-review docs.
- Trạng thái: VERIFIED cho selected-context validation, deterministic example scope, provider payload privacy regression và song ngữ corpus inventory; AI acceptance tổng thể vẫn INCOMPLETE.
- Đã làm: candidate metrics/dimensions/chart được validate theo chính semantic context đã chọn gửi provider; deterministic lookup cũng bị giới hạn trong examples đã chọn. Thêm test xác nhận provider payload không nhận warehouse/dataset IDs hoặc credential fields, và candidate không được chọn metric ngoài selected context. Bổ sung câu hỏi tiếng Việt cho hai logical rejection cases của synthetic support để mỗi logical case có phrasing Việt/Anh trên cả ba dialect. Cập nhật hướng dẫn và ghi rõ Java vẫn phải làm identifier validation AST authoritative.
- Kiểm chứng: `ai-service/.venv/bin/python -m pytest ai-service -q` — 38 passed, 1 skipped; isort check PASS; Black check PASS; compileall PASS; mọi evaluation JSON parse PASS; `git diff --check` PASS. Một Starlette/AnyIO deprecation warning, không làm fail tests.
- Còn thiếu / blocker / phụ thuộc: real-provider smoke NOT RUN vì chưa có `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`; Java executor/result-equivalence cho domain support chưa chạy; Python không thay SQL AST identifier validation hoặc Java execution.
- Việc tiếp nối: push nhánh sau commit và xác minh SHA; chạy provider thật và Java-backed evaluation khi có cấu hình provider/warehouse phù hợp.
- Commit/push: entry này dự kiến nằm trong commit; SHA remote xác minh sau push.

### 2026-10-20 16:45 UTC+07 — Ghép nhánh AI và Data / conversation chính
- Nhánh / commit subject: `module/integration-final`; `merge: combine AI completion with verified data provisioning`.
- Phạm vi: merge module/ai-completion và module/data-ingestion, giữ toàn bộ work-log entries của hai phía.
- Trạng thái: INTEGRATION IN PROGRESS; không đổi claim các kiểm chứng module thành E2E đã hoàn tất.
- Kiểm chứng: resolve append-only work log không mất entry; `git diff --check` PASS; upstream AI38PASS/1provider smokeSKIP và Data16PASS/9realHTTPimport cases được giữ trong entry gốc. Combined test/build chưa chạy, còn chờ BE/FE/OIDC.
- Còn thiếu / tiếp nối: ghép các module còn lại và kiểm chứng trên SHA tích hợp cuối; provider thật thiếu cấu hình server.
- Commit/push: commit merge đi cùng entry; push/SHA đối chiếu sau khi integration checks hoàn tất.

### 2026-10-20 15:29 UTC+07 — Khảo sát source platform và định hướng connector / conversation chính
- Nhánh / commit subject: `module/platform-reuse`; `docs: map reusable platform sources and future connectors`.
- Phạm vi: AGENTS, README, architecture, data sources, decision log, tài liệu platform reuse/future connectors và inventory SHA-256 hai snapshot người dùng chỉ định trong Downloads.
- Trạng thái: VERIFIED cho khảo sát/documentation và hashes; tích hợp/build/runtime của hai bộ nguồn NOT RUN/INCOMPLETE, không phải capability đã triển khai.
- Đã làm: đọc README/license/manifests và code semantic planner/bindings/metadata/query connector, Go source/tool/auth/toolset; lập bảng module→consumer→acceptance và ưu tiên tái sử dụng implementation thật. Ghi đủ 18 nguồn engine/storage/file người dùng yêu cầu cùng capability/security/contract requirements. Chốt tên sản phẩm riêng, lưu tên nguồn chỉ trong provenance; root licenses kiểm tra là Apache-2.0 nên giữ notice/attribution liên quan khi phân phối, không xóa để đổi branding. Chưa thấy Git metadata hoặc thỏa thuận license riêng trong snapshot đã đọc; không bịa commit ID.
- Kiểm chứng: JSON parse PASS; SHA-256 các file khảo sát/license khớp snapshot PASS; local Markdown links trong các tài liệu liên quan PASS; danh mục đủ 18 nguồn PASS; `git diff --check` PASS. Snapshot semantic 1,234 files, tool runtime 2,062 files; inventory hashes ghi trong JSON, không copy application source/credentials/logo vào repository.
- Còn thiếu / phụ thuộc: chưa build/adopt upstream artifact hoặc chạy connector; cần pin artifact/dependency closure, mapping shared semantic/contracts, private service integration và acceptance trên nguồn thật trước claim support. Các phần mandatory FE/BE/import/ingestion/OIDC hiện tại tiếp tục độc lập, không bị chuyển sang future work.
- Việc tiếp nối: áp dụng theo platform-reuse.md trong task triển khai có caller thật; đồng bộ tài liệu vào nhánh tích hợp sau khi các module agent hoàn tất.
- Commit/push: entry đi cùng commit; đối chiếu SHA local/remote sau push và pull trong bàn giao.

### 2026-10-20 16:47 UTC+07 — Đồng bộ định hướng platform reuse / conversation chính
- Nhánh / commit subject: `module/integration-final`; `merge: include reviewed platform reuse and connector direction`.
- Phạm vi: merge tài liệu module/platform-reuse, giữ work-log Data/AI và source inventory.
- Trạng thái: VERIFIED cho doc merge; chưa tích hợp runtime upstream hoặc hoàn tất app acceptance.
- Kiểm chứng: local link/JSON/hash checks đã chạy ở source branch; `git diff --check` PASS cho merge; không thêm application source/dependencies từ hai downloaded repos.
- Còn thiếu / tiếp nối: BE/FE/OIDC và kiểm chứng combined SHA vẫn đang thực hiện; connector tương lai không phải current runtime support.
- Commit/push: commit merge đi cùng entry; push/SHA đối chiếu sau integration checks.

### 2026-10-20 17:02 UTC+07 — Evaluation domain thứ hai qua Java/database thật / conversation chính
- Nhánh / commit subject: `module/integration-final`; `test: verify cross-domain execution and decimal means`.
- Phạm vi: local synthetic acceptance runner, support-domain corpus AVG mapping và evaluation documentation.
- Trạng thái: VERIFIED cho 108 câu hỏi Việt/Anh/rejection qua Java→Python→PostgreSQL/MySQL/SQL Server trên backend snapshot local8086; nghiệm thu combined Git SHA và provider API thật vẫn chờ.
- Đã làm: tạo table tên ngẫu nhiên với 12 bản ghi synthetic, đăng ký dataset/semantic model qua API Java thật, chạy 36 cases mỗi engine và so sánh độc lập expected rows từ SQLite (mean tolerance0.000001), chart/rejection status/history ID. Dọn table và disable dataset test để giữ provenance history; không bootstrap/seed fixture vào runtime/UI sản phẩm. Lần chạy đầu phát hiện AVG(integer) bị SQL Server truncate và MySQL scale4; sửa examples/metrics/expected SQL sang AVG(CAST(... AS DECIMAL(38,10))) thay vì nới tolerance để che sai khác.
- Kiểm chứng: Python AI38PASS/1SKIP (provider thực chưa có config); real cross-domain108/108PASS; Black/isort/compile/diff checkPASS. Report không có secrets/raw rows ở ignored .local/cross-domain-report.json. Cùng Chinook corpus, inventory42logical intents/2domains/3dialects có candidate tests; acceptance này chứng minh thêm 18logical intents synthetic (36phrasings×3engines), không tự suy ra toàn bộ evaluation platform đã generic.
- Còn thiếu / phụ thuộc: Java built-in evaluation suite hiện còn Chinook-specific; combined app SHA, FE browser và deployment/OIDC final rerun đang thực hiện. Provider thật NOT RUN do thiếu cấu hình. Không claim vượt qua các mục này bằng test fixture.
- Việc tiếp nối: ghép module branches và chạy lại caller/database tests trên code tích hợp; rà soát evaluation suite config cùng shared API.
- Commit/push: entry đi cùng commit; push/SHA xác minh sau khi kết thúc integration.

### 2026-10-20 17:22 UTC+07 — Catalogue evaluation cấu hình ngoài business core / conversation chính
- Nhánh / commit subject: `module/data-ingestion`; `feat: configure evaluation suites outside backend core`.
- Phạm vi: data/evaluation/suites.json, support corpora và provenance/how-to.
- Trạng thái: VERIFIED cho catalog/corpus metadata; Java consumer 3testsPASS ở BE worktree, final merged runtime còn chờ.
- Đã làm: catalogue server-managed ánh xạ suite/engine→case file dưới data root; count lấy từ corpus thay hardcode. Giữ Chinook48phrasings/engine và thêm synthetic support36phrasings/engine với sourceSHA; không seed fake warehouse/UI từ corpus. Supportmean dùng explicitdecimalcast khắc phục sai khác AVGinteger thật đã đo được. Suite mới là config, không ifdomain/adapter hay foldermỗiwarehouse.
- Kiểm chứng: JSON/matching suiteId/engine/case countsPASS; generic Java EvaluationCorpusTest3PASS (configurable domain, traversaldeny, derived checked-incounts) với data root integration. Synthetic source đã có38AItestsPASS/1providersmokeSKIP và108realJavaDBcasesPASS ở integration entry trước; không coi catalog này là providerquality acceptance.
- Còn thiếu / tiếp nối: merge BEconsumer và data catalogue, regenerate consumercontracts và rerun serviceevaluation trên finalSHA. `synthetic-support.json` gốc đã sửaAVG ở module/integration-final; khi merge phải giữ snapshot hash thống nhất.
- Commit/push: entry đi cùng commit; đối chiếu SHA sau push/pull.

### 2026-10-20 17:25 UTC+07 — Ghép evaluation catalogue / conversation chính
- Nhánh / subject: `module/integration-final`; `merge: include configured evaluation corpus`.
- Phạm vi: merge Data catalogue với integration đã có synthetic AVG correction.
- Trạng thái: VERIFIED cho merge/corpus consistency; fullappintegration đang thực hiện.
- Kiểm chứng: work-log append giữ cả hai phía; suite/engine/count và synthetic sourceSHA đối chiếuPASS; diffcheckPASS. BEgenericconsumer3testsPASS ở moduleworktree; runtime rerun chưa claim trong merge này.
- Còn thiếu / tiếp nối: FE/BE/OIDCmerge và combinedSHAacceptance/providerconfig.
- Commit/push: entry cùng merge; remoteSHA đối chiếu cuối.
### 2026-10-20 15:38 UTC+07 — Runtime OIDC / subagent runtime_auth
- Nhánh / commit subject: `module/runtime-auth`; `feat: add reproducible local OIDC identity provider`.
- Phạm vi: Keycloak Docker local, realm/public client/role/audience mapping, private credential generation, launcher/profile OIDC, README/OIDC guide và browser acceptance script.
- Trạng thái: VERIFIED cho IdP runtime, discovery và login callback/token thực; OIDC acceptance tổng thể INCOMPLETE do kiểm tra permission trên BE baseline cũ phát hiện HTTP 500 thay vì 403. Đã gửi reproduction tới BE agent, sẽ chạy lại trên BE đã tích hợp.
- Đã làm: pin Keycloak 26.8.1, bind loopback 8180 và persistent volume riêng; sinh mật khẩu ngẫu nhiên vào `.local/oidc/` ignored với permission 0600; public client authorization code + PKCE S256 bắt buộc, tắt implicit/password grant, map `roles` trong access/ID token và audience `nla-api`. Profile `oidc-local` dùng xác thực JWT thật với issuer/audience; launcher `--auth oidc` tắt local token/anonymous mode. Format ba script infra Python cũ bằng Black/isort, không nén nhiều statement trên một dòng.
- Kiểm chứng PASS: unit `pytest infra/local/test_oidc.py` — 3 passed; Black/isort check, compileall, Prettier cho browser script/Compose, Compose config, `git diff --check`; Keycloak Docker health và discovery issuer chính xác; browser React tại 5175 đăng nhập Keycloak thật và callback về `/query`; Java 8083 nhận access token thật, reject anonymous API và password sai ở IdP.
- Kiểm chứng FAIL: browser suite không mock phát hiện VIEWER gọi API quản trị `/warehouses/wh-chinook-pg/test` nhận 500 ở BE baseline cũ (phải 403); report `.local/oidc-browser-report.json`, không token/password. Chưa chạy hết logout/renewal/expiry/resource-denial suite sau điểm fail này. Không coi cấu hình hoặc login happy path là nghiệm thu đủ.
- Còn thiếu / phụ thuộc: cần BE hiện tại với error mapping chuẩn để chạy hết browser suite; full application-container deployment và production HTTPS/IdP chưa được nghiệm thu bởi local check. Cấu hình dev IdP không thay thế các controls production.
- Việc tiếp nối: tích hợp commit runtime với BE mới, chạy lại browser suite thật bốn roles/401/403/renewal/expiry/signout; giữ secrets ngoài Git và cập nhật evidence riêng.
- Commit/push: entry dùng subject + branch cho chính commit; SHA local/remote xác minh sau push/pull trong handoff.

### 2026-10-20 16:18 UTC+07 — Nghiệm thu browser OIDC thật / subagent runtime_auth
- Nhánh / commit subject: `module/runtime-auth`; `fix: preserve OIDC principal and verify live auth boundaries`.
- Phạm vi: default Keycloak scope `basic` để access token có subject; kiểm tra subject browser/Java; negative test token được ký thật nhưng thiếu subject; credential recovery/bounds, test runtime và tài liệu OIDC.
- Trạng thái: VERIFIED cho đăng nhập OIDC local qua IdP/React/Java thật và bốn vai trò. Tổng acceptance sản phẩm vẫn INCOMPLETE theo các module còn mở; đây không phải evidence production deployment hoặc full application-container stack.
- Đã làm: sửa scope IdP thiếu `basic` phát hiện bởi audit actor NULL trong test trước; bổ sung regression assertion và kiểm tra identity equality; BE agent đồng thời thêm validator từ chối JWT thiếu `sub`. Browser suite tạo public client âm tạm trong IdP, lấy valid-signed access token không có subject, xác nhận API trả 401 rồi xóa client. Mọi request test có timeout và chỉ chấp nhận loopback URL; không ghi token/password/trace. `init` bảo toàn credential khi khôi phục file runtime và fail closed khi account JSON sai.
- Kiểm chứng PASS: `OIDC_TEST_API_URL=http://127.0.0.1:8084/api/v1 node infra/local/oidc-browser.mjs` — bốn role VIEWER/ANALYST/OPERATOR/ADMIN đăng nhập và đăng xuất qua IdP thật; invalid password; Java/browser subject equality; anonymous/signed wrong-audience/tampered signature/expired token/missing subject đều 401; thiếu admin role hoặc resource grant là 403; ADMIN kiểm tra kết nối PostgreSQL Chinook thật thành công; automatic renewal, callback error và IdP session logout PASS. Report an toàn: `.local/oidc-browser-report.json` (`mocked=false`, `status=PASS`).
- Môi trường evidence: Keycloak Docker 26.8.1 tại 8180; React branch runtime tại 5175; bản sao chỉ đọc BE đang phát triển tại 8084 với profile OIDC, source snapshot SHA-256 `718396027e81a35849d28b0b91ed7acb18c962da8454006cb0d65ed6349449b9`. Không sửa source/target của BE agent. Phải chạy lại trên nhánh tích hợp đã commit trước nghiệm thu release cuối; không gán snapshot này cho một SHA Git chưa tồn tại.
- Kiểm chứng bổ sung PASS: unit `pytest infra/local/test_oidc.py` — 4 passed; Black/isort, compileall, Prettier, Node syntax check, Compose config và `git diff --check`. Keycloak health/discovery được kiểm tra thật; default scope mapping đối chiếu tài liệu chính thức Keycloak.
- Còn thiếu / NOT RUN: production HTTPS/IdP/multiple-node deployment và full app containers chưa được nghiệm thu trong task OIDC; query/provider AI và SQL Import/ingestion không được chứng minh bởi bộ test auth này. Entry FAIL trước đã được xử lý trong cấu hình/runtime evidence local hiện tại.
- Việc tiếp nối: root tích hợp runtime commit với BE security mới, chạy lại browser suite trên Git SHA tích hợp và lưu kết quả; dùng account/grant thực cho dataset ngoài test.
- Commit/push: entry này đi cùng commit subject nêu trên; SHA local/remote được xác minh sau push/pull trong handoff.

### 2026-10-20 19:31 UTC+07 — Full application Docker packaging / subagent runtime_auth
- Nhánh / commit subject: `module/runtime-auth`; `feat: package application services with isolated Compose runtime`.
- Phạm vi: Dockerfiles ba app services, app Compose overlay, env/secret generator, metadata database riêng, registry bootstrap qua OIDC/Java API, Nginx routing, kiểm thử packaged browser và tài liệu Quick Start.
- Trạng thái: VERIFIED cho image build, container health, private configuration và luồng packaged app thực trên ba engines. Acceptance release tích hợp vẫn INCOMPLETE cho đến khi root rebuild/rerun trên SHA kết hợp FE/BE/AI cuối; không gán WIP snapshot cho commit Git chưa tồn tại.
- Đã làm: immutable-digest base images cho Node22, Maven/Temurin21, Python3.12 và Nginx unprivileged; `.dockerignore` loại credentials/local artifacts. App chạy non-root/read-only filesystem/dropped capabilities, writable tmpfs riêng; Python không publish host port, không nhận database credential. Java dùng service token riêng tới Python, endpoint warehouse lấy registry hostname Compose, metadata `nla_metadata_compose` tách host registry. OIDC public issuer được validate độc lập với internal JWKS URL; API registry bootstrap dùng confidential service principal, không dùng local bypass. Frontend đóng gói chỉ cho HTTP OIDC khi build flag tường minh và cả authority/app đều loopback; mặc định remote vẫn cần HTTPS. Nginx access log không ghi query string/token/header; SQL upload bound và API timeout có cấu hình.
- Kiểm chứng PASS: build thật cả frontend/backend/python-ai images bằng Docker BuildKit; Compose config validation; DB3 + ba app containers + Keycloak đều healthy; non-root/read-only-rootfs xác minh qua Docker inspect và Python không có published port. Register/test/discover/semantic update qua Java API thật PASS ba engine. `python3 infra/local/compose.py verify` — Java container → private Python container → PostgreSQL/MySQL/SQL Server thật trả 3,503 tracks và 11 source tables mỗi engine.
- Kiểm chứng browser PASS: `node infra/local/compose-browser.mjs` — production React bundle tại 4173 đăng nhập IdP thật rồi gửi câu hỏi trong UI và render kết quả SUCCESS/3.503 trên cả ba engine; không API interception. `OIDC_TEST_APP_URL=http://127.0.0.1:4173 OIDC_TEST_API_URL=http://127.0.0.1:8085/api/v1 node infra/local/oidc-browser.mjs` — đủ bốn roles, actual renewal/expiry/logout, 401/403 và valid-signed missing-sub rejection PASS. Safe reports trong `.local/compose-app/` và `.local/oidc-browser-report.json`, không secrets/trace.
- Regression PASS: frontend Vitest 109 passed (gồm 8 authority transport tests), production build; Python infra tests 7 passed; Black/isort, Prettier, compileall, Node syntax, Google Java Format cho health probe, `git diff --check`.
- Môi trường evidence: backend container dùng bản copy read-only BE đang phát triển, SHA-256 source `c2aa7cd3ad216579adc08562ab13df74d125ae260066c6d7a5ce14d0c0a7fae4`; đã bao gồm internal JWKS và subject guard của BE agent. FE/AI image dùng source hiện tại branch runtime. Không sửa worktree/source/target của BE agent. Build checkout riêng cũng PASS; bootstrap/strict-security evidence cần BE contract mới được merge.
- Còn thiếu / NOT RUN: chưa chạy clean-machine download/provision từ zero volumes hoặc release production HTTPS/multiple-node. Không có provider key nên provider API thật NOT RUN; deterministic mode được chọn tường minh và không claim AI tổng quát. SQL Import/ingestion acceptance do module riêng kiểm chứng, không được suy từ query/packaging PASS. Root phải rebuild tất cả images và rerun trên branch tích hợp đã commit.
- Việc tiếp nối: tích hợp runtime commits với BE/FE/AI mới, giữ `.local/oidc/` khớp persistent IdP volume, chạy `compose.py up`, `verify` và hai browser scripts trên SHA tích hợp. Host Quick Start tiếp tục dùng ports 5173/8080 và metadata database cũ.
- Commit/push: entry này đi cùng commit subject nêu trên; SHA local/remote được xác minh sau push/pull trong handoff.

## 2026-10-20T19:36+07:00 — Root / integrated Docker and OIDC packaging

- Branch: `module/integration-final`; commit subject: `merge: integrate authenticated application packaging`.
- Merged `module/runtime-auth` at `787dbc4`; preserved both histories and work log entries. Full application Dockerfiles, private Compose networks, real local IdP and browser verification scripts now accompany integrated Data/AI changes.
- Checks: merge conflict confined to appended work log and resolved by retaining both; `git diff --check` PASS. Runtime agent evidence applies to its recorded backend source snapshot; final committed integration rebuild/browser tests PENDING. No provider configured; real-provider smoke NOT RUN by user choice while awaiting key.
### 2026-10-20 19:33 UTC+07 — Hoàn thiện backend ingestion, SQL Import và registry evaluation / conversation BE
- Nhánh / commit subject: `module/backend`; `feat: complete guarded imports and four-layer ingestion`.
- Phạm vi: SQL Import đã xác thực và preview, OIDC/resource authorization, registry ingestion có nguồn/đích thật, bốn lớp ghi dữ liệu, evaluation corpus do server quản lý, migration/audit, test thực và contract.
- Trạng thái: VERIFIED cho kiểm thử backend và HTTP/DB ingestion ba engine cùng luồng PG→MySQL; chưa đánh dấu toàn hệ thống ACCEPTED trước E2E cuối React→Java, đăng nhập provider và AI provider.
- Đã làm: pipeline source registry lưu cấu hình typed, kiểm tra table/column/type, giới hạn và quyền trên source lẫn target. Mỗi lần chạy thay snapshot trong RAW, ghi STAGING, materialize WAREHOUSE rồi publish MART trong một transaction; từng lớp kiểm row count, lỗi rollback không báo lớp là đã lưu, idempotency theo principal/source/payload. SQL Import dùng canonical plan preview bất biến, parser theo dialect, bind literal, execution queue/deadline và trạng thái tiến độ/persistence; không thực thi nguyên văn file. Thêm tùy chọn internal OIDC JWKS URI trong khi vẫn kiểm issuer/audience/subject; evaluation suite/corpus đọc từ manifest có kiểm soát thay vì hardcode miền trong core. Mọi credential writer theo từng warehouse, write-only qua env reference; không ghi secret vào response/log.
- Kiểm chứng: `python3 infra/local/test_backend.py -Dnla.data.root=/Users/toanlamsaoduocc/Documents/ChatGPT/text-to-sql-data/data` — 52 tests, 0 failures, 0 skipped; bao gồm Testcontainers PostgreSQL/MySQL/SQL Server, query security, parser/executor SQL Import và live writer privilege. Backend HTTP trên PostgreSQL/MySQL/SQL Server chạy `/test` và `/run` qua đủ bốn target; mỗi run ghi 24 dòng, 4 bước SUCCESS, replay cùng idempotency key trả cùng run ID. HTTP PG→MySQL đăng ký/test/run cũng ghi đủ bốn lớp và 24 dòng. `git diff --check`, Java Google formatter và `python3 -m py_compile infra/local/smoke.py` PASS. Conversation runtime-auth chạy browser OIDC suite trên snapshot riêng (4 role, audience/signature/subject, forbidden resource, renewal/expiry, logout) PASS; cần lặp lại trên commit tích hợp cuối.
- Còn thiếu / blocker / phụ thuộc: FE browser flow tạo/sửa/test/run/history cần chạy với API sau khi hợp nhất; provisioning/four-layer manifest cần merge từ `module/data-ingestion` SHA `cbed547`; toàn stack React→Java→Python→warehouse và real provider E2E chưa được chạy sau commit; API key/model provider vẫn được chủ dự án hoãn.
- Việc tiếp nối: hợp nhất module backend và data, chạy lại OIDC/FE/integration browser trên final SHA; chỉ khi caller thực, persistence, AI provider và ba engine đạt acceptance thì cập nhật trạng thái toàn sản phẩm.
- Commit/push: entry này được commit cùng backend changes; kiểm tra SHA remote/local sau push.

## 2026-10-20T19:40+07:00 — Root / integrated backend contracts and execution

- Branch: `module/integration-final`; commit subject: `merge: integrate guarded imports and ingestion backend`.
- Merged published BE `c9ae611`, preserving history. Resolved shared contract to actual four-layer source API and retained all work logs; selected updated four-layer smoke script.
- Checks: `git diff --check` and Python compile PASS. BE agent 52/52 backend tests and actual four-layer HTTP DB3/cross-engine checks apply to its published commit. Final integrated rebuild and UI checks remain PENDING; real provider NOT RUN because key deferred.

## 2026-10-20T19:51+07:00 — Root / shared private provider configuration

- Branch: `module/integration-final`; commit subject: `fix: isolate host service configuration and document provider file`.
- Host launcher and Docker use the same ignored `.local/compose-app/provider.env`; added blank safe example and exact restart instructions. Host launcher filters provisioned configuration by consumer: Python receives service/provider values, frontend only public Vite/proxy values, Java receives runtime readers/writers/metadata and model name. Provisioning admin passwords are not distributed by this loader.
- Checks: five launcher tests PASS for service credential boundaries, OIDC issuer agreement and absent provider; Black/isort and `git diff --check` PASS. Existing ambient OS environment remains the caller's responsibility; no key was configured or printed. User explicitly deferred real-provider verification until supplying a key.
### 2026-10-20 19:54 UTC+07 — Native metadata reuse / subagent runtime_auth
- Nhánh / commit subject: `module/metadata-context` từ `43144e6`; `feat: enrich native metadata descriptions across warehouse engines`.
- Phạm vi: tái sử dụng có chọn lọc native catalog comment joins từ bộ nguồn data tool runtime đã tải; JDBC discovery/canonical descriptions, provenance/Apache notices và kiểm thử thật ba engine.
- Trạng thái: VERIFIED cho native metadata integration trong phạm vi đã giao; không phải claim tích hợp toàn bộ Go/MCP runtime, executor, planner hoặc provider LLM thật.
- Đã làm: thêm ba SQL resources adapted từ upstream PostgreSQL/MySQL/SQL Server list-tables implementations; giữ source copyright/Apache-2.0 và đánh dấu modifications. `NativeMetadataDescriptions` thực thi một PreparedStatement/schema, timeout5s, tối đa10k comment rows/2MiB/4k ký tự mỗi description; tham số schema được bind, không execute SQL người dùng. `JdbcWarehouseAdapter` chia sẻ snapshot comments cho toàn bộ tables/columns cùng schema, giữ identity/types/keys/allowlist/DTO hiện có. SQL Server đọc `MS_Description` native; MySQL không nhầm VIEW marker thành mô tả. Missing comments giữ JDBC remark hoặc empty string; permission/resource errors đi qua mapping an toàn hiện có.
- Provenance: source file SHA-256 và snapshot inventory trong `docs/integrations/native-metadata-provenance.json`; không suy đoán Git commit từ folder main. License/notice ở `third_party/data-tool-runtime/` và `META-INF/licenses/data-tool-runtime/` trong JAR; sản phẩm giữ tên trung tính. Không sao chép server Go, arbitrary execute tools, owner/trigger/index payload hoặc thêm credential field vào AI context.
- Kiểm chứng PASS: native live tests PostgreSQL/MySQL/SQL Server tạo Unicode table/column comments bằng isolated admin, đọc bằng `nla_reader`, kiểm tra absent schema/uncommented column/clear comment và reader write denial; cleanup table hoàn tất. SQL Server user test riêng bị DENY SELECT trên sys.extended_properties trả vendor229 thật, sau đó REVERT/drop user; không đổi quyền reader dùng chung. Targeted `NativeMetadataLiveTest,NativeMetadataDescriptionsTest,NativeDescriptionContextTest,LiveWarehouseTest` —18 tests passed,0 failures/errors/skips.
- Kiểm chứng PASS bổ sung: full `mvn -q test` —47 passed,8 skipped (integration/Testcontainers chưa enable trong lần full unit run); Google Java Format, `git diff --check`, JSON/source hashes/license byte equality; Maven package và kiểm tra JAR chứa adapted SQL resources + Apache legal files. Unit tests chứng minh bind schema chứa quote, exact-case/Unicode, bounded empty fallback, row overflow, permission failure không fabricate content, safe existing API error/context propagation và đúng một query comments/schema thay vì/table.
- NOT RUN / phụ thuộc: chưa rebuild application images/browser sau merge của nhánh metadata; không có provider key nên không kiểm chứng model diễn giải descriptions. Root cần rebuild/rerun branch tích hợp cùng AI context-selector để nghiệm thu cuối. Không thay production credentials, business rows hoặc physical table schema lâu dài.
- Việc tiếp nối: root tích hợp commit metadata, cập nhật trạng thái survey reuse chung và nghiệm thu UI/catalog/provider theo evidence riêng. AI agent đã xác nhận giữ `description` trên selected context và xem là untrusted metadata.
- Commit/push: entry dùng subject + branch cho commit hiện tại; SHA local/remote được xác minh sau push/pull trong handoff.

## 2026-10-20T19:55+07:00 — Root / native metadata reuse integration

- Branch: `module/integration-final`; commit subject: `merge: integrate native database context descriptions`.
- Merged `module/metadata-context` at `b1e3e52`; adapted upstream native catalog SQL now enriches actual Java discovery and existing AI-context descriptions. Existing shared DTO and execution authorization remain in use; no new arbitrary SQL tool was added. Source hashes and required Apache notices are retained in source/JAR.
- Checks: agent's18 targeted/live checks PASS on DB3 including Unicode descriptions/permission denial and cleanup. Merge work-log conflict retained both append histories; `git diff --check` PASS. Final stack rebuild after this merge PENDING; provider key remains deferred.

## 2026-10-20T20:15+07:00 — Root / inherited credential filtering

- Branch: `module/integration-final`; commit subject: `fix: filter inherited credentials by local service`.
- Reviewer reproduced inherited shell variables bypassing file-based filtering. The launcher now filters known application credential/config namespaces in the inherited environment by consumer as well, preserving ordinary OS environment and backend OIDC configuration.
- Checks: eight launcher tests PASS including three exported-secret regression scenarios; Black and `git diff --check` PASS. No private configuration values were logged or committed. This corrects the ambient-environment limitation recorded in the earlier launcher entry.
### 2026-10-20 20:20 UTC+07 — Tối ưu context trong request AI / module AI
- Nhánh / commit subject hoặc SHA đã biết: `module/ai-completion`; dự kiến `perf: index semantic context and bound provider payload`.
- Phạm vi: `ai-service/app.py`, `ai-service/context_index.py`, provider boundary tests, giữ cast decimal của fixture support, tài liệu reuse/progress và bản Apache-2.0 license Wren.
- Trạng thái: VERIFIED cho cache/index/retrieval path và exact HTTP request-body budget trong test transport; provider thật và AI acceptance tổng thể vẫn INCOMPLETE.
- Đã làm: nối index schema vào selector runtime; cache bounded tối đa 32 canonical snapshots theo SHA-256; giữ full table/column records cùng qualified physical/logical names, descriptions, grain, nullable unknown, metric/dimension references, business rules và shortest declared join closure; lọc examples theo dialect. Không có thêm model/provider call. Request được serialize một lần, chính body bytes đó gửi bằng HTTPX, `LLM_REQUEST_MAX_BYTES` giới hạn system prompt + output schema + request/context JSON. Giữ thay đổi `AVG(CAST(... AS DECIMAL(38,10)))` của `synthetic-support.json` từ commit `658d5d2` để kỳ vọng average không mất độ chính xác. Ghi provenance cùng hash source Wren và license Apache.
- Kiểm chứng: `ai-service/.venv/bin/pytest -q ai-service/test_app.py` — 44 passed, 1 skipped; Black check, isort check, compileall và `git diff --check` pass. Benchmark cùng snapshots dưới giới hạn, so với selector cũ top-eight same-dialect examples: Chinook 12,438 → 5,177 bytes (58.38%); synthetic-support 10,428 → 6,429 bytes (38.35%). Stress context riêng đo 240,412 → 22,894 bytes (90.47%), không phải baseline request production. Regression test cho SQL examples thiếu semantic tags và thời điểm referenceTime mới nhất pass. Chưa chạy Docker image, SQL warehouse hoặc provider thật; provider smoke NOT RUN do thiếu cấu hình. Có một warning deprecation từ Starlette test client.
- Còn thiếu / blocker / phụ thuộc: số payload không đại diện token billing, provider latency hay chất lượng SQL; synthetic-support chưa có warehouse vật lý và chưa chạy qua Java executor; real-provider smoke NOT RUN. Image Docker có trong nhánh packaging/runtime khác; khi merge cần copy `ai-service/third-party/licenses/` vào image.
- Việc tiếp nối: merge vào integration branch, giữ support evaluation cast và data support suites hiện có; chạy provider/Java-backed evaluation khi có cấu hình phù hợp.
- Commit/push: entry này được commit cùng thay đổi; SHA remote sẽ được đối chiếu sau push.

## 2026-10-20T20:24+07:00 — Root / selected context runtime reuse integration

- Branch: `module/integration-final`; commit subject: `merge: integrate measured AI context selection`.
- Merged `module/ai-completion` at `081458a`, retaining decimal mean corrections. Shared reuse overview preserves source inventory and links both actual narrow runtime integrations; AI detail moved to `docs/integrations/semantic-context.md` instead of replacing the global architecture. Snapshot flags describe selected scope explicitly, not full upstream integration.
- Checks: agent44 PASS/1 real-provider skip, including exact serialized payload and fresh referenceTime/cache boundary. Existing integrated Java cross-domain evidence108 cases supersedes component handoff's missing-warehouse note; rerun with this new selector remains PENDING until final rebuild.
### 2026-10-20 13:33 UTC+07 — Thêm luồng SQL Import trong ứng dụng / conversation FE
- Nhánh / commit subject: `module/frontend-polish`; `feat: add validated SQL import workflow`.
- Phạm vi: màn SQL Import, client multipart/run APIs, schema DTO, route/sidebar, cấu hình writer credential reference write-only trên warehouse và kiểm thử FE.
- Trạng thái: VERIFIED cho caller UI/API contract dưới test; SQL Import tổng thể vẫn INCOMPLETE vì chưa chạy caller FE với Java và warehouse thật qua upload, preview, xác nhận, persistence, history trên ba engine.
- Đã làm: thêm validate → preview → explicit confirm → run detail/history; giới hạn file `.sql` 2 MiB; giữ idempotency key cho lần retry; chỉ submit planId/digest khi xác nhận, không gửi lại SQL gốc; hiển thị warnings/unsupported features và ngăn xác nhận plan hết hạn/không hỗ trợ. Warehouse form nhận `importCredentialReference` dạng env reference, không nhập password và không hiển thị giá trị được lưu.
- Kiểm chứng: `npm test -- --reporter=dot` — 104 passed; `npm run test:e2e` — 21 passed với API fixture riêng cho browser tests; `npm run build` PASS; `npm run format:check` PASS; `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: E2E browser ở commit này dùng mock Java, không chứng minh tích hợp hoặc persistence thật. Backend SQL Import đang ở nhánh riêng; backend agent đang sửa mapping sang writer username chuyên dụng. OIDC provider thật và đối chiếu dữ liệu/provenance mọi route vẫn chưa nghiệm thu; `docs/current-review.md` được giữ cho nhánh tích hợp để tránh xung đột giữa module.
- Việc tiếp nối: tích hợp contract/implementation từ backend rồi chạy upload-preview-confirm thật trên PostgreSQL, MySQL và SQL Server; cấu hình OIDC provider và hoàn thiện acceptance UI còn mở.
- Commit/push: entry này đi cùng commit; SHA local/remote được đối chiếu sau push.

### 2026-10-20 20:24 UTC+07 — Hoàn thiện đăng ký pipeline và kiểm chứng luồng FE live / conversation FE
- Nhánh / commit subject: `module/frontend-polish`; `feat: add live registered ingestion workflows`.
- Phạm vi: giao diện quản trị nguồn ingestion đã đăng ký, chọn warehouse/dataset từ registry API thật, đăng ký/chỉnh sửa từng phần/kiểm tra/chạy/xem lịch sử; cấu hình credential reference chỉ ghi; mở rộng review SQL Import theo constraint/index/default/identity và trạng thái rollback; test browser live riêng, test responsive desktop/mobile.
- Trạng thái: VERIFIED cho caller FE với Java và ba warehouse cục bộ trong các luồng SQL Import và ingestion. OIDC provider không thuộc bài test live này (đăng nhập bằng local admin token); không suy rộng kết quả local thành xác nhận provider production. Root xác nhận cả 12 bảng disposable có 24 dòng sau chạy và đã xóa chính xác theo manifest ở cả ba engine.
- Đã làm: thêm registry CRUD có role/loading/empty/error states; form chứa raw, stage, warehouse, mart và typed columns; test endpoint hiển thị target/row metadata; run/history/detail gọi APIs thật. SQL Import review hiển thị đầy đủ schema, table, constraint/index, default/identity và rollback status; namespace đích nhập tường minh. Test live dùng token từ `.local/docker.env`, không ghi token vào log.
- Kiểm chứng: `npm test -- --reporter=dot` — 110 passed; `npm run build` PASS; `npm run format:check` PASS; `npm run test:e2e` — 23 passed; browser live SQL Import trên PostgreSQL/MySQL/SQL Server — 1 passed; browser live ingestion đăng ký/chỉnh sửa/test/run/detail/history trên ba engine — 1 passed; `git diff --check` PASS trước commit. SQL Import disposable tables đã được xóa và kiểm tra còn 0. Ingestion disposable tables cần được kiểm tra row count và dọn bằng manifest bên quản trị sau khi test.
- Còn thiếu / blocker / phụ thuộc: API export OpenAPI/contracts cần cập nhật bởi nhánh tích hợp; verify OIDC thật riêng.
- Việc tiếp nối: tích hợp exporter/API contracts và chạy Compose/OIDC acceptance cuối.
- Commit/push: entry này đi cùng commit; SHA local và remote được đối chiếu sau push.

## 2026-10-20T20:27+07:00 — Root / frontend ingestion integration

- Branch: `module/integration-final`; commit subject: `merge: integrate live frontend ingestion workflows`.
- Merged published FE `abafbfa`; preserved both appended work logs. FE source registry create/edit/test/run/history and SQL Import use actual Java APIs, with explicit schemas and per-warehouse writer configuration.
- Checks: FE110 unit tests,23 mocked browser checks/build/format PASS. Live browser import and ingestion PASS on PG/MySQL/MSSQL with committed BE at local8088. Root independently counted24 rows in each of12 disposable pipeline targets, then removed exact manifest-owned targets. No fixture payload was substituted in the product. Final production bundle rebuild PENDING.

## 2026-10-20T20:30+07:00 — Root / shared contracts and closeout evidence

- Branch: `module/integration-final`; commit subject: `chore: finalize shared contracts and integration handoff`.
- Regenerated frontend OpenAPI from merged schemas:41 paths/54 schemas, including source CRUD/test and multipart import/progress; aligned preview constraint/default fields and internal revision semantics. Retained AI Apache license in Docker image. Added disposable DB-only browser pipeline target helper with exact manifest/count/cleanup, not product fixtures. Sample Compose bootstrap now matches its dataset name instead of overwriting the first unrelated dataset in a warehouse. Updated stale docs and two-scope assessment: original target estimate80%, target plus deep upstream reuse estimate70%; not a completion claim.
- Checks: integrated frontend118 unit tests,23 mocked browser checks, build and formatter PASS; integrated Python44 PASS/1 provider skip; infra/data31 PASS; backend65 actual tests previously PASS after metadata integration. Real FE ingestion/import PASS on DB3; independent12 layer counts each24 and exact cleanup PASS. JSON/schema endpoint inventory/local links and `git diff --check` PASS.
- Remaining: final Docker rebuild/query/auth/import/cross-domain rerun on this committed source PENDING; provider key deferred by user (NOT RUN), model token counter/production/load/complete visual acceptance not claimed. User authorized PRs and merging into main; published component PRs4–10 and existing FE PR3 are coordinated by aggregate integration PR.

## 2026-10-20T20:37+07:00 — Root / final integrated acceptance and authorized main merge

- Branch: `module/integration-final`; commit subject: `docs: record integrated acceptance and release assessment`. Runtime source tested: `57ddbcf7d04710a7663f1c90de9a9c067bf3d1bf`; this follow-up changes assessment/log documentation only.
- PASS: `python3 infra/local/compose.py up` rebuilt all3 application images and healthy services, retained AI license in image, registered DB3 through OIDC Java API; `compose.py verify` query/catalog integrity DB3 and `node infra/local/compose-browser.mjs` production UI query DB3.
- PASS on packaged OIDC API8085/private Python: `verify_sql_import.py`9 native/cross-dialect pairs with persisted rows/NULL/decimal, digest rejection/idempotency and cleanup; `verify_cross_domain.py`108 bilingual/rejection cases against independently computed SQLite expectations, datasets disabled and tables removed afterward. Used a private short-lived service token env file, never printed.
- PASS: production bundle OIDC browser suite on4173/API8085, VIEWER/ANALYST/OPERATOR/ADMIN, anonymous and invalid credentials, issuer/audience/signature/subject, roles/resources, automatic renewal, expired original token rejection, callback error and real logout.
- Regression totals: frontend118 PASS,23 mocked browser PASS/build/format PASS; backend65 PASS/no skips on integrated native metadata source; Python44 PASS/1 real-provider SKIP; infra/data31 PASS. No new test failure remains in this closeout scope.
- NOT RUN/INCOMPLETE: real LLM provider (key deferred by user), model-specific token accounting, exhaustive route/visual/load/recovery/production acceptance and clean-machine zero-volume setup. Two-scope weighted estimate recorded in `docs/project-status.md`: original target~80%; including deep source reuse~70%. Only selected context/index/cache and native metadata code reused; no claim whole upstream systems/connectors are integrated.
- Publication: component PRs3–10 and aggregate PR11 contain all published module branch heads (ancestry verified). User explicitly authorized merging into main; next operation merges PR11 preserving commit history, verifies remote main and fast-forwards the primary checkout. Local private IdP/app setup copied only where absent, preserving any existing provider file. No further feature implementation is planned in this handoff.

## 2026-10-20T21:20+07:00 — Root / bulk file ingestion implementation

- Branch: `module/source-platform-integration`; subject: `feat: ingest complete files through validated batch pipelines`.
- Implemented private authenticated parser for CSV/TSV/TXT, JSON/JSONL/NDJSON, XLSX sheet selection, Parquet, Arrow/Feather/IPC, ORC and Avro. Entire file is inferred/validated before streaming canonical rows; bounds, precision, formulas/external-workbook/ZIP protections and actor-owned private spool are enforced. Adapted upstream local-file dispatch with required Apache provenance; native semantic planner and Go runtime remain separate coordinated module changes.
- Java implements multipart upload, ownership/quotas/expiry, writer namespace discovery, full-file editable mapping checks, immutable digest/revision/expiry plans, asynchronous bounded queue, idempotency, cancellation, persistence/recovery/history/audit, prepared batches and real raw→staging→warehouse→mart tables. Reader count verifies persisted mart before creating an allowlisted Dataset with explicit file provenance and empty semantic model. No source folders or manual row/column INSERT entry are needed. Discovery now respects accessible namespaces and Dataset allowlists, with defaultSchema used as a SQL default rather than excluding imported tables. Sample provisioning grants reader SELECT on newly created isolated import tables without granting writes.
- PASS:17 parser tests covering all supported extensions/Unicode/precision/selection/invalid input/auth;5 Java tests including real three-engine batch loads of1101 rows per layer (four layers each), exact BIGINT/decimal/null/Unicode/timestamps and reader write denial, with exact disposable cleanup. Java compile/package PASS, Google Java Format and Python format applied.
- Earlier targeted run found a test expectation for decimal ArithmeticException and missing MySQL pinned RSA environment; corrected the test and loaded existing runtime environment, then all5 PASS. No weakening of production TLS/RSA settings.
- PENDING: merged Compose, public Java API/real FE upload workflows, semantic planner/native executor integration and negative/cancel/recovery API acceptance. This commit is implementation plus targeted evidence, not completed integration acceptance. Provider key remains deferred by user.
## 2026-10-20T21:20+07:00 — Runtime agent / native database tool source reuse

- Branch: `module/data-tool-runtime`; commit subject: `feat: execute approved queries through private native database pools`.
- Adapted actual three-engine native source/pool/cursor implementations and synchronized cache from the supplied database-tools snapshot into a small Go runtime; preserved Apache license, source hashes and notices in repository and image. Java remains authorization/SqlGuard/limit owner; configured native transport has no fallback. Runtime uses dynamic registered connection/reader settings, private service token/host allowlist, bounded pools/leases/concurrency/TTL, native cancellation/read-only transactions, canonical typed values and bounded row/UTF-8 results. MySQL discovery now enumerates accessible catalogs, including independent import namespaces.
- Compose enables private native executor by default, isolated from AI/file worker. Added file-service packaging integration, distinct generated0600 service credentials, backend upload volume UID10001,25/27MB multipart/proxy limits and backend-only host environment filtering. Python AI platform is explicitly amd64 for the planner's native wheel. No database/admin/provider credentials are tracked or distributed to file-service/AI/native executor environment.
- PASS: Go `go test -race -count=1 -v` six test functions, including actual PG/MySQL/MSSQL typed results (BIGINT9007199254740993, DECIMAL1234.5000, boolean/BIT, null, ISO date/UTC timestamp),100ms cancellation and recovery; auth/host/bounds/concurrent pool reuse/rotation/active lease/expiry/UTF-8 checks. One disposable MySQL BIT fixture created/removed by the integration test using test-only admin credentials.
- PASS: Java→private Go HTTP→actual DB3 `LiveWarehouseTest` all6 tests, runtime configured; JDBC retained only for metadata/writer paths. Six new Java client/guard tests PASS; full Java suite61 discovered,53 PASS/8 integration-gated SKIP/no failure. Infra host/Compose isolation15 PASS. Pinned multi-arch Go Docker image build and nonroot read-only private-container authenticated health PASS. `git diff --check` PASS.
- PENDING: combined Compose/frontend/browser regression after root file-ingestion and AI native planner branches merge; new QueryService planner dependency requires its passthrough test adaptation during integration. No real LLM provider call or full upstream MCP/cloud-server support claimed. No public arbitrary SQL route added.

## 2026-10-20T21:22+07:00 — Root / pooled executor integration

- Branch `module/source-platform-integration`; subject `merge: integrate native pooled data executor and private services`.
- Merged published native executor896f367. Preserved both append-only work-log histories; corrected the preceding root entry timestamp to actual UTC+07. Query/connector/public contracts remain explicit and credentials remain private to their consumers.
- Component evidence: native Go race/DB3 cancellation/types, JavaHTTP→Go→DB3, guard tests and infra credential isolation PASS per module log; root file executorDB3 PASS with1101 rows in each of12 disposable layer tables and exact cleanup. Combined build/Compose/UI acceptance remains PENDING until semantic planner and frontend are merged.

## 2026-10-20T22:02+07:00 — Root / file lifecycle and real ingestion acceptance

- Branch `module/source-platform-integration`; subject `fix: finalize file lifecycle atomically and verify batch ingestion`.
- Fixed queued cancel cleanup, cancellation after physical commit, atomic metadata Dataset/audit/SUCCESS finalization and upload/audit transaction; MySQL BOOLEAN uses BIT(1) for native result typing. Repository bean is proxyable. Exact nested JSON numbers and common cell bounds are preserved; formula headers fail closed. Added actor-authorized discard to release uploaded files safely. Parser image now uses the existing pinned multiarch Python base; bounded tmpfs fits concurrent spools. Formatter includes file-service.
- PASS:18 parser tests; live Java API9 CSV/XLSX/Parquet→database pairs (PG/MySQL/SQLServer) verify upload/full mapping/digest rejection/idempotency/reader persistence/decimal aggregate/registered Catalog. Active cancellation of100,000 rows PASS on DB3 with no Dataset registered; PG/MS rollback and MySQL partial DDL reported correctly. Exact generated-table cleanup completed. SQLServer row-count test parser fixed to use SET NOCOUNT ON; no runtime count defect.
- Earlier startup check found final Repository preventing CGLIB proxy, fixed and Java boot/migration/API acceptance now PASS. Final atomic/discard follow-up and latest native executor follow-up still require packaged regression; real provider remains deferred.
## 2026-10-20T21:31+07:00 — Runtime agent / compatibility and result precision review

- Branch: `module/data-tool-runtime`; commit subject: `fix: preserve pipeline budgets and native UUID result values`.
- Review caught the existing source registry supports50MiB result budgets; extended the private runtime to preserve that committed contract rather than reject valid pipelines above10MiB. Added64MiB aggregate active result-budget admission alongside8-request concurrency, returning RUNTIME_BUSY before opening another source when memory admission is exhausted.
- Preserved native PostgreSQL UUID and SQL Server UNIQUEIDENTIFIER values using upstream UUID normalization plus the driver's byte-order-aware scanner. Added exact UUID expectations to live DB3 typed-result tests, retaining canonical STRING output.
- PASS: all7 Go tests under race detector, including actual PG/MySQL/MSSQL typed UUID/BIGINT/DECIMAL/boolean/null/date/UTC/cancel/recovery subtests and50MiB compatibility/aggregate admission rejection. Formatter and diff check PASS. Combined application acceptance remains pending root integration; no new provider acceptance claimed.

## 2026-10-20T22:03+07:00 — Root / native source compatibility follow-up

- Branch `module/source-platform-integration`; merge subject `merge: preserve native runtime source budgets and scalar types`.
- Integrated published9266957 compatibility fixes:50MiB configured ingestion source budget, bounded64MiB aggregate reservations, native UUID result typing. Component7 Go race/DB3 tests and Docker build PASS; combined Compose verification remains pending.
## 2026-10-20T22:00+07:00 — FE / bulk file upload caller

- Branch `module/file-ingestion-ui`; subject `feat: add complete-file ingestion preview and run workflow`.
- Resumed the interrupted FE agent's uncommitted work. Added default Nạp file workflow with13 supported extensions, automatic complete column mapping, preview, XLSX sheet/delimiter options, actual writer namespace discovery, target selection, immutable plan review/expiry, idempotent confirm, async progress/cancel/history and Dataset/Catalog links. Existing DB source pipeline remains in its own tab. Context switches to the actual newly registered Dataset after success; no fixed business data or import namespace is inserted into runtime UI.
- PASS: full FE unit suite123 tests, TypeScript/Vite production build and Prettier check. New isolated workflow tests/API tests cover validation/confirm/expiry/errors; component fixtures are test-only.
- PENDING: real browser file upload through Java/database3 and packaged OIDC Compose regression. This commit does not claim live or pixel acceptance; root is completing those on the integration branch. No provider call tested.

## 2026-10-20T22:05+07:00 — Root / complete-file UI integration

- Branch `module/source-platform-integration`; merge subject `merge: integrate bulk file upload user workflow`.
- Integrated published6d9fc26 frontend13-extension upload/preview/mapping/namespace/plan/run/history workflow; corrected component log count to observed123 tests (not126). Root independently reran123 unit tests, build and formatter PASS. Live browser upload and packaged OIDC acceptance remain pending.
## 2026-10-20T22:07+07:00 — AI / native semantic core and CTE rewrite integration

- Branch `module/semantic-planner`; subject `feat: plan SQL candidates with native semantic core and source lineage`.
- Resumed interrupted AI agent work. Added actual pinned native core0.4.0 plus adapted upstream CTERewriter and dialect implementation. Java builds request-scoped models from the authorized physical catalog and discovered relationships, calls authenticated private planning, then reruns SqlGuard and compares independent physical lineage before execution. No credentials, DB connection or execution tools reach Python; planner errors fail closed.
- Shared private contract, source hashes/Apache notices, Docker dependency packaging and detailed reuse scope are recorded. Existing metric expressions still enter candidate generation; this change does not claim a full upstream product or cloud connector inventory.
- PASS:52 Python tests/1 real-provider SKIP on isolated pinned Python3.11 environment; native3dialect rewrite, joins, unknown tables, auth/correlation, no silent fallback. Agent separately built amd64 image and SQLServer privateHTTP rewrite smoke; root will rerun packaged query/database equivalence. Root initial test invocation against global Python failed imports, then recreated isolated pinned venv and all52 PASS.
- PENDING: merged Java/native executor compilation (new constructor dependency), live DB3 query result/corpus regression, final Compose/browser acceptance. Real provider key deferred by user; no real-provider pass claimed.

## 2026-10-20T22:08+07:00 — Root / native semantic core integration

- Branch `module/source-platform-integration`; subject `merge: integrate native semantic planner before guarded execution`.
- Integrated1a7a1fa actual native semantic core and upstream CTE source into candidate→planner→Java AST/lineage→native executor flow. Preserved shared contract links for file/native tool interfaces. Python52 PASS/1 provider SKIP; packaged DB3/corpus/browser and integrated Java tests PENDING.

## 2026-10-20T22:15+07:00 — Root / native identity, file caller and packaged acceptance

- Branch `module/source-platform-integration`; subject `fix: preserve SQL identity and complete file caller lifecycle`.
- Preserved exact PostgreSQL quoted identity/unquoted folding, physical column qualifiers and scoped CTE references through the native planner; Java compares exact lineage keys. Added actor upload discard caller, active-run reset guards, target label accessibility, history pagination and retained cross-warehouse progress. Exported48 public paths/61schemas including all file APIs. Packaged the server-managed evaluation corpus in the backend image after live /evaluation/run exposed missing deployment data.
- PASS:58 native Python tests/1 real-provider SKIP;18 file-parser tests;79 integrated backend tests/no skips including Docker Testcontainers and liveDB3. FE124 tests/build PASS; full mocked browser regression is running. Actual packaged core query API/browserDB3 PASS;108 support cases equivalent to independently computed SQLite values.
- PASS on OIDC Compose:13extensions×3targets39 upload/mapping/digest/idempotency/persistence/catalog cases, plus3active100k-row cancellation cases. Browser real IdP→UI upload→Java→file parser→DB3→Catalog PASS; independent reader count2 in each generated layer and exact cleanup. Initial browser selector used an overly exact wrapped-label lookup, fixed test and explicit field aria labels; no namespace/permission data was fabricated.
- PENDING for final committed image: quoted-case/qualifier follow-up and evaluation-corpus packaging rebuild; real provider remains deliberately NOT RUN. No claim complete upstream/cloud inventory or production/pixel/load acceptance.

## 2026-10-20T22:24+07:00 — Root / final packaged regression and reproducible verification

- Branch `module/source-platform-integration`; subject `test: verify native planning and bulk upload through packaged application`.
- PASS on committed276c3f8 Compose:5 app services healthy; actual query API/browserDB3; Chinook evaluation48cases×3=144 PASS with equivalent results and rejection metrics; cross-domain108 PASS. Native core/rewrite and Go executor are both in this path. Server-managed evaluation corpus packaging verified by actual /evaluation/run (previous503 resolved).
- PASS:SQLImport9native/cross-dialect pairs with persistence/idempotency/cleanup. OIDC real browser4roles, unauthorized/wrong-password/issuer-audience-signature/subject checks, automatic renewal, expiry/logout PASS. File OIDC browserDB3 upload/auto mapping/review/4layer progress/new Dataset/Catalog PASS, independent reader counts and exact target cleanup PASS. Full13format×3target+3active100k-row cancel matrix42cases remains PASS.
- PASS:79 integrated Java tests/no skips including liveDB3 and Testcontainers;58 native planner tests/1 provider SKIP;18 file-parser tests;35 infra/data tests;124 FE unit/build/format;25 mocked browser regression including mobile/desktop file entry and existing source editor. Two stale source-editor browser tests were corrected to open the newly separate warehouse tab and handle file API test fixtures. Updated viewer test verifies permission notice without an unauthorized history request/loading state.
- Corrected verification runner, not product behavior: removed a response-body read after navigation; browser helper records upload/run IDs and releases private spool quota as well as disposable tables/Datasets. A repeated browser run reached the real8-upload quota; exact test uploads were discarded, then browserDB3+cleanup PASS. Pytest directory collection accidentally included imperative test_backend.py launcher, so checks were rerun using the four intended unit modules (35PASS); backend suite had already run separately79PASS.
- This follow-up aligns host multipart25/27MiB defaults with Compose; existingSQLImport service keeps its own2MiB cap. Final image rebuild for this small permission/UI/test follow-up occurs during publication. Provider model key is deferred by user; no actual-provider quality/token/load/production or full upstream/cloud support claim.

## 2026-10-20T22:33+07:00 — Root / published native-source integration acceptance

- Branch `module/source-platform-integration`; subject `test: record packaged file-role authorization and publication`.
- Final application source8a5c567 rebuilt successfully:5 app containers healthy; /compose verifyDB3 and actual OIDC file browserDB3 all PASS after latest role/limit/UI changes. Browser helper independently verified all12 layer row counts and cleaned exact disposable tables/Datasets/upload bytes. No source or runtime business data was replaced with fixtures.
- Added actual file-module GET role-boundary assertion to existing OIDC suite: VIEWER/ANALYST403 and OPERATOR/ADMIN200; four-role login, invalid password, automatic renewal, expired token, audience/signature/subject, callback and logout PASS on final packaged app. This commit changes only docs and that regression script; application code remains the source just verified.
- Publication: PR12 https://github.com/toannnnq1424/text-to-sql/pull/12 attached to this task; includes published module/semantic-planner1a7a1fa, module/data-tool-runtime9266957 and module/file-ingestion-ui6d9fc26 (ancestry verified). Source integration branch push/pull8a5c567 matched remote before this final evidence commit; next operation publishes this evidence, verifies its SHA and performs the user's authorized main merge/primary fast-forward. Repository visibility remains PUBLIC.
- Checks aggregate:79 Java/no skip;58 native-planner/1 provider skip;18 parser;35 infra/data;124 FE/build/25 mocked browser; actual query+file browserDB3,39format/engine imports+3active cancellation,144 Chinook+108 independent support cases,9SQLImport pairs and OIDC4roles PASS. Provider credentials intentionally deferred, so real-provider quality/billing and full production/load/pixel/cloud-connector coverage are not claimed.

## 2026-10-20T23:23+07:00 — Root / guided source registration and native session reuse

- Branch `module/ingestion-source-ux`; subject `feat: guide source registration and reuse native planner sessions`.
- Replaced the single technical source form with three steps: choose actual connection/dataset/table (SQL is an explicit advanced option), bounded preview with inferred column types, choose existing target tables with plain-language layer explanations, then validate all source/target configuration before enabling save. Changes invalidate validation; saved sources in the current context are selected ready for a separate explicit pipeline run. Dependent dataset/table selections clear when their warehouse changes; registry displays names resolved from APIs. Empty/error states remain real, no runtime fixtures.
- Added coordinated Java/Zod/OpenAPI contracts for ADMIN preview, writer-scoped target discovery and unsaved validation. SQL is generated by Java adapters from actual catalog identifiers; AST/allowlist/row/byte/time controls remain in force. Qualified schema.table search now works in metadata lists. Target tables must already exist with writer grants; this source flow does not claim automatic creation. File upload still has its separate automatic table creation workflow. Added user-facing ingestion guide and README link.
- Extended actual source reuse: new preview/test callers use the existing adapted native Go executor/pool and native comment discovery in Compose. Applied the supplied semantic SDK get_session_context factory to the planner, with8-entry/64KiB-manifest cache eligibility, synchronized initialization and per-session lease; SQL/AST/rows/provider messages remain request-local. Updated exact source hash, Apache notices and reuse documentation; corrected an outdated statement that no Go executor was integrated. This reduces repeated native-session initialization, not provider API calls or proven token cost.
- PASS:82 integrated Java tests/no skips including new live source/discovery/draft-validation DB3 cases; additional PageSearchTest1 PASS (83 total). Python61 PASS/1 real-provider SKIP, including actual concurrent native rewrite/cache/catalog-isolation checks. FE127 unit tests, production build and format PASS;25 mocked browser cases PASS, including all three source steps at1440px and390px with screenshots and overflow assertions.
- PASS on packaged OIDC app: actual UI table selection/column subset→Java preview→four real targets→validate/save→auto-select→explicit pipeline run on PG/MySQL/SQLServer. Independent database counts347 in each of12 disposable targets match the source. ADMIN works; VIEWER/ANALYST/OPERATOR each receive403 from all three new management APIs. Existing real query browserDB3 remains PASS after native session-cache deployment. Five application services healthy. Reproducible runner: node infra/local/source-registration-browser.mjs; private evidence .local/source-registration-browser-report.json and screenshots, not committed.
- Acceptance found and fixed qualified-name search; test-runner body-read timing was corrected. An interrupted Compose command had left the frontend stopped while backend was ready; frontend was resumed and the actual browser matrix passed. Disposable targets and current source/run metadata cleaned; seven earlier test definitions/runs from this task were removed by exact identity checks, audit retained. No source business tables were modified.
- Real provider remains deliberately NOT RUN until the user supplies local configuration. No claim of full cloud connector inventory, entire upstream server adoption, production load/cost or pixel-perfect acceptance. Publication verifies local/remote SHA and uses the previously authorized main merge.
