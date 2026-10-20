import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  Plus,
  Plug,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { useWarehouse } from "../app/providers";
import { useAuth } from "../app/auth";
import { warehouseApi } from "../api/warehouseApi";
import { datasetApi } from "../api/datasetApi";
import {
  WarehouseInputSchema,
  EngineSchema,
  type Warehouse,
  type WarehouseInput,
} from "../api/schema";
import {
  engineLabel,
  formatDate,
  formatDuration,
  isActive,
} from "../lib/format";
import { PageHeading } from "../components/Shell";
import { Artwork } from "../components/Artwork";
import {
  ApiAccess,
  Badge,
  Button,
  Card,
  DataGrid,
  DetailList,
  Empty,
  ErrorState,
  Field,
  Filters,
  Modal,
  Notice,
  Pagination,
  Resource,
  useListState,
} from "../components/ui";
export function WarehousesPage() {
  const c = useWarehouse(),
    auth = useAuth(),
    client = useQueryClient(),
    list = useListState("name"),
    [editing, setEditing] = useState<Warehouse | "new" | null>(null),
    [selected, setSelected] = useState(""),
    [confirm, setConfirm] = useState<Warehouse | null>(null);
  const warehouses = useQuery({
    queryKey: ["warehouses", list.params],
    queryFn: ({ signal }) => warehouseApi.list(list.params, signal),
    enabled: c.enabled,
  });
  const detail = useQuery({
    queryKey: ["warehouse", selected],
    queryFn: ({ signal }) => warehouseApi.get(selected, signal),
    enabled: c.enabled && Boolean(selected),
  });
  const toggle = useMutation({
    mutationFn: (w: Warehouse) =>
      warehouseApi.update(w.warehouseId, {
        status: w.status === "DISABLED" ? "ACTIVE" : "DISABLED",
      }),
    onSuccess: () => {
      setConfirm(null);
      void client.invalidateQueries({ queryKey: ["warehouses"] });
      void client.invalidateQueries({ queryKey: ["warehouse"] });
    },
  });
  return (
    <>
      <PageHeading
        title="Quản lý Warehouses"
        description="Đăng ký kết nối tới warehouse đã tồn tại, kiểm tra trạng thái và khám phá metadata. Một giao diện thống nhất cho PostgreSQL, MySQL và SQL Server."
        art={<Artwork kind="database" />}
        actions={
          <Button
            variant="primary"
            disabled={!auth.can("ADMIN")}
            onClick={() => setEditing("new")}
          >
            <Plus size={18} />
            Thêm warehouse
          </Button>
        }
      />
      <ApiAccess>
        {!auth.can("ADMIN") && (
          <Notice>
            Bạn đang ở chế độ xem. Quyền ADMIN cần thiết để thêm, sửa, kiểm tra
            hoặc khám phá warehouse.
          </Notice>
        )}
        <Filters
          key={JSON.stringify(list.params)}
          onApply={list.patch}
          onReset={list.reset}
        >
          <Field label="Tìm kiếm">
            <input
              name="search"
              defaultValue={String(list.params.search || "")}
              placeholder="Tên warehouse…"
            />
          </Field>
          <Field label="Engine">
            <select
              name="engine"
              defaultValue={String(list.params.engine || "")}
            >
              <option value="">Tất cả</option>
              {EngineSchema.options.map((e) => (
                <option value={e} key={e}>
                  {engineLabel[e]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Trạng thái">
            <select
              name="status"
              defaultValue={String(list.params.status || "")}
            >
              <option value="">Tất cả</option>
              {["ACTIVE", "UNAVAILABLE", "INVALID", "DISABLED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Sắp xếp">
            <select
              name="direction"
              defaultValue={String(list.params.direction)}
            >
              <option value="ASC">Tên A → Z</option>
              <option value="DESC">Tên Z → A</option>
            </select>
          </Field>
        </Filters>
        <div className={selected ? "catalog-grid" : "catalog-single"}>
          <Card title="Danh sách warehouse" icon={<Database size={23} />}>
            <Resource resource={warehouses}>
              {(data) => (
                <>
                  <DataGrid
                    rows={data.items}
                    rowKey={(w) => w.warehouseId}
                    selected={selected}
                    onSelect={(w) => setSelected(w.warehouseId)}
                    onSort={list.sort}
                    sort={String(list.params.sort)}
                    direction={String(list.params.direction)}
                    columns={[
                      {
                        key: "name",
                        label: "Tên warehouse",
                        render: (w) => <strong>{w.name}</strong>,
                        sortable: true,
                      },
                      {
                        key: "engine",
                        label: "Engine",
                        render: (w) => engineLabel[w.engine],
                      },
                      {
                        key: "status",
                        label: "Trạng thái",
                        render: (w) => <Badge status={w.status} />,
                      },
                      {
                        key: "capabilities",
                        label: "Khả năng",
                        render: (w) => (
                          <span className="muted">
                            {[
                              w.capabilities.readOnlyQuery && "Read-only query",
                              w.capabilities.metadataDiscovery && "Discovery",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ),
                      },
                      {
                        key: "actions",
                        label: "Thao tác",
                        render: (w) => (
                          <div className="inline-actions">
                            <Button
                              disabled={!auth.can("ADMIN")}
                              aria-label={`Sửa ${w.name}`}
                              onClick={() => {
                                setSelected(w.warehouseId);
                                setEditing(w);
                              }}
                            >
                              <Settings2 size={16} />
                              Sửa
                            </Button>
                            <Button
                              variant={
                                w.status === "DISABLED" ? "secondary" : "danger"
                              }
                              disabled={!auth.can("ADMIN") || toggle.isPending}
                              onClick={() => setConfirm(w)}
                            >
                              {w.status === "DISABLED"
                                ? "Kích hoạt"
                                : "Vô hiệu hóa"}
                            </Button>
                          </div>
                        ),
                      },
                    ]}
                  />
                  <Pagination {...data} onChange={list.paginate} />
                </>
              )}
            </Resource>
          </Card>
          {selected && (
            <aside>
              <Card
                title="Chi tiết kết nối"
                actions={
                  <Button variant="ghost" onClick={() => setSelected("")}>
                    Đóng
                  </Button>
                }
              >
                <Resource resource={detail}>
                  {(w) => <WarehouseDetail key={w.warehouseId} warehouse={w} />}
                </Resource>
              </Card>
            </aside>
          )}
        </div>
      </ApiAccess>
      {editing && (
        <WarehouseForm
          warehouse={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(w) => {
            setSelected(w.warehouseId);
            setEditing(null);
            void client.invalidateQueries({ queryKey: ["warehouses"] });
            void client.invalidateQueries({ queryKey: ["warehouse"] });
          }}
        />
      )}
      {confirm && (
        <Modal
          title={
            confirm.status === "DISABLED"
              ? "Kích hoạt warehouse"
              : "Vô hiệu hóa warehouse"
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm.status === "DISABLED"
              ? "Yêu cầu Java kiểm tra và kích hoạt lại"
              : "Tạm dừng các truy vấn mới tới"}{" "}
            <strong>{confirm.name}</strong> ({engineLabel[confirm.engine]})?
          </p>
          {toggle.error && <ErrorState error={toggle.error} />}
          <div className="inline-actions">
            <Button
              disabled={toggle.isPending}
              onClick={() => setConfirm(null)}
            >
              Hủy
            </Button>
            <Button
              variant="primary"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate(confirm)}
            >
              Xác nhận
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function WarehouseForm({
  warehouse,
  onClose,
  onSaved,
}: {
  warehouse?: Warehouse;
  onClose: () => void;
  onSaved: (w: Warehouse) => void;
}) {
  const c = useWarehouse();
  const details = useQuery({
    queryKey: ["warehouse", warehouse?.warehouseId],
    queryFn: ({ signal }) => warehouseApi.get(warehouse!.warehouseId, signal),
    enabled: c.enabled && Boolean(warehouse),
  });
  return (
    <Modal
      title={warehouse ? "Chỉnh sửa warehouse" : "Đăng ký warehouse"}
      onClose={onClose}
    >
      {warehouse ? (
        <Resource resource={details}>
          {(w) => (
            <WarehouseFields
              key={w.warehouseId}
              warehouse={w}
              onSaved={onSaved}
              onClose={onClose}
            />
          )}
        </Resource>
      ) : (
        <WarehouseFields onSaved={onSaved} onClose={onClose} />
      )}
    </Modal>
  );
}
function WarehouseFields({
  warehouse: w,
  onSaved,
  onClose,
}: {
  warehouse?: Warehouse;
  onSaved: (w: Warehouse) => void;
  onClose: () => void;
}) {
  const [engine, setEngine] = useState(w?.engine || "POSTGRESQL"),
    [port, setPort] = useState(String(w?.port || 5432)),
    [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: async (body: WarehouseInput) => {
      if (!w) return warehouseApi.create(body);
      const {
        engine: _,
        credentialReference,
        importCredentialReference,
        ingestionCredentialReference,
        ...update
      } = body;
      return warehouseApi.update(w.warehouseId, {
        ...update,
        ...(credentialReference ? { credentialReference } : {}),
        ...(importCredentialReference ? { importCredentialReference } : {}),
        ...(ingestionCredentialReference
          ? { ingestionCredentialReference }
          : {}),
      });
    },
    onSuccess: onSaved,
  });
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget));
        const input = {
          ...data,
          engine,
          port: Number(port),
          defaultSchema: String(data.defaultSchema || "") || null,
          credentialReference: String(data.credentialReference || ""),
          importCredentialReference: String(
            data.importCredentialReference || "",
          ),
          ingestionUsername: String(
            data.ingestionUsername || w?.ingestionUsername || "",
          ),
          ingestionCredentialReference: String(
            data.ingestionCredentialReference || "",
          ),
        };
        if (
          !w &&
          Boolean(input.ingestionUsername) !==
            Boolean(input.ingestionCredentialReference)
        ) {
          setError(
            "Cấu hình pipeline cần cả ingestion writer username và credential reference.",
          );
          return;
        }
        const validation = WarehouseInputSchema.safeParse({
          ...input,
          credentialReference:
            w && !input.credentialReference
              ? "unchanged"
              : input.credentialReference,
        });
        if (!validation.success) {
          setError(
            validation.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join(" · "),
          );
          return;
        }
        setError("");
        const {
          importCredentialReference: _importReference,
          ingestionCredentialReference: _ingestionReference,
          ...validInput
        } = validation.data;
        mutation.mutate({
          ...validInput,
          credentialReference: input.credentialReference,
          ...(input.importCredentialReference
            ? { importCredentialReference: input.importCredentialReference }
            : {}),
          ...(input.ingestionCredentialReference
            ? {
                ingestionCredentialReference:
                  input.ingestionCredentialReference,
              }
            : {}),
        });
      }}
    >
      <div className="form-grid">
        <Field label="Tên warehouse">
          <input name="name" defaultValue={w?.name} required maxLength={120} />
        </Field>
        <Field label="Engine">
          <select
            value={engine}
            disabled={Boolean(w)}
            onChange={(e) => {
              const v = e.target.value as typeof engine;
              setEngine(v);
              setPort(
                String({ POSTGRESQL: 5432, MYSQL: 3306, SQL_SERVER: 1433 }[v]),
              );
            }}
          >
            {EngineSchema.options.map((e) => (
              <option key={e} value={e}>
                {engineLabel[e]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Host">
          <input
            name="host"
            defaultValue={w?.host}
            required
            placeholder="warehouse.example.internal"
            autoComplete="off"
          />
        </Field>
        <Field label="Port">
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            min={1}
            max={65535}
            required
          />
        </Field>
        <Field label={engine === "MYSQL" ? "Database / Catalog" : "Database"}>
          <input
            name="database"
            defaultValue={w?.database}
            required
            maxLength={128}
          />
        </Field>
        <Field
          label={
            engine === "MYSQL"
              ? "Schema (tùy chọn; database là catalog)"
              : "Default schema"
          }
        >
          <input
            name="defaultSchema"
            defaultValue={w?.defaultSchema || ""}
            maxLength={128}
            placeholder={
              engine === "SQL_SERVER"
                ? "dbo"
                : engine === "POSTGRESQL"
                  ? "public"
                  : "Không bắt buộc"
            }
          />
        </Field>
        <Field label="Username (read-only)">
          <input
            name="username"
            defaultValue={w?.username}
            required
            autoComplete="off"
          />
        </Field>
        <Field
          label="Credential reference"
          hint={
            w
              ? "Để trống để giữ credential đã lưu."
              : "Nhập tham chiếu secret đã được cấu hình ở Java; không nhập mật khẩu."
          }
        >
          <input
            name="credentialReference"
            required={!w}
            maxLength={256}
            autoComplete="off"
          />
        </Field>
        <Field
          label="Import writer credential reference (optional)"
          hint="Chỉ dùng cho SQL Import đã được validate. Nhập env reference như env:WAREHOUSE_IMPORT_WRITER_PASSWORD; không nhập mật khẩu. Để trống để giữ cấu hình hiện tại."
        >
          <input
            name="importCredentialReference"
            maxLength={256}
            autoComplete="off"
          />
        </Field>
        <Field
          label="Ingestion writer username (optional)"
          hint="Tài khoản riêng có quyền ghi cho pipeline. Có thể khác reader; không dùng credential read-only."
        >
          <input
            name="ingestionUsername"
            defaultValue={w?.ingestionUsername}
            maxLength={128}
            autoComplete="off"
          />
        </Field>
        <Field
          label="Ingestion writer credential reference (optional)"
          hint="Tham chiếu env:NAME tới secret được cấu hình trên Java. Không nhập mật khẩu; để trống giữ cấu hình hiện tại."
        >
          <input
            name="ingestionCredentialReference"
            maxLength={256}
            autoComplete="off"
          />
        </Field>
      </div>
      <Notice>
        <ShieldCheck size={16} /> Truy vấn dùng credential read-only. SQL Import
        cần writer reference riêng và chỉ áp dụng kế hoạch đã được server
        validate.
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      {mutation.error && <ErrorState error={mutation.error} />}
      <div className="inline-actions">
        <Button disabled={mutation.isPending} onClick={onClose}>
          Hủy
        </Button>
        <Button variant="primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? "Đang lưu…"
            : w
              ? "Lưu thay đổi"
              : "Đăng ký warehouse"}
        </Button>
      </div>
    </form>
  );
}
function WarehouseDetail({ warehouse: w }: { warehouse: Warehouse }) {
  const auth = useAuth(),
    client = useQueryClient(),
    [runId, setRunId] = useState(""),
    [register, setRegister] = useState(false);
  const test = useMutation({
    mutationFn: () => warehouseApi.test(w.warehouseId),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["warehouse", w.warehouseId] }),
  });
  const discover = useMutation({
    mutationFn: () => warehouseApi.discover(w.warehouseId),
    onSuccess: (r) => setRunId(r.runId),
  });
  const discovery = useQuery({
    queryKey: ["discovery", w.warehouseId, runId],
    queryFn: ({ signal }) =>
      warehouseApi.discovery(w.warehouseId, runId, signal),
    enabled: Boolean(runId),
    refetchInterval: (q) =>
      q.state.data && isActive(q.state.data.status) ? 2000 : false,
  });
  return (
    <>
      <div className="dataset-title">
        <span className="icon-tile">
          <Database />
        </span>
        <div>
          <h3>{w.name}</h3>
          <Badge status={w.status} />
        </div>
      </div>
      <DetailList
        items={[
          ["Warehouse ID", w.warehouseId],
          ["Engine", engineLabel[w.engine]],
          ["Host", w.host],
          ["Port", w.port],
          ["Database", w.database],
          ["Default schema", w.defaultSchema],
          ["Username", w.username],
          ["Ingestion writer username", w.ingestionUsername],
          ["Cập nhật", formatDate(w.updatedAt)],
        ]}
      />
      <div className="inline-actions">
        <Button
          disabled={!auth.can("ADMIN") || test.isPending}
          onClick={() => test.mutate()}
        >
          <Plug size={16} />
          {test.isPending ? "Đang kiểm tra…" : "Test Connection"}
        </Button>
        <Button
          disabled={
            !auth.can("ADMIN") ||
            discover.isPending ||
            Boolean(discovery.data && isActive(discovery.data.status)) ||
            !w.capabilities.metadataDiscovery
          }
          onClick={() => discover.mutate()}
        >
          <RefreshCw size={16} />
          Discover Metadata
        </Button>
      </div>
      {test.error && <ErrorState error={test.error} />}
      {test.data && (
        <Notice tone={test.data.reachable ? "success" : "error"}>
          {test.data.reachable
            ? `Kết nối thành công · ${formatDuration(test.data.latencyMs)}`
            : test.data.error?.message || "Không kết nối được warehouse."}
        </Notice>
      )}
      {discover.error && <ErrorState error={discover.error} />}
      {runId && (
        <Resource resource={discovery}>
          {(d) => (
            <>
              <h3>Khám phá metadata</h3>
              <Badge status={d.status} />
              {d.error && <Notice tone="error">{d.error.message}</Notice>}
              {d.metadata?.schemas.map((s) => (
                <details key={s.name}>
                  <summary>
                    {s.name} · {s.tables.length} bảng
                  </summary>
                  <ul>
                    {s.tables.map((t) => (
                      <li key={t.tableId}>
                        {t.name} · {t.columns.length} cột
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
              {d.status === "SUCCESS" && d.metadata && (
                <Button variant="primary" onClick={() => setRegister(true)}>
                  <Plus size={17} />
                  Đăng ký dataset
                </Button>
              )}
              {register && d.metadata && (
                <DatasetForm
                  warehouse={w}
                  tables={d.metadata.schemas.flatMap((s) => s.tables)}
                  onClose={() => setRegister(false)}
                />
              )}
            </>
          )}
        </Resource>
      )}
    </>
  );
}
function DatasetForm({
  warehouse,
  tables,
  onClose,
}: {
  warehouse: Warehouse;
  tables: { schema: string; name: string; tableId: string }[];
  onClose: () => void;
}) {
  const client = useQueryClient(),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (body: Parameters<typeof datasetApi.create>[0]) =>
      datasetApi.create(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["datasets"] });
      onClose();
    },
  });
  return (
    <Modal title="Đăng ký dataset" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (!selected.length) {
            setError("Chọn ít nhất một bảng cho dataset.");
            return;
          }
          const allowedTables = tables
            .filter((t) => selected.includes(t.tableId))
            .map(({ schema, name }) => ({ schema, name }));
          mutation.mutate({
            warehouseId: warehouse.warehouseId,
            name: String(f.get("name")).trim(),
            description: String(f.get("description")).trim(),
            semanticVersion: String(f.get("semanticVersion")).trim(),
            schemaVersion: String(f.get("schemaVersion")).trim(),
            allowedSchemas: [...new Set(allowedTables.map((t) => t.schema))],
            allowedTables,
          });
        }}
      >
        <Field label="Tên dataset">
          <input name="name" required maxLength={120} />
        </Field>
        <Field label="Mô tả">
          <textarea name="description" required maxLength={2000} />
        </Field>
        <div className="form-grid">
          <Field label="Semantic version">
            <input name="semanticVersion" required />
          </Field>
          <Field label="Schema version">
            <input name="schemaVersion" required />
          </Field>
        </div>
        <fieldset>
          <legend>Bảng được phép truy vấn</legend>
          <div className="checkbox-list">
            {tables.map((t) => (
              <label key={t.tableId}>
                <input
                  type="checkbox"
                  checked={selected.includes(t.tableId)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked
                        ? [...prev, t.tableId]
                        : prev.filter((id) => id !== t.tableId),
                    )
                  }
                />
                {t.schema}.{t.name}
              </label>
            ))}
          </div>
        </fieldset>
        <Notice>
          Java xác thực allowlist và semantic mapping trước khi dataset có thể
          truy vấn.
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}
        {mutation.error && <ErrorState error={mutation.error} />}
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          Đăng ký dataset
        </Button>
      </form>
    </Modal>
  );
}
