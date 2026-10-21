import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Save, Server, Trash2 } from "lucide-react";
import { useAuth } from "../app/auth";
import { modelProviderApi } from "../api/modelProviderApi";
import {
  ModelProviderInputSchema,
  ModelProviderUpdateSchema,
  type ModelProvider,
  type ModelProviders as Providers,
} from "../api/modelProviderSchema";
import {
  defaultProvider,
  providerLabel,
  providerSourceLabel,
} from "../lib/modelProvider";
import {
  Button,
  Card,
  DetailList,
  Empty,
  ErrorState,
  Field,
  Modal,
  Notice,
  Resource,
} from "./ui";

export function ModelProviders() {
  const providers = useQuery({
    queryKey: ["model-providers"],
    queryFn: ({ signal }) => modelProviderApi.list(signal),
  });
  return (
    <Resource resource={providers}>
      {(data) => <ProviderManager data={data} />}
    </Resource>
  );
}
function ProviderManager({ data }: { data: Providers }) {
  const auth = useAuth();
  const client = useQueryClient();
  const [editing, setEditing] = useState<ModelProvider | "new" | null>(null);
  const [deleting, setDeleting] = useState<ModelProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const current = defaultProvider(data);
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["model-providers"] }),
      client.invalidateQueries({ queryKey: ["settings"] }),
    ]);
  };
  async function changeDefault(providerId: string | null) {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await modelProviderApi.setDefault(providerId);
      await refresh();
      setNotice(
        "Đã đổi model mặc định. Các truy vấn đã chạy giữ nguyên nguồn model trong snapshot.",
      );
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      title="Model và API key"
      icon={<KeyRound size={22} />}
      actions={
        auth.can("ADMIN") && (
          <Button
            disabled={!data.configurationAvailable || busy}
            onClick={() => setEditing("new")}
          >
            <Plus size={17} />
            Thêm cấu hình model
          </Button>
        )
      }
    >
      <p className="muted">
        Quản lý model gọi API online hoặc Ollama local. Lưu cấu hình không tự
        gọi model, kiểm thử key hay phát sinh yêu cầu tính phí. API key của nhà
        cung cấp có thể đi kèm chi phí sử dụng; kiểm tra hạn mức tại nhà cung
        cấp.
      </p>
      <Notice>
        Key chỉ gửi tới Java để lưu mã hóa trên server và không được trả về
        trình duyệt. Bạn có thể thay key hoặc xóa tường minh. Cấu hình
        deployment chỉ đọc và vẫn được giữ nguyên.
      </Notice>
      {!auth.can("ADMIN") && (
        <Notice>
          Bạn được xem thông tin model an toàn. Chỉ ADMIN được thêm, sửa, xóa
          key và chọn mặc định.
        </Notice>
      )}
      {!data.configurationAvailable && (
        <Notice tone="warning">
          Server chưa sẵn sàng lưu cấu hình mã hóa. Quản trị viên cần kiểm tra
          cấu hình khóa mã hóa của deployment; ứng dụng không lưu key dạng văn
          bản thay thế.
        </Notice>
      )}
      <div className="provider-default">
        <div>
          <small>Model mặc định cho Tự động và trợ lý ngữ nghĩa</small>
          <strong>
            {current
              ? `${current.name} · ${providerLabel(current)}`
              : "Chưa có model mặc định khả dụng"}
          </strong>
        </div>
        {auth.can("ADMIN") && (
          <Field label="Chọn cấu hình mặc định">
            <select
              disabled={busy || !data.configurationAvailable}
              value={data.defaultProviderId || ""}
              onChange={(event) =>
                void changeDefault(event.target.value || null)
              }
            >
              <option value="">Dùng cấu hình deployment nếu có</option>
              {data.items
                .filter((item) => item.configured && item.enabled)
                .map((item) => (
                  <option key={item.providerId} value={item.providerId}>
                    {item.name} · {providerLabel(item)}
                  </option>
                ))}
            </select>
          </Field>
        )}
      </div>
      {error != null && <ErrorState error={error} />}
      {notice && <Notice tone="success">{notice}</Notice>}
      {!data.items.length ? (
        <Empty
          title="Chưa có cấu hình model"
          description="ADMIN có thể thêm provider phù hợp. Offline vẫn chỉ khớp ví dụ đã khai báo, không tự sinh câu trả lời bằng AI."
        />
      ) : (
        <div className="provider-list">
          {data.items.map((item) => (
            <article
              className="provider-card"
              data-provider-id={item.providerId}
              key={item.providerId}
            >
              <div className="provider-card-heading">
                <div>
                  <Server size={18} />
                  <h3>{item.name}</h3>
                  {current?.providerId === item.providerId && (
                    <span className="chip">Mặc định</span>
                  )}
                </div>
                <span
                  className={`badge ${item.enabled && item.configured ? "success" : "neutral"}`}
                >
                  {!item.enabled
                    ? "Đã tắt"
                    : item.configured
                      ? "Đã cấu hình"
                      : "Chưa đủ cấu hình"}
                </span>
              </div>
              <DetailList
                items={[
                  ["Model", providerLabel(item)],
                  ["Địa chỉ API", item.baseUrl],
                  ["Nguồn cấu hình", providerSourceLabel(item.source)],
                  [
                    "API key",
                    item.hasApiKey
                      ? "Đã lưu · không hiển thị lại"
                      : "Chưa lưu / không yêu cầu",
                  ],
                  ["Revision", item.revision],
                ]}
              />
              {auth.can("ADMIN") && !item.readOnly && (
                <div className="inline-actions">
                  <Button
                    disabled={busy || !data.configurationAvailable}
                    onClick={() => setEditing(item)}
                  >
                    <Pencil size={16} />
                    Chỉnh sửa
                  </Button>
                  <Button
                    variant="danger"
                    disabled={
                      busy ||
                      current?.providerId === item.providerId ||
                      !data.configurationAvailable
                    }
                    title={
                      current?.providerId === item.providerId
                        ? "Đổi mặc định trước khi xóa"
                        : "Xóa cấu hình model"
                    }
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 size={16} />
                    Xóa
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {editing && (
        <Modal
          title={
            editing === "new"
              ? "Thêm cấu hình model"
              : `Chỉnh sửa ${editing.name}`
          }
          onClose={() => setEditing(null)}
        >
          <ProviderForm
            key={
              editing === "new"
                ? "new"
                : `${editing.providerId}/${editing.revision}`
            }
            provider={editing === "new" ? undefined : editing}
            onSaved={async () => {
              setEditing(null);
              await refresh();
              setNotice(
                "Đã lưu cấu hình. Key không được hiển thị lại và chưa được kiểm thử bằng yêu cầu model.",
              );
            }}
            onCancel={() => setEditing(null)}
            onReload={async () => {
              setEditing(null);
              await refresh();
            }}
          />
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Xóa cấu hình model"
          onClose={() => !busy && setDeleting(null)}
        >
          <p>
            Xóa cấu hình “{deleting.name}” và key đã lưu của cấu hình này?
            Snapshot truy vấn cũ vẫn giữ nguồn model đã dùng.
          </p>
          <div className="inline-actions">
            <Button disabled={busy} onClick={() => setDeleting(null)}>
              Hủy
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await modelProviderApi.remove(deleting.providerId);
                  setDeleting(null);
                  await refresh();
                  setNotice("Đã xóa cấu hình model.");
                } catch (failure) {
                  setError(failure);
                  setDeleting(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Xóa cấu hình
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
function ProviderForm({
  provider,
  onSaved,
  onCancel,
  onReload,
}: {
  provider?: ModelProvider;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  onReload: () => Promise<void>;
}) {
  const [name, setName] = useState(provider?.name || "");
  const [kind, setKind] = useState<"ONLINE" | "OLLAMA">(
    provider?.kind || "ONLINE",
  );
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl || "");
  const [model, setModel] = useState(provider?.model || "");
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [validation, setValidation] = useState("");
  const password = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const field = password.current;
    return () => {
      if (field) field.value = "";
    };
  }, []);
  return (
    <form
      className="stack provider-form"
      autoComplete="off"
      onSubmit={async (event) => {
        event.preventDefault();
        setValidation("");
        setError(null);
        const apiKey = password.current?.value || "";
        const body = {
          name,
          kind,
          baseUrl,
          model,
          enabled,
          ...(apiKey ? { apiKey } : {}),
        };
        const parsed = provider
          ? ModelProviderUpdateSchema.safeParse({
              ...body,
              revision: provider.revision,
              ...(clearApiKey ? { clearApiKey } : {}),
            })
          : ModelProviderInputSchema.safeParse(body);
        if (!parsed.success) {
          setValidation(
            parsed.error.issues.map((issue) => issue.message).join(" · "),
          );
          if (password.current) password.current.value = "";
          return;
        }
        const destinationChanged =
          provider && (kind !== provider.kind || baseUrl !== provider.baseUrl);
        const retainedKey =
          provider?.hasApiKey && !clearApiKey && !destinationChanged;
        if (
          (destinationChanged &&
            provider.hasApiKey &&
            !apiKey &&
            !clearApiKey) ||
          (enabled && kind === "ONLINE" && !apiKey && !retainedKey)
        ) {
          setValidation(
            destinationChanged
              ? "Đổi địa chỉ hoặc loại provider cần nhập key mới hoặc xóa key cũ tường minh."
              : "Model online đang bật cần API key. Nhập key hoặc tắt cấu hình.",
          );
          if (password.current) password.current.value = "";
          return;
        }
        setBusy(true);
        // Credentials are passed directly once, never held in a query/mutation cache or browser storage.
        try {
          if (provider)
            await modelProviderApi.update(provider.providerId, {
              ...body,
              revision: provider.revision,
              ...(clearApiKey ? { clearApiKey } : {}),
            });
          else await modelProviderApi.create(body);
          if (password.current) password.current.value = "";
          await onSaved();
        } catch (failure) {
          setError(failure);
        } finally {
          if (password.current) password.current.value = "";
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <legend>Thông tin kết nối model</legend>
        <div className="form-grid">
          <Field label="Tên cấu hình">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <Field label="Loại provider">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              <option value="ONLINE">API online</option>
              <option value="OLLAMA">Ollama local</option>
            </select>
          </Field>
          <Field label="Base URL tương thích Chat Completions">
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              maxLength={2048}
              required
              placeholder="Địa chỉ endpoint API được server cho phép"
            />
          </Field>
          <Field label="Tên model chính xác">
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              maxLength={200}
              required
            />
          </Field>
        </div>
        <Field
          label={
            provider?.hasApiKey
              ? "API key mới (để trống để giữ key đã lưu)"
              : "API key"
          }
          hint="Không dán key vào tên, URL hoặc tên model. Key không được lưu trên trình duyệt."
        >
          <input
            ref={password}
            aria-label={provider?.hasApiKey ? "API key mới" : "API key"}
            type="password"
            autoComplete="new-password"
            maxLength={8192}
            disabled={clearApiKey}
          />
        </Field>
        {provider?.hasApiKey && (
          <label className="provider-check">
            <input
              type="checkbox"
              checked={clearApiKey}
              onChange={(event) => {
                setClearApiKey(event.target.checked);
                if (password.current) password.current.value = "";
              }}
            />
            Xóa API key đã lưu
          </label>
        )}
        <label className="provider-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Bật cấu hình model
        </label>
      </fieldset>
      <p className="muted">
        Ollama local cần dịch vụ đang chạy và model đã tải. Server kiểm tra
        URL/host được phép; host ngoài danh sách cần được quản trị deployment
        cho phép. Lưu không gửi yêu cầu thử key.
      </p>
      {validation && <Notice tone="error">{validation}</Notice>}
      {error != null && (
        <>
          <ErrorState error={error} />
          <Button disabled={busy} onClick={() => void onReload()}>
            Đóng và tải lại cấu hình
          </Button>
        </>
      )}
      <div className="inline-actions">
        <Button disabled={busy} onClick={onCancel}>
          Hủy
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          <Save size={17} />
          {busy ? "Đang lưu cấu hình…" : "Lưu cấu hình model"}
        </Button>
      </div>
    </form>
  );
}
