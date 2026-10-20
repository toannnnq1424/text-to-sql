# Đăng nhập OIDC với IdP local

Luồng đã cấu hình: browser → Keycloak public client `nla-web` → authorization code + PKCE S256 → React callback `/auth/callback` → bearer access token → Java resource server. Password chỉ được nhập trên trang IdP; Java/Python không nhận password và repository không chứa password store cho người dùng.

## Tái tạo

Sau Quick Start database trong README và `npm ci` trong `frontend`:

```bash
python3 infra/local/oidc.py init
python3 infra/local/oidc.py up
python3 infra/local/oidc.py check
python3 infra/local/oidc.py status
```

`init` sinh credential ngẫu nhiên cho bootstrap administrator của IdP và bốn tài khoản ứng dụng, cùng realm import. Các file ở `.local/oidc/` bị Git ignore, permission `0600`, không in secrets khi khởi chạy. Chạy lại `init` giữ nguyên credential. Realm chỉ được Keycloak import khi chưa tồn tại; thay đổi tài khoản/quyền đang có qua console quản trị IdP, không xóa volume để áp dụng lại cấu hình.

Trong hai terminal riêng:

```bash
python3 infra/local/run.py backend --auth oidc
python3 infra/local/run.py frontend --auth oidc
```

Mở `http://127.0.0.1:5173`, bấm **Đăng nhập**, lấy account riêng của máy từ `.local/oidc/accounts.json`. `nla-admin`, `nla-viewer`, `nla-analyst`, `nla-operator` tương ứng bốn application roles. Bootstrap account riêng `nla-bootstrap` dành cho IdP console tại `http://127.0.0.1:8180/admin/`; không dùng nó đăng nhập ứng dụng. `stop` dừng IdP nhưng giữ volume/session/user data:

```bash
python3 infra/local/oidc.py stop
```

## Contract và chính sách

| Cấu hình | Giá trị local |
|---|---|
| Issuer | `http://127.0.0.1:8180/realms/nla` |
| API audience | `nla-api` |
| Browser public client | `nla-web` — không client secret |
| Grant | Authorization code, PKCE S256 bắt buộc; implicit/password grants bị tắt |
| Application roles | `roles` array trong access token và ID token |
| Callback | `/auth/callback`, `/auth/silent-callback` trên từng origin cho phép |
| Browser origins | `http://localhost:5173`, `http://127.0.0.1:5173`, `http://127.0.0.1:5175` |
| Logout | Redirect IdP, clear browser session, trở về đúng origin cho phép |
| Token lifetime | Access token 120 giây cho acceptance renewal/expiry local |

Java validate chữ ký, issuer, expiration và audience. ID token dành cho `nla-web` không phải API access token; gửi nó tới API phải bị từ chối. UI dùng cùng claim `roles` để hiển thị capability, còn Java quyết định quyền của mọi request. Các tài khoản ngoài ADMIN chưa được gán warehouse/dataset grant; role phù hợp không tự động cấp quyền dữ liệu.

`run.py --auth oidc` dùng profile `oidc-local`, tắt anonymous local API/token mode và chỉ bind loopback. Profile này chỉ tắt warehouse TLS cho ba database Docker cô lập trên máy; production không dùng profile này. `runtime.env` chỉ có issuer, audience và public client config, không credential. Browser giữ phiên OIDC trong `sessionStorage` theo tab, dùng `oidc-client-ts` cho callback/renewal/logout; Python tiếp tục được bảo vệ bằng service token riêng.

## Kiểm thử thật

Giữ app đang chạy ở 5173/8080, chạy thêm hai terminal riêng:

```bash
python3 infra/local/run.py backend --auth oidc --port 8083
python3 infra/local/run.py frontend --auth oidc --port 5175 --api-url http://127.0.0.1:8083
```

Sau khi Java và React sẵn sàng:

```bash
node infra/local/oidc-browser.mjs
```

Test dùng Playwright đã cài trong frontend, đăng nhập bốn tài khoản qua form Keycloak thật và gọi Java thật. Kiểm tra callback, password sai, roles, API 401 khi anonymous/chữ ký sai/audience sai/token hết hạn, API 403 khi thiếu role/resource grant, ADMIN test kết nối warehouse đã đăng ký, automatic token renewal và sign-out ở cả browser/IdP. Test đợi token hết hạn thật (kèm clock-skew của Java), vì vậy mất vài phút. Không bật trace/video hoặc log request body; report chỉ có kết quả kiểm tra, không password/token/user claims.

Report: `.local/oidc-browser-report.json`; biến `OIDC_TEST_APP_URL`/`OIDC_TEST_API_URL` có thể thay URL test, nhưng origin redirect phải được đăng ký trước tại IdP. Unit tests cấu hình: `python -m pytest infra/local/test_oidc.py`. Evidence thực tế và giới hạn commit xem [work log](work-log.md).

## Phạm vi deployment

`infra/compose.auth.yml` pin Keycloak `26.8.1`, dùng `start-dev` và local persistent volume cho môi trường phát triển. Đây là IdP development có browser/Java integration thật, chưa phải production identity deployment. Production cần issuer HTTPS được quản trị, persistence/backup của IdP, TLS/network policy, chính sách session/MFA/account lifecycle và secret provider của môi trường; app giữ nguyên issuer/audience/role contract. Chưa có bằng chứng E2E production hoặc nhiều node từ test local này.

Tham chiếu chính thức: [Keycloak containers](https://www.keycloak.org/server/containers), [Docker quickstart](https://www.keycloak.org/getting-started/getting-started-docker), [hostname](https://www.keycloak.org/server/hostname), [client/role/audience administration](https://www.keycloak.org/docs/latest/server_admin/index.html). Phiên bản image được pin theo Docker quickstart đã kiểm tra; không dùng tag `latest`.
