import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Calendar,
  Database,
  HelpCircle,
  Lightbulb,
  ListChecks,
  MessageCircle,
  Send,
  ShieldCheck,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "../app/auth";
import { useWarehouse } from "../app/providers";
import { catalogApi } from "../api/catalogApi";
import { queryApi } from "../api/queryApi";
import { settingsApi } from "../api/settingsApi";
import { QueryRequestSchema, type Mode } from "../api/schema";
import { engineLabel, formatDate } from "../lib/format";
import { Artwork } from "../components/Artwork";
import { PageHeading } from "../components/Shell";
import {
  Card,
  Button,
  Badge,
  DetailList,
  Empty,
  ErrorState,
  Field,
  Notice,
  Pagination,
  Resource,
} from "../components/ui";
export function QueryPage() {
  const c = useWarehouse(),
    auth = useAuth(),
    navigate = useNavigate(),
    location = useLocation();
  const [question, setQuestion] = useState(() =>
      typeof location.state?.question === "string"
        ? location.state.question
        : "",
    ),
    [mode, setMode] = useState<Mode>("AUTO"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [category, setCategory] = useState(""),
    [validation, setValidation] = useState(""),
    [guide, setGuide] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null),
    controller = useRef<AbortController | null>(null),
    contextKey = `${c.warehouseId}/${c.datasetId}`,
    lastContext = useRef(contextKey);
  const catalog = useQuery({
    queryKey: ["catalog", c.datasetId],
    queryFn: ({ signal }) => catalogApi.summary(c.datasetId, signal),
    enabled: c.enabled && c.dataset?.status === "ACTIVE",
  });
  const examples = useQuery({
    queryKey: ["examples", c.datasetId, search, category, page],
    queryFn: ({ signal }) =>
      catalogApi.examples(
        c.datasetId,
        { page, pageSize: 10, search, category },
        signal,
      ),
    enabled: c.enabled && c.dataset?.status === "ACTIVE",
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: ({ signal }) => settingsApi.get(signal),
    enabled: c.enabled,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const body = QueryRequestSchema.parse({
        warehouseId: c.warehouseId,
        datasetId: c.datasetId,
        question,
        mode,
      });
      controller.current = new AbortController();
      return queryApi.run(body, controller.current.signal);
    },
    onSuccess: (q) => {
      if (lastContext.current === `${q.warehouseId}/${q.datasetId}`)
        navigate(`/query/${encodeURIComponent(q.queryId)}/overview`);
    },
  });
  useEffect(() => {
    if (lastContext.current !== contextKey) {
      controller.current?.abort();
      mutation.reset();
      setQuestion("");
      setPage(1);
      setSearch("");
      setCategory("");
      setValidation("");
      lastContext.current = contextKey;
    }
  }, [contextKey]);
  useEffect(() => () => controller.current?.abort(), []);
  const submit = () => {
    const valid = QueryRequestSchema.safeParse({
      warehouseId: c.warehouseId,
      datasetId: c.datasetId,
      question,
      mode,
    });
    if (!valid.success) {
      setValidation(
        valid.error.issues[0]?.message || "Chọn warehouse và dataset hợp lệ.",
      );
      return;
    }
    setValidation("");
    mutation.mutate();
  };
  const allowed =
    c.enabled &&
    c.warehouse?.status === "ACTIVE" &&
    c.dataset?.status === "ACTIVE" &&
    auth.can("ANALYST");
  return (
    <>
      <PageHeading
        title={
          <>
            Truy vấn dữ liệu bằng <em>ngôn ngữ tự nhiên</em>
          </>
        }
        description="Đặt câu hỏi bằng tiếng Việt hoặc tiếng Anh để khám phá dữ liệu trong warehouse. Hệ thống phân tích câu hỏi, sinh SQL, thực thi và hiển thị kết quả cùng giải thích chi tiết."
        art={<Artwork />}
      />
      {c.error && <ErrorState error={c.error} retry={c.reload} />}
      <div className="workspace-grid">
        <div className="stack">
          <Card
            title="Nhập câu hỏi của bạn"
            icon={<MessageCircle size={26} />}
            actions={
              <Button variant="ghost" onClick={() => setGuide(!guide)}>
                <HelpCircle size={16} />
                Hướng dẫn viết câu hỏi
              </Button>
            }
          >
            {guide && (
              <Notice>
                Nêu rõ chỉ số, chiều phân tích, khoảng thời gian và bộ lọc. Xem
                Catalog để biết dữ liệu có sẵn. Không nhập thông tin bí mật vào
                câu hỏi.
              </Notice>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!mutation.isPending && allowed) submit();
              }}
            >
              <div className="question-input">
                <textarea
                  ref={input}
                  aria-label="Câu hỏi phân tích"
                  value={question}
                  maxLength={2000}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={
                    "Bạn muốn tìm hiểu điều gì từ dataset đã chọn?\nNhập câu hỏi bằng tiếng Việt hoặc tiếng Anh…"
                  }
                  disabled={mutation.isPending}
                  onKeyDown={(e) => {
                    if (
                      (e.metaKey || e.ctrlKey) &&
                      e.key === "Enter" &&
                      allowed &&
                      !mutation.isPending
                    ) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <span
                  className={
                    Array.from(question).length > 1000 ? "text-danger" : ""
                  }
                >
                  {Array.from(question).length}/1000
                </span>
              </div>
              <div className="query-actions">
                <Button
                  onClick={() =>
                    document
                      .getElementById("sample-questions")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  <Lightbulb size={17} />
                  Câu hỏi mẫu
                </Button>
                <Link to="/catalog" className="button secondary">
                  <BookOpen size={17} />
                  Data Catalog
                </Link>
                <Button
                  disabled={mutation.isPending || !question}
                  onClick={() => {
                    setQuestion("");
                    setValidation("");
                    input.current?.focus();
                  }}
                >
                  <Trash2 size={17} />
                  Xóa
                </Button>
                <div className="mode-control">
                  <span>Chế độ xử lý</span>
                  <select
                    aria-label="Chế độ xử lý"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as Mode)}
                    disabled={mutation.isPending}
                  >
                    {(settings.data?.availableModes || ["AUTO"]).map((m) => (
                      <option key={m} value={m}>
                        {m === "AUTO"
                          ? "Tự động (Khuyến nghị)"
                          : m === "API"
                            ? "Provider API"
                            : "Deterministic (Offline)"}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!allowed || mutation.isPending}
                >
                  {mutation.isPending ? (
                    <BrainCircuit size={19} className="spin" />
                  ) : (
                    <Send size={19} />
                  )}{" "}
                  {mutation.isPending ? "Đang xử lý…" : "Gửi"}
                </Button>
              </div>
              {validation && <Notice tone="error">{validation}</Notice>}
              {mutation.error && <ErrorState error={mutation.error} />}
            </form>
            {!allowed && (
              <Notice tone="warning">
                {!c.dataset
                  ? "Chọn warehouse và dataset ở thanh phía trên để bắt đầu."
                  : c.warehouse?.status !== "ACTIVE"
                    ? `Warehouse ${c.warehouse?.status || "chưa khả dụng"}.`
                    : c.dataset.status !== "ACTIVE"
                      ? `Dataset ${c.dataset.status}. Kiểm tra metadata trước khi truy vấn.`
                      : "Bạn cần đăng nhập với quyền ANALYST hoặc ADMIN để chạy truy vấn."}
              </Notice>
            )}
            {settings.error && (
              <ErrorState
                error={settings.error}
                retry={() => void settings.refetch()}
              />
            )}
            <p className="keyboard-hint">
              <ShieldCheck size={14} />
              Chỉ truy vấn dữ liệu trong phạm vi được cấp quyền.
              <span>⌘ / Ctrl + Enter để gửi</span>
            </p>
          </Card>
          {examples.data?.items.length ? (
            <div className="suggestions">
              <strong>Thử ngay:</strong>
              {examples.data.items.slice(0, 3).map((ex, i) => (
                <button
                  className="chip"
                  key={i}
                  onClick={() => {
                    setQuestion(ex.question);
                    input.current?.focus();
                  }}
                >
                  {ex.question}
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          ) : null}
          <div id="sample-questions">
            <Card
              title={`Câu hỏi mẫu${c.dataset ? " cho " + c.dataset.name : ""}`}
              icon={<Lightbulb size={24} />}
              actions={
                <input
                  className="sample-search"
                  aria-label="Tìm câu hỏi mẫu"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Tìm câu hỏi mẫu…"
                />
              }
            >
              <div className="category-tabs">
                <button
                  className={!category ? "active" : ""}
                  onClick={() => {
                    setCategory("");
                    setPage(1);
                  }}
                >
                  Tất cả
                </button>
                {catalog.data?.categories.map((cat) => (
                  <button
                    key={cat.name}
                    className={category === cat.name ? "active" : ""}
                    onClick={() => {
                      setCategory(cat.name);
                      setPage(1);
                    }}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
              {c.dataset?.status === "ACTIVE" && c.enabled ? (
                <Resource resource={examples}>
                  {(list) => (
                    <>
                      {list.items.length ? (
                        <div className="question-cards">
                          {list.items.map((ex, i) => (
                            <button
                              className="question-card"
                              key={`${i}-${ex.question}`}
                              onClick={() => {
                                setQuestion(ex.question);
                                input.current?.focus();
                              }}
                            >
                              <span
                                className={`icon-tile ${["blue", "purple", "green", "orange"][i % 4]}`}
                              >
                                <TrendingUp size={22} />
                              </span>
                              <span>
                                <strong>
                                  {ex.category ||
                                    ex.selectedMetrics.join(", ") ||
                                    "Câu hỏi gợi ý"}
                                </strong>
                                <small>{ex.question}</small>
                              </span>
                              <Chevron />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <Empty
                          title="Chưa có câu hỏi mẫu"
                          description="Câu hỏi mẫu được lấy từ semantic model của dataset."
                        />
                      )}
                      <Pagination {...list} onChange={(p) => setPage(p)} />
                    </>
                  )}
                </Resource>
              ) : (
                <Empty
                  title="Câu hỏi mẫu theo dataset"
                  description="Chọn một dataset hoạt động để tải gợi ý từ semantic model."
                />
              )}
            </Card>
          </div>
        </div>
        <aside className="stack">
          <Card title="Thông tin dataset" icon={<Database size={23} />}>
            <div className="dataset-title">
              <span className="icon-tile large">
                <Database size={33} />
              </span>
              <div>
                <h3>{c.dataset?.name || "Chưa chọn dataset"}</h3>
                {c.dataset && <Badge status={c.dataset.status} />}
              </div>
            </div>
            <p className="muted">
              {c.dataset?.description ||
                "Thông tin, metrics và dimensions hiển thị theo dataset bạn chọn."}
            </p>
            {catalog.data && (
              <div className="mini-stats">
                <div>
                  <strong>{catalog.data.tableCount}</strong>
                  <small>bảng</small>
                </div>
                <div>
                  <strong>{catalog.data.metricCount}</strong>
                  <small>metrics</small>
                </div>
                <div>
                  <strong>{catalog.data.dimensionCount}</strong>
                  <small>dimensions</small>
                </div>
              </div>
            )}
            {catalog.error && (
              <ErrorState
                error={catalog.error}
                retry={() => void catalog.refetch()}
              />
            )}
            <DetailList
              items={[
                [
                  "Warehouse",
                  c.warehouse
                    ? `${c.warehouse.name} (${engineLabel[c.warehouse.engine]})`
                    : "—",
                ],
                ["Semantic version", c.dataset?.semanticVersion],
                ["Schema version", c.dataset?.schemaVersion],
                ["Cập nhật gần nhất", formatDate(c.dataset?.updatedAt)],
              ]}
            />
            <Link to="/catalog" className="text-link centered">
              Xem chi tiết dataset
              <ArrowRight size={17} />
            </Link>
          </Card>
          <Card
            title="Hướng dẫn và mẹo truy vấn"
            icon={<HelpCircle size={23} />}
          >
            <div className="tips">
              {[
                {
                  icon: MessageCircle,
                  title: "Sử dụng ngôn ngữ tự nhiên",
                  text: "Đặt câu hỏi bằng tiếng Việt hoặc tiếng Anh, không cần viết SQL.",
                },
                {
                  icon: ListChecks,
                  title: "Càng chi tiết càng tốt",
                  text: "Nêu rõ thời gian, nhóm dữ liệu và bộ lọc để kết quả chính xác.",
                },
                {
                  icon: Calendar,
                  title: "Đặt câu hỏi trong ngữ cảnh",
                  text: "Sử dụng metrics và dimensions đã định nghĩa trong Data Catalog.",
                },
                {
                  icon: ShieldCheck,
                  title: "Truy vấn an toàn",
                  text: "Java kiểm tra và thực thi truy vấn bằng kết nối chỉ đọc.",
                },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title}>
                  <span className="icon-tile">
                    <Icon size={22} />
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <p>{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
function Chevron() {
  return <ArrowRight size={16} />;
}
