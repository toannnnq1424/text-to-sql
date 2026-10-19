import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Clock3,
  Database,
  RefreshCw,
  ShieldAlert,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useWarehouse } from "../app/providers";
import { monitoringApi } from "../api/monitoringApi";
import {
  engineLabel,
  formatDate,
  formatDuration,
  formatRate,
  utcDateRange,
} from "../lib/format";
import { PageHeading } from "../components/Shell";
import {
  DateFilterFields,
  RegistryFilterFields,
} from "../components/FilterFields";
import {
  ApiAccess,
  Badge,
  Button,
  Card,
  Empty,
  Filters,
  Resource,
  Stat,
  useListState,
} from "../components/ui";
export function MonitoringPage() {
  const c = useWarehouse(),
    list = useListState(),
    [auto, setAuto] = useState(true);
  const summary = useQuery({
    queryKey: ["monitoring", list.params],
    queryFn: ({ signal }) => monitoringApi.summary(list.params, signal),
    enabled: c.enabled,
    refetchInterval: c.enabled && auto ? 30000 : false,
  });
  return (
    <>
      <PageHeading
        title="Giám sát hệ thống"
        description="Theo dõi khối lượng truy vấn, hiệu suất LLM, kiểm tra SQL và sức khỏe của các kết nối warehouse. Các chỉ số kỹ thuật lấy trực tiếp từ API."
        actions={
          <Button
            onClick={() => void summary.refetch()}
            disabled={!c.enabled || summary.isFetching}
          >
            <RefreshCw size={17} />
            Làm mới
          </Button>
        }
      />
      <ApiAccess>
        <Filters
          key={JSON.stringify(list.params)}
          onApply={(v) => {
            const { fromDate, toDate, ...rest } = v;
            list.patch({ ...rest, ...utcDateRange(fromDate, toDate) });
          }}
          onReset={list.reset}
        >
          <RegistryFilterFields params={list.params} />
          <DateFilterFields params={list.params} />
        </Filters>
        <label className="inline-actions">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          Tự cập nhật mỗi 30 giây
        </label>
        <Resource resource={summary}>
          {(m) => (
            <>
              <p className="muted">
                {formatDate(m.from)} → {formatDate(m.to)} · Mẫu số tỷ lệ:{" "}
                {m.denominator}
              </p>
              <div className="stats-grid four">
                <Stat
                  label="Tổng số truy vấn"
                  value={m.queryVolume}
                  icon={<Activity />}
                />
                <Stat
                  label="Tỷ lệ thành công"
                  value={formatRate(m.successRate)}
                  icon={<Zap />}
                  tone="green"
                />
                <Stat
                  label="Phản hồi trung bình"
                  value={formatDuration(m.avgLatencyMs)}
                  icon={<Clock3 />}
                  tone="purple"
                />
                <Stat
                  label="P95 latency"
                  value={formatDuration(m.p95LatencyMs)}
                  icon={<Clock3 />}
                  tone="orange"
                />
              </div>
              <div className="stats-grid three">
                <Stat
                  label="Lỗi LLM"
                  value={m.llmErrorCount}
                  icon={<AlertTriangle />}
                  tone="pink"
                />
                <Stat
                  label="SQL validation từ chối"
                  value={m.sqlValidationRejectionCount}
                  icon={<ShieldAlert />}
                  tone="orange"
                />
                <Stat
                  label="Truy vấn timeout"
                  value={m.timeoutCount}
                  icon={<Clock3 />}
                  tone="purple"
                />
              </div>
              <div className="content-grid equal">
                <Card
                  title="Truy vấn theo engine"
                  icon={<Database size={22} />}
                >
                  <CountChart
                    items={m.queriesByEngine.map((e) => ({
                      name: engineLabel[e.engine],
                      count: e.count,
                    }))}
                  />
                </Card>
                <Card
                  title="Truy vấn theo dataset"
                  icon={<Activity size={22} />}
                >
                  <CountChart
                    items={m.queriesByDataset.map((d) => ({
                      name: d.name,
                      count: d.count,
                    }))}
                  />
                </Card>
                <Card title="Warehouse health">
                  <HealthList items={m.warehouseHealth} />
                </Card>
                <Card title="Ingestion health">
                  <HealthList items={m.ingestionHealth} />
                </Card>
              </div>
            </>
          )}
        </Resource>
      </ApiAccess>
    </>
  );
}
function CountChart({ items }: { items: { name: string; count: number }[] }) {
  if (!items.length)
    return (
      <Empty
        title="Chưa có thống kê"
        description="Dữ liệu sẽ xuất hiện sau khi hệ thống ghi nhận truy vấn."
      />
    );
  return (
    <>
      <div className="chart-area short">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={items}>
            <CartesianGrid vertical={false} stroke="#e8effa" />
            <XAxis dataKey="name" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar
              dataKey="count"
              name="Số truy vấn"
              fill="#1673ff"
              radius={[5, 5, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only">
        {items.map((i) => (
          <li key={i.name}>
            {i.name}: {i.count}
          </li>
        ))}
      </ul>
    </>
  );
}
function HealthList({
  items,
}: {
  items: { id: string; name: string; status: string }[];
}) {
  return items.length ? (
    <div className="health-list">
      {items.map((i) => (
        <div key={i.id}>
          <span>
            <Database size={21} />
            {i.name}
          </span>
          <Badge status={i.status} />
        </div>
      ))}
    </div>
  ) : (
    <Empty title="Chưa có kết nối được ghi nhận" />
  );
}
