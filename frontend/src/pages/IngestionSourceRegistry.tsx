import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Pencil, Plus, Power, RefreshCw } from "lucide-react";
import { useAuth } from "../app/auth";
import { useWarehouse } from "../app/providers";
import { IngestionSourceWizard } from "./IngestionSourceWizard";
import { datasetApi } from "../api/datasetApi";
import { ingestionApi } from "../api/ingestionApi";
import { warehouseApi } from "../api/warehouseApi";
import type {
  IngestionSource,
  IngestionSourceInput,
  Source,
  SourceTest,
} from "../api/schema";
import {
  Badge,
  Button,
  Card,
  DataGrid,
  Empty,
  ErrorState,
  Modal,
  Notice,
  Pagination,
  useListState,
} from "../components/ui";

export function IngestionSourceRegistry({
  onSaved,
}: {
  onSaved?: (source: IngestionSource) => void;
}) {
  const context = useWarehouse();
  const auth = useAuth();
  const client = useQueryClient();
  const [editingId, setEditingId] = useState<string>();
  const [savedSource, setSavedSource] = useState<IngestionSource>();
  const [creating, setCreating] = useState(false);
  const [testResult, setTestResult] = useState<SourceTest>();
  const sourceList = useListState("name");
  const query = useQuery({
    queryKey: [
      "ingestion-sources",
      context.warehouseId,
      context.datasetId,
      sourceList.params,
    ],
    queryFn: ({ signal }) =>
      ingestionApi.sources(
        {
          warehouseId: context.warehouseId,
          datasetId: context.datasetId,
          ...sourceList.params,
        },
        signal,
      ),
    enabled: Boolean(context.warehouseId && context.datasetId),
  });
  const detail = useQuery({
    queryKey: ["ingestion-source", editingId],
    queryFn: ({ signal }) => ingestionApi.source(editingId!, signal),
    enabled: Boolean(editingId),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["ingestion-sources"] });
    void client.invalidateQueries({ queryKey: ["ingestion-source"] });
    void client.invalidateQueries({ queryKey: ["selector"] });
  };
  const save = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id?: string;
      input: IngestionSourceInput;
    }) => {
      if (!id) return ingestionApi.createSource(input);
      const original = detail.data;
      if (!original) throw new Error("Cấu hình nguồn chưa tải xong.");
      const patch = Object.fromEntries(
        Object.entries(input).filter(
          ([key, value]) =>
            JSON.stringify(value) !==
            JSON.stringify(original[key as keyof IngestionSource]),
        ),
      ) as Partial<IngestionSourceInput>;
      return Object.keys(patch).length
        ? ingestionApi.updateSource(id, patch)
        : Promise.resolve(original);
    },
    onSuccess: (saved) => {
      setSavedSource(saved);
      if (
        saved.warehouseId === context.warehouseId &&
        saved.datasetId === context.datasetId
      )
        onSaved?.(saved);
      setCreating(false);
      setEditingId(undefined);
      setTestResult(undefined);
      refresh();
      if (saved.sourceId)
        void client.invalidateQueries({ queryKey: ["ingestion"] });
    },
  });
  const toggle = useMutation({
    mutationFn: (source: Source) =>
      ingestionApi.updateSource(source.sourceId, {
        status: source.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
      }),
    onSuccess: refresh,
  });
  const test = useMutation({
    mutationFn: (id: string) => ingestionApi.testSource(id),
    onSuccess: (result) => setTestResult(result),
  });
  const canManage = auth.can("ADMIN");
  const sourcePage = query.data;

  return (
    <>
      <Card
        title="Nguồn dữ liệu đã lưu"
        icon={<RefreshCw size={21} />}
        actions={
          canManage && (
            <Button
              variant="primary"
              onClick={() => {
                setTestResult(undefined);
                setCreating(true);
              }}
            >
              <Plus size={17} /> Đăng ký nguồn
            </Button>
          )
        }
      >
        <p className="source-wizard-help">
          Mỗi nguồn lưu cách đọc dữ liệu và bốn bảng nhận. Đăng ký một lần, sau
          đó chọn lại ở mục Nguồn dữ liệu để chạy. Nếu cần tải CSV, Excel hoặc
          các file khác, dùng tab Nạp file.
        </p>
        {savedSource && (
          <Notice tone="success">
            Đã lưu nguồn <strong>{savedSource.name}</strong>.{" "}
            {savedSource.warehouseId === context.warehouseId &&
            savedSource.datasetId === context.datasetId
              ? "Nguồn đã được chọn ở trên. Bấm Chạy pipeline mới khi muốn bắt đầu nạp."
              : "Chọn warehouse và dataset đích tương ứng ở thanh trên để chạy nguồn vừa lưu."}
          </Notice>
        )}
        {!canManage && (
          <Notice>
            Chỉ quản trị viên mới được đăng ký, sửa hoặc kiểm tra nguồn.
          </Notice>
        )}
        {query.error && (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        )}
        {query.isPending && <p role="status">Đang tải nguồn đã đăng ký…</p>}
        {sourcePage && sourcePage.items.length === 0 && (
          <Empty
            title="Chưa có nguồn dữ liệu đã lưu"
            description="Lưu cách lấy dữ liệu từ một bảng hoặc truy vấn, cùng nơi nhận dữ liệu, để dùng lại mỗi lần nạp."
            action={
              canManage ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus size={16} /> Đăng ký nguồn
                </Button>
              ) : undefined
            }
          />
        )}
        {sourcePage && sourcePage.items.length > 0 && (
          <>
            <DataGrid
              rows={sourcePage.items}
              rowKey={(source) => source.sourceId}
              columns={[
                {
                  key: "name",
                  label: "Nguồn",
                  render: (source) => (
                    <>
                      <strong>{source.name}</strong>
                      <small>{source.sourceId}</small>
                    </>
                  ),
                },
                {
                  key: "origin",
                  label: "Warehouse nguồn",
                  render: (source) => (
                    <>
                      <SourceIdentity source={source} />
                    </>
                  ),
                },
                {
                  key: "status",
                  label: "Trạng thái",
                  render: (source) => <Badge status={source.status} />,
                },
                {
                  key: "actions",
                  label: "Thao tác",
                  render: (source) => (
                    <div className="inline-actions">
                      {canManage && (
                        <>
                          <Button
                            aria-label={`Kiểm tra ${source.name}`}
                            disabled={test.isPending}
                            onClick={() => {
                              setTestResult(undefined);
                              test.mutate(source.sourceId);
                            }}
                          >
                            <FlaskConical size={16} /> Kiểm tra
                          </Button>
                          <Button
                            aria-label={`Sửa ${source.name}`}
                            onClick={() => {
                              setTestResult(undefined);
                              setEditingId(source.sourceId);
                            }}
                          >
                            <Pencil size={16} /> Sửa
                          </Button>
                          <Button
                            aria-label={`${source.status === "ACTIVE" ? "Tắt" : "Bật"} ${source.name}`}
                            disabled={toggle.isPending}
                            onClick={() => toggle.mutate(source)}
                          >
                            <Power size={16} />{" "}
                            {source.status === "ACTIVE" ? "Tắt" : "Bật"}
                          </Button>
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
            />
            <Pagination {...sourcePage} onChange={sourceList.paginate} />
          </>
        )}
        {toggle.error && <ErrorState error={toggle.error} />}
        {test.error && !creating && !editingId && (
          <ErrorState
            error={test.error}
            retry={() => test.mutate(test.variables!)}
          />
        )}
        {testResult && !creating && !editingId && (
          <SourceTestResult result={testResult} />
        )}
        {(creating || editingId) && (
          <Modal
            title={creating ? "Thêm nguồn dữ liệu" : "Sửa nguồn dữ liệu"}
            onClose={() => {
              setCreating(false);
              setEditingId(undefined);
              setTestResult(undefined);
              save.reset();
            }}
          >
            {editingId && detail.isPending && (
              <p role="status">Đang tải cấu hình nguồn…</p>
            )}
            {editingId && detail.error && (
              <ErrorState
                error={detail.error}
                retry={() => void detail.refetch()}
              />
            )}
            {(!editingId || detail.data) && (
              <IngestionSourceWizard
                key={detail.data?.sourceId || "new-source"}
                initial={detail.data}
                currentWarehouse={context.warehouse}
                currentDataset={context.dataset}
                busy={save.isPending}
                error={save.error}
                onSubmit={(input) => save.mutate({ id: editingId, input })}
              />
            )}
          </Modal>
        )}
      </Card>
    </>
  );
}

function SourceTestResult({ result }: { result: SourceTest }) {
  return (
    <div className="source-test-result">
      <Notice tone={result.reachable ? "success" : "error"}>
        <strong>
          {result.reachable ? "Nguồn và đích sẵn sàng" : "Kiểm tra chưa đạt"}
        </strong>
        <div>
          {result.sourceEngine} → {result.targetEngine} ·{" "}
          {result.rowCount.toLocaleString("vi-VN")} dòng mẫu
          {result.truncated ? " (đã giới hạn)" : ""} ·{" "}
          {new Date(result.checkedAt).toLocaleString("vi-VN")}
        </div>
      </Notice>
      <p>
        Cột trả về:{" "}
        {result.columns
          .map((column) => `${column.name} (${column.dataType})`)
          .join(", ") || "không có"}
      </p>
      <p>
        Đích đã kiểm tra:{" "}
        {result.targets
          .map((target) => `${target.schema}.${target.name}`)
          .join(", ") || "không có"}
      </p>
    </div>
  );
}

function SourceIdentity({ source }: { source: Source }) {
  const warehouse = useQuery({
    queryKey: ["source-identity-warehouse", source.sourceWarehouseId],
    queryFn: ({ signal }) => warehouseApi.get(source.sourceWarehouseId, signal),
  });
  const dataset = useQuery({
    queryKey: ["source-identity-dataset", source.sourceDatasetId],
    queryFn: ({ signal }) => datasetApi.get(source.sourceDatasetId, signal),
  });
  if (warehouse.error || dataset.error)
    return <span>Không tải được tên nguồn</span>;
  return (
    <>
      <span>{warehouse.data?.name || "Đang tải kết nối…"}</span>
      <small>{dataset.data?.name || "Đang tải dataset…"}</small>
    </>
  );
}
