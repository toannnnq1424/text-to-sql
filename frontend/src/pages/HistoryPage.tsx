import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Activity, Clock3, FileText, ShieldAlert } from "lucide-react";
import { executionLabel } from "../lib/modelProvider";
import { historyApi } from "../api/historyApi";
import { monitoringApi } from "../api/monitoringApi";
import { useWarehouse } from "../app/providers";
import { QueryStatusSchema } from "../api/schema";
import {
  engineLabel,
  formatDate,
  formatDuration,
  formatRate,
  utcDateRange,
} from "../lib/format";
import { PageHeading } from "../components/Shell";
import {
  RegistryFilterFields,
  DateFilterFields,
} from "../components/FilterFields";
import {
  ApiAccess,
  Badge,
  Card,
  DataGrid,
  Field,
  Filters,
  Pagination,
  Resource,
  Stat,
  useListState,
} from "../components/ui";
export function HistoryPage() {
  const c = useWarehouse(),
    nav = useNavigate(),
    list = useListState();
  const rows = useQuery({
    queryKey: ["history", list.params],
    queryFn: ({ signal }) => historyApi.list(list.params, signal),
    enabled: c.enabled,
  });
  const metrics = useQuery({
    queryKey: [
      "history-metrics",
      list.params.warehouseId,
      list.params.engine,
      list.params.datasetId,
      list.params.from,
      list.params.to,
    ],
    queryFn: ({ signal }) =>
      monitoringApi.summary(
        {
          warehouseId: list.params.warehouseId,
          engine: list.params.engine,
          datasetId: list.params.datasetId,
          from: list.params.from,
          to: list.params.to,
        },
        signal,
      ),
    enabled: c.enabled,
  });
  return (
    <>
      <PageHeading
        title="Lịch sử truy vấn"
        description="Xem lịch sử truy vấn, trạng thái xử lý, SQL và kết quả thực thi. Tìm kiếm và lọc theo warehouse, dataset, mô hình hoặc khoảng thời gian."
      />
      <ApiAccess>
        <Resource resource={metrics}>
          {(m) => (
            <div className="stats-grid four">
              <Stat
                label="Truy vấn trong khoảng thời gian"
                value={m.queryVolume}
                icon={<FileText />}
              />
              <Stat
                label="Tỷ lệ thành công"
                value={formatRate(m.successRate)}
                icon={<Activity />}
                tone="green"
              />
              <Stat
                label="Thời gian phản hồi trung bình"
                value={formatDuration(m.avgLatencyMs)}
                icon={<Clock3 />}
                tone="purple"
              />
              <Stat
                label="Bị từ chối bởi validation"
                value={m.sqlValidationRejectionCount}
                icon={<ShieldAlert />}
                tone="pink"
              />
            </div>
          )}
        </Resource>
        <Filters
          key={JSON.stringify(list.params)}
          onApply={(v) => {
            const { fromDate, toDate, ...rest } = v;
            list.patch({ ...rest, ...utcDateRange(fromDate, toDate) });
          }}
          onReset={list.reset}
        >
          <Field label="Tìm kiếm">
            <input
              name="search"
              defaultValue={String(list.params.search || "")}
              placeholder="Câu hỏi hoặc ID truy vấn…"
            />
          </Field>
          <RegistryFilterFields params={list.params} />
          <Field label="Trạng thái">
            <select
              name="status"
              defaultValue={String(list.params.status || "")}
            >
              <option value="">Tất cả trạng thái</option>
              {QueryStatusSchema.options.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Model">
            <input
              name="model"
              defaultValue={String(list.params.model || "")}
              placeholder="Tất cả models"
            />
          </Field>
          <DateFilterFields params={list.params} />
          <Field label="Sắp xếp theo">
            <select name="sort" defaultValue={String(list.params.sort)}>
              <option value="createdAt">Thời gian tạo</option>
              <option value="latencyMs">Thời gian phản hồi</option>
              <option value="status">Trạng thái</option>
            </select>
          </Field>
          <Field label="Thứ tự">
            <select
              name="direction"
              defaultValue={String(list.params.direction)}
            >
              <option value="DESC">Giảm dần</option>
              <option value="ASC">Tăng dần</option>
            </select>
          </Field>
        </Filters>
        <Card title="Danh sách truy vấn">
          <Resource resource={rows}>
            {(data) => (
              <>
                <DataGrid
                  rows={data.items}
                  rowKey={(q) => q.queryId}
                  onSelect={(q) =>
                    nav(`/history/${encodeURIComponent(q.queryId)}/overview`)
                  }
                  sort={String(list.params.sort)}
                  direction={String(list.params.direction)}
                  onSort={list.sort}
                  columns={[
                    {
                      key: "queryId",
                      label: "Query ID",
                      render: (q) => q.queryId,
                    },
                    {
                      key: "question",
                      label: "Câu hỏi",
                      render: (q) => (
                        <span className="question-cell">{q.question}</span>
                      ),
                    },
                    {
                      key: "warehouse",
                      label: "Warehouse",
                      render: (q) => q.warehouseId,
                    },
                    {
                      key: "engine",
                      label: "Engine",
                      render: (q) => engineLabel[q.engine],
                    },
                    {
                      key: "dataset",
                      label: "Dataset",
                      render: (q) => q.datasetId,
                    },
                    {
                      key: "status",
                      label: "Trạng thái",
                      render: (q) => <Badge status={q.status} />,
                      sortable: true,
                    },
                    {
                      key: "model",
                      label: "Model / cơ chế xử lý",
                      render: (q) => executionLabel(q),
                    },
                    {
                      key: "latencyMs",
                      label: "Phản hồi",
                      render: (q) => formatDuration(q.latencyMs),
                      sortable: true,
                    },
                    {
                      key: "createdAt",
                      label: "Thời gian tạo",
                      render: (q) => formatDate(q.createdAt),
                      sortable: true,
                    },
                  ]}
                />
                <Pagination {...data} onChange={list.paginate} />
              </>
            )}
          </Resource>
        </Card>
      </ApiAccess>
    </>
  );
}
