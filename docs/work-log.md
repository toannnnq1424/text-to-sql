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
