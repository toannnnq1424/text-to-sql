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
