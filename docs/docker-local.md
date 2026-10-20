# Chạy ứng dụng trong Docker Compose

`infra/compose.databases.yml` + `infra/compose.application.yml` chạy PostgreSQL, MySQL, SQL Server, Java backend, Python AI service và frontend Nginx. IdP local dùng `infra/compose.auth.yml` trên project `nla-auth`. Cả hai được khởi động bằng cùng helper; SQL Server image vẫn yêu cầu host/emulation `linux/amd64` phù hợp.

## Khởi chạy

Yêu cầu Docker Compose v2.30+ (`env_file.format: raw`), Python 3.11+, Docker đủ RAM cho ba database và services. Từ thư mục gốc:

```bash
python3 infra/local/compose.py up
python3 infra/local/compose.py status
```

Helper tái dùng quy trình data provisioning đã pin/checksum, không nhận SQL upload tùy ý. Nó tạo metadata database `nla_metadata_compose` riêng với owner app giới hạn quyền, build images từ source checkout hiện tại, đợi healthchecks rồi dùng OIDC client credentials để gọi API Java đăng ký ba source warehouse/dataset. Host app vẫn dùng metadata database `nla_metadata` và không bị rewrite endpoint.

Mở `http://127.0.0.1:4173`. Đăng nhập qua Keycloak tại 8180 với account ứng dụng trong `.local/oidc/accounts.json`. API Java chỉ bind host loopback ở 8085; browser gọi `/api/v1` qua Nginx cùng origin. Python không publish port ra host. Bốn role dùng cùng contract và resource grants như [OIDC local](oidc-local.md).

Chạy lại `up` giữ metadata, database volumes và credential; `register` có thể dùng lại để kiểm tra/discover kết nối đã đăng ký. Helper từ chối nhiều registry entry trùng endpoint; xử lý chúng qua UI quản trị trước khi chạy lại. Nó không thay đổi warehouse ngoài sample đã phân phối.

```bash
python3 infra/local/compose.py configure
python3 infra/local/compose.py build
python3 infra/local/compose.py register
python3 infra/local/compose.py stop
```

`stop` chỉ dừng ba app containers; database/IdP giữ nguyên để host app tiếp tục sử dụng. Dừng IdP qua `infra/local/oidc.py stop`, dừng database theo README. Không `down -v` nếu cần giữ dữ liệu.

## Private configuration

`infra/application.env.example` chỉ chứa public ports/issuer/JWKS. Helper tạo `.local/compose-app/public.env` riêng để chỉnh local ports, cùng `backend.env`, `ai.env`, `provisioner.json`, public RSA key MySQL và registry ID report. Secret files `0600`, thư mục `0700`, toàn bộ `.local/` bị ignore. `.dockerignore` loại secrets, dumps, local dependencies, Git history và runtime artifacts khỏi build context.

Backend env chỉ có metadata credential, read-only warehouse credentials, SQL Import/ingestion writer references và token Java→Python; không có provisioning admin DB password hay local API token. AI env chỉ có service token và provider config; không nhận reader/writer/metadata credential. Frontend build chỉ nhận public issuer/client settings; không có secret trong `VITE_*`.

OIDC client `nla-compose-provisioner` là confidential service account có ADMIN role cho local setup, được quản lý trong IdP và secret chỉ lưu `.local/compose-app/provisioner.json`. App containers không nhận bootstrap IdP administrator password. Setup dùng account quản trị IdP riêng để cấu hình public origin/callback và service principal; API đăng ký chạy qua Java như mọi admin request.

## Provider AI thật

Tạo `.local/compose-app/provider.env` trên máy từ [mẫu không có secrets](../infra/provider.env.example), đặt đủ cả ba giá trị hợp lệ. File này cũng được launcher chạy trực tiếp `infra/local/run.py` đọc; không phải cấu hình riêng chỉ dùng được trong container:

