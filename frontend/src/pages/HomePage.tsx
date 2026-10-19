import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Activity,
  Database,
  Layers3,
  MessageCircle,
  Send,
  Clock3,
  BarChart3,
  CloudUpload,
  Lightbulb,
} from "lucide-react";
import { useWarehouse } from "../app/providers";
import { platformApi } from "../api/platformApi";
import { catalogApi } from "../api/catalogApi";
import { warehouseApi } from "../api/warehouseApi";
import {
  engineLabel,
  formatDate,
  formatDuration,
  formatRate,
} from "../lib/format";
import { Artwork } from "../components/Artwork";
import { PageHeading } from "../components/Shell";
import {
  Card,
  Stat,
  Resource,
  Badge,
  Button,
  Empty,
  ApiAccess,
} from "../components/ui";
export function HomePage() {
  const c = useWarehouse(),
    navigate = useNavigate(),
    [question, setQuestion] = useState("");
  const summary = useQuery({
    queryKey: ["platform"],
    queryFn: ({ signal }) => platformApi.summary(signal),
    enabled: c.enabled,
  });
  const warehouses = useQuery({
    queryKey: ["home-warehouses"],
    queryFn: ({ signal }) =>
      warehouseApi.list({ page: 1, pageSize: 10 }, signal),
    enabled: c.enabled,
  });
  const examples = useQuery({
    queryKey: ["examples", c.datasetId, "home"],
    queryFn: ({ signal }) =>
      catalogApi.examples(c.datasetId, { page: 1, pageSize: 10 }, signal),
    enabled: c.enabled && c.dataset?.status === "ACTIVE",
  });
  return (
    <>
      <PageHeading
        title={
          <>
            Trợ lý phân tích dữ liệu bằng <em>ngôn ngữ tự nhiên</em>
          </>
        }
        description="Đặt câu hỏi bằng tiếng Việt hoặc tiếng Anh, khám phá dữ liệu từ nhiều warehouse và lĩnh vực. Nhận kết quả cùng biểu đồ, bảng và giải thích chi tiết."
        art={<Artwork />}
      />
      <form
        className="home-query card"
        onSubmit={(e) => {
          e.preventDefault();
          navigate("/query", { state: { question } });
        }}
      >
        <span className="icon-tile small">
          <MessageCircle size={23} />
        </span>
        <input
          aria-label="Câu hỏi nhanh"
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Bạn muốn tìm hiểu điều gì từ dữ liệu của mình?"
        />
        <Button type="submit" variant="primary">
          <Send size={18} />
          Bắt đầu truy vấn
        </Button>
      </form>
      {examples.data?.items.length ? (
        <div className="suggestions">
          <strong>Thử ngay:</strong>
          {examples.data.items.slice(0, 4).map((x, i) => (
            <Link
              key={i}
              to="/query"
              state={{ question: x.question }}
              className="chip"
            >
              {x.question}
              <ArrowRight size={15} />
            </Link>
          ))}
        </div>
      ) : null}
      <ApiAccess>
        <Resource resource={summary}>
          {(data) => (
            <>
              <div className="stats-grid four">
                <Stat
                  icon={<Database />}
                  label="Warehouses"
                  value={data.warehouseCount}
                  note={`${data.healthyWarehouseCount} kết nối hoạt động`}
                />
                <Stat
                  icon={<Layers3 />}
                  label="Datasets"
                  value={data.datasetCount}
                  note={`${data.datasetCount} dataset đã đăng ký`}
                  tone="purple"
                />
                <Stat
                  icon={<Activity />}
                  label="Truy vấn thành công"
                  value={formatRate(data.querySuccessRate)}
                  note="Theo thống kê hệ thống"
                  tone="green"
                />
                <Stat
                  icon={<Activity />}
                  label="Tình trạng hệ thống"
                  value={<Badge status={data.systemHealth} />}
                  note="Cập nhật từ Java API"
                />
              </div>
              <Card
                title="Kho dữ liệu của bạn"
                icon={<Database size={23} />}
                actions={
                  <Link className="text-link" to="/warehouses">
                    Xem tất cả
                    <ArrowRight size={16} />
                  </Link>
                }
              >
                <Resource resource={warehouses}>
                  {(list) =>
                    list.items.length ? (
                      <div className="warehouse-cards">
                        {list.items.map((w) => (
                          <article
                            className="warehouse-card"
                            key={w.warehouseId}
                          >
                            <div className="inline-actions">
                              <span className="icon-tile">
                                <Database size={26} />
                              </span>
                              <div>
                                <h3>{w.name}</h3>
                                <Badge status={w.status} />
                              </div>
                            </div>
                            <p>{engineLabel[w.engine]}</p>
                            <div className="capabilities">
                              <span>Metadata discovery</span>
                              <strong>
                                {w.capabilities.metadataDiscovery
                                  ? "Có"
                                  : "Không"}
                              </strong>
                            </div>
                            <Button
                              onClick={() => {
                                c.selectWarehouse(w);
                                navigate("/query");
                              }}
                            >
                              Khám phá dữ liệu
                              <ArrowRight size={16} />
                            </Button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="Chưa có warehouse"
                        description="Đăng ký kết nối tới warehouse đã tồn tại để bắt đầu."
                        action={
                          <Link to="/warehouses" className="button primary">
                            Thêm warehouse
                          </Link>
                        }
                      />
                    )
                  }
                </Resource>
              </Card>
              <div className="content-grid">
                <Card
                  title="Truy vấn gần đây"
                  icon={<Clock3 size={22} />}
                  actions={
                    <Link to="/history" className="text-link">
                      Xem lịch sử
                      <ArrowRight size={16} />
                    </Link>
                  }
                >
                  {data.recentQueries.length ? (
                    <div className="activity-list">
                      {data.recentQueries.map((q) => (
                        <Link
                          key={q.queryId}
                          to={`/query/${encodeURIComponent(q.queryId)}/overview`}
                        >
                          <span className="icon-tile small">
                            <MessageCircle size={19} />
                          </span>
                          <div>
                            <strong>{q.question}</strong>
                            <small>
                              {engineLabel[q.engine]} ·{" "}
                              {formatDate(q.createdAt)} ·{" "}
                              {formatDuration(q.latencyMs)}
                            </small>
                          </div>
                          <Badge status={q.status} />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Chưa có truy vấn"
                      description="Câu hỏi đã chạy sẽ được lưu cùng kết quả và thông tin thực thi."
                    />
                  )}
                </Card>
                <Card title="Hoạt động hệ thống" icon={<Activity size={22} />}>
                  <div className="activity-list">
                    {data.recentEvaluationRuns.map((run) => (
                      <Link
                        to={`/evaluation?runId=${encodeURIComponent(run.runId)}`}
                        key={run.runId}
                      >
                        <BarChart3 size={22} />
                        <div>
                          <strong>Đánh giá {run.runId}</strong>
                          <small>{formatDate(run.createdAt)}</small>
                        </div>
                        <Badge status={run.status} />
                      </Link>
                    ))}
                    {data.recentIngestionRuns.map((run) => (
                      <Link
                        to={`/ingestion/${encodeURIComponent(run.runId)}`}
                        key={run.runId}
                      >
                        <CloudUpload size={22} />
                        <div>
                          <strong>Nạp dữ liệu {run.runId}</strong>
                          <small>{formatDate(run.startedAt)}</small>
                        </div>
                        <Badge status={run.status} />
                      </Link>
                    ))}
                    {!data.recentEvaluationRuns.length &&
                      !data.recentIngestionRuns.length && (
                        <Empty
                          title="Chưa có hoạt động"
                          description="Các lần đánh giá và nạp dữ liệu sẽ xuất hiện tại đây."
                        />
                      )}
                  </div>
                </Card>
              </div>
            </>
          )}
        </Resource>
      </ApiAccess>
      <Card
        title="Khám phá dữ liệu đúng ngữ cảnh"
        icon={<Lightbulb size={22} />}
      >
        <p className="muted">
          Chọn warehouse, chọn dataset và xem Data Catalog để hiểu metrics,
          dimensions và các mối quan hệ được phép truy vấn.
        </p>
        <Link to="/catalog" className="text-link">
          Mở Data Catalog
          <ArrowRight size={16} />
        </Link>
      </Card>
    </>
  );
}
