import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2, Save, Settings2, ShieldCheck } from "lucide-react";
import { useAuth } from "../app/auth";
import { useWarehouse, useLocale } from "../app/providers";
import { settingsApi } from "../api/settingsApi";
import { SettingsInputSchema, type Settings } from "../api/schema";
import { PageHeading } from "../components/Shell";
import {
  ApiAccess,
  Button,
  Card,
  DetailList,
  ErrorState,
  Field,
  Notice,
  Resource,
} from "../components/ui";
export function SettingsPage() {
 const auth=useAuth(),[localToken,setLocalToken]=useState(''),[localError,setLocalError]=useState(''),[localBusy,setLocalBusy]=useState(false);
  const c = useWarehouse(),
    { locale, setLocale } = useLocale();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: ({ signal }) => settingsApi.get(signal),
    enabled: c.enabled,
  });
  return (
    <>
      <PageHeading
        title="Cài đặt"
        description="Tùy chỉnh trải nghiệm và cấu hình hoạt động của nền tảng. Các thông số hệ thống được kiểm soát và xác thực bởi Java API."
      />
      {auth.localMode&&<Card title="Phiên quản trị local"><p className="muted">Nhập LOCAL_API_TOKEN từ file .local/docker.env để kiểm thử thao tác quản trị trên máy này. Token chỉ giữ trong bộ nhớ, không lưu trình duyệt.</p><form className="inline-actions" onSubmit={async e=>{e.preventDefault();setLocalBusy(true);try{await auth.localLogin?.(localToken);setLocalToken('');setLocalError('');}catch(e){setLocalError(e instanceof Error?e.message:'Đăng nhập thất bại.');}finally{setLocalBusy(false);}}}><Field label="Local API token"><input type="password" value={localToken} onChange={e=>setLocalToken(e.target.value)} autoComplete="off" required minLength={32}/></Field><Button type="submit" variant="primary" disabled={localBusy}>Kết nối phiên local</Button></form>{localError&&<Notice tone="error">{localError}</Notice>}{auth.can('ADMIN')&&<Notice tone="success">Phiên local đã được Java xác thực với quyền ADMIN.</Notice>}</Card>}<Card title="Tùy chọn giao diện" icon={<Globe2 size={22} />}>
        <div className="form-grid">
          <Field label="Ngôn ngữ điều hướng">
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </Field>
          <div>
            <strong>Múi giờ hiển thị</strong>
            <p className="muted">
              Asia/Ho_Chi_Minh (UTC+07). Truy vấn tương đối sử dụng múi giờ của
              dataset.
            </p>
          </div>
        </div>
      </Card>
      <ApiAccess>
        <Resource resource={settings}>
          {(data) => (
            <SettingsForm key={JSON.stringify(data)} settings={data} />
          )}
        </Resource>
      </ApiAccess>
    </>
  );
}
function SettingsForm({ settings: s }: { settings: Settings }) {
  const auth = useAuth(),
    client = useQueryClient(),
    [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: settingsApi.update,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["settings"] }),
  });
  return (
    <Card title="Cấu hình nền tảng" icon={<Settings2 size={22} />}>
      <Notice>
        <ShieldCheck size={17} />
        API keys và credential secrets được cấu hình tại deployment, không nhập
        hoặc hiển thị trên frontend.
      </Notice>
      <DetailList
        items={[
          ["Provider đã cấu hình", s.providerConfigured ? "Có" : "Chưa"],
          ["Model", s.modelDisplayName],
          ["Các chế độ có sẵn", s.availableModes.join(", ")],
        ]}
      />
      {!auth.can("ADMIN") && (
        <Notice>
          Bạn có thể xem cấu hình. Quyền ADMIN cần thiết để thay đổi thông số hệ
          thống.
        </Notice>
      )}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const timezone = String(f.get("timezone") || "").trim();
          try {
            new Intl.DateTimeFormat("vi", { timeZone: timezone });
          } catch {
            setError("Múi giờ IANA không hợp lệ.");
            return;
          }
          const input = {
            locale: f.get("locale"),
            timezone,
            defaultQueryMode: f.get("defaultQueryMode"),
            limits: {
              maxRows: Number(f.get("maxRows")),
              maxBytes: Number(f.get("maxBytes")),
              statementTimeoutMs: Number(f.get("statementTimeoutMs")),
              queryDeadlineMs: Number(f.get("queryDeadlineMs")),
            },
          };
          const p = SettingsInputSchema.safeParse(input);
          if (!p.success) {
            setError(
              p.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join(" · "),
            );
            return;
          }
          if (!s.availableModes.includes(p.data.defaultQueryMode)) {
            setError("Chế độ xử lý không khả dụng.");
            return;
          }
          if (
            p.data.limits.statementTimeoutMs >= p.data.limits.queryDeadlineMs
          ) {
            setError("Statement timeout phải nhỏ hơn tổng query deadline.");
            return;
          }
          setError("");
          mutation.mutate(p.data);
        }}
      >
        <fieldset disabled={!auth.can("ADMIN") || mutation.isPending}>
          <legend>Thiết lập mặc định</legend>
          <div className="form-grid">
            <Field label="Ngôn ngữ mặc định">
              <select name="locale" defaultValue={s.locale}>
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label="Múi giờ mặc định">
              <input
                name="timezone"
                defaultValue={s.timezone}
                required
                maxLength={100}
              />
            </Field>
            <Field label="Chế độ xử lý mặc định">
              <select name="defaultQueryMode" defaultValue={s.defaultQueryMode}>
                {s.availableModes.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Giới hạn dòng snapshot">
              <input
                type="number"
                name="maxRows"
                min={1}
                max={1000}
                defaultValue={s.limits.maxRows}
                required
              />
            </Field>
            <Field label="Giới hạn byte snapshot">
              <input
                type="number"
                name="maxBytes"
                min={1}
                max={5242880}
                defaultValue={s.limits.maxBytes}
                required
              />
            </Field>
            <Field label="Statement timeout (ms)">
              <input
                type="number"
                name="statementTimeoutMs"
                min={1}
                max={15000}
                defaultValue={s.limits.statementTimeoutMs}
                required
              />
            </Field>
            <Field label="Tổng query deadline (ms)">
              <input
                type="number"
                name="queryDeadlineMs"
                min={1}
                max={60000}
                defaultValue={s.limits.queryDeadlineMs}
                required
              />
            </Field>
          </div>
        </fieldset>
        {error && <Notice tone="error">{error}</Notice>}
        {mutation.error && <ErrorState error={mutation.error} />}
        {mutation.isSuccess && (
          <Notice tone="success">Đã lưu cấu hình nền tảng.</Notice>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={!auth.can("ADMIN") || mutation.isPending}
        >
          <Save size={17} />
          {mutation.isPending ? "Đang lưu…" : "Lưu cấu hình"}
        </Button>
      </form>
    </Card>
  );
}