```dotenv
LLM_BASE_URL=https://your-provider.example/v1
LLM_MODEL=your-model-name
LLM_API_KEY=replace-on-your-machine-only
```

Đây là mẫu minh họa, không phải credential có thể chạy. Không commit file thật. `compose.py configure` kiểm tra cấu hình phải đủ URL/model/key, sinh lại private env; chạy `up` để recreate container theo cấu hình mới. Provider call đi từ Python qua network egress riêng. Nếu thiếu provider, setup chọn mode `DETERMINISTIC` tường minh trên settings: chỉ dùng semantic examples đã đăng ký, không mô tả như AI tổng quát/training local. Provider thật phải có smoke/evaluation riêng trước khi claim PASS.

## Networks và TLS

`app-private` chỉ nối Java và Python, `web` chỉ nối frontend và Java; cả hai là `internal`. Frontend có network `ingress` riêng để publish port loopback tới host. Python có egress riêng để gọi provider HTTPS nhưng không tham gia network database hoặc IdP. Java truy cập database bằng hostname registry (`postgres`, `mysql`, `sqlserver`) và host allowlist tương ứng. Warehouse credential vẫn là secret reference do admin quản trị; core không rewrite hostname theo engine.

Java validate public issuer `http://127.0.0.1:8180/realms/nla`, fetch JWKS bằng `OIDC_JWK_SET_URI=http://keycloak:8080/.../certs` trong auth network. Đổi địa chỉ fetch keys không đổi issuer/audience/subject validation. Frontend production bundle chỉ chấp nhận HTTP IdP khi build flag `VITE_OIDC_ALLOW_HTTP_LOOPBACK=true` và cả authority lẫn application hostname đều loopback; remote deployments vẫn bắt buộc HTTPS.

Compose local tắt TLS cho warehouse trong mạng Docker cô lập; không dùng cấu hình này làm production TLS policy. App processes chạy non-root với read-only root filesystem, writable tmpfs giới hạn và dropped capabilities. Nginx có SPA fallback/API proxy, timeout/bound upload và header cơ bản; traffic nội bộ/IdP development chưa là deployment production HTTPS.

## Build và acceptance

Dockerfiles dùng immutable multi-platform digest cho Node22, Maven/Temurin21, Python3.12 và Nginx unprivileged. Dependencies được pin qua package lock/pom/requirements của source, build không lấy credential. Backend image build bỏ qua tests để đóng gói; test suite vẫn phải chạy riêng và không được suy từ build thành test PASS.

```bash
python -m pytest infra/local/test_compose.py infra/local/test_oidc.py
python3 infra/local/compose.py verify
node infra/local/compose-browser.mjs
OIDC_TEST_APP_URL=http://127.0.0.1:4173 OIDC_TEST_API_URL=http://127.0.0.1:8085/api/v1 node infra/local/oidc-browser.mjs
```

Browser suite dùng IdP thật và API thật, token/trace/password không vào report. `verify` kiểm tra query/canonical sample integrity qua API; `compose-browser.mjs` đăng nhập rồi gửi câu hỏi từ UI, xác nhận kết quả thật trên từng engine. Auth suite độc lập kiểm tra bốn roles/401/403/renewal/expiry/logout. Các warehouse/dataset ID Compose do server tạo, nằm trong `.local/compose-app/registry.json`; test lấy ID này, không mặc định ID host sample. Evidence thực tế, commit/snapshot và PASS/FAIL/NOT RUN được ghi [work log](work-log.md); Compose config hoặc image build không thay thế browser/data/provider integration.

Nguồn chính thức base images: [Node](https://github.com/nodejs/docker-node), [Maven](https://hub.docker.com/_/maven), [Temurin](https://github.com/adoptium/containers), [Python](https://github.com/docker-library/python), [Nginx unprivileged](https://github.com/nginx/docker-nginx-unprivileged). IdP dùng [Keycloak container guide](https://www.keycloak.org/server/containers).
