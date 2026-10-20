import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  BrainCircuit,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useAuth } from "../app/auth";
import { useWarehouse } from "../app/providers";
import { knowledgeApi } from "../api/workbenchApi";
import { historyApi } from "../api/historyApi";
import type { QuerySummary } from "../api/schema";
import { formatDate } from "../lib/format";
import { PageHeading } from "../components/Shell";
import {
  ApiAccess,
  AsyncSelect,
  Badge,
  Button,
  Card,
  ContextGate,
  Empty,
  ErrorState,
  Field,
  Modal,
  Notice,
  Resource,
  SqlBlock,
  Stat,
} from "../components/ui";

export function KnowledgePage() {
  const context = useWarehouse();
  return (
    <ApiAccess>
      <PageHeading
        title="Tri thức AI"
        description="Lập chỉ mục metadata và ngữ nghĩa của dataset bằng embeddings local. Tra cứu phần ngữ cảnh được dùng khi sinh SQL và quản lý các ví dụ đã duyệt."
      />
      <ContextGate>
        <KnowledgeWorkbench key={context.datasetId} />
      </ContextGate>
    </ApiAccess>
  );
}

function KnowledgeWorkbench() {
  const context = useWarehouse();
  const auth = useAuth();
  const client = useQueryClient();
  const [question, setQuestion] = useState("");
  const [limit, setLimit] = useState(5);
  const [selected, setSelected] = useState<QuerySummary>();
  const [confirmReset, setConfirmReset] = useState(false);
  const [deleting, setDeleting] = useState("");
  const status = useQuery({
    queryKey: ["knowledge-status", context.datasetId],
    queryFn: ({ signal }) => knowledgeApi.status(context.datasetId, signal),
    refetchInterval: (q) =>
      q.state.data?.status === "INDEXING" ? 2000 : false,
  });
  const examples = useQuery({
    queryKey: ["knowledge-examples", context.datasetId],
    queryFn: ({ signal }) => knowledgeApi.examples(context.datasetId, signal),
    enabled: status.data?.status === "READY",
  });
  const refresh = async () => {
    await client.invalidateQueries({
      queryKey: ["knowledge-status", context.datasetId],
    });
    await client.invalidateQueries({
      queryKey: ["knowledge-examples", context.datasetId],
    });
  };
  const index = useMutation({
    mutationFn: () => knowledgeApi.index(context.datasetId),
    onSuccess: async () => {
      search.reset();
      await refresh();
    },
  });
  const reset = useMutation({
    mutationFn: () => knowledgeApi.reset(context.datasetId),
    onSuccess: async () => {
      setConfirmReset(false);
      search.reset();
      client.removeQueries({
        queryKey: ["knowledge-examples", context.datasetId],
      });
      await refresh();
    },
  });
  const search = useMutation({
    mutationFn: () =>
      knowledgeApi.search(context.datasetId, { question, limit }),
  });
  const promote = useMutation({
    mutationFn: () =>
      knowledgeApi.promote(context.datasetId, selected!.queryId),
    onSuccess: async () => {
      setSelected(undefined);
      await refresh();
    },
  });
  const forget = useMutation({
    mutationFn: (entryId: string) =>
      knowledgeApi.forget(context.datasetId, entryId),
    onSuccess: async () => {
      setDeleting("");
      search.reset();
      await refresh();
    },
  });
  const busy =
    index.isPending ||
    reset.isPending ||
    promote.isPending ||
    forget.isPending ||
    search.isPending;
  return (
    <div className="workbench-stack">
      <Resource resource={status}>
        {(state) => (
          <>
            <div className="stats-grid knowledge-stats">
              <Stat
                label="Trạng thái chỉ mục"
                value={<Badge status={state.status} />}
                icon={<BrainCircuit size={23} />}
                note={
                  state.indexedAt
                    ? formatDate(state.indexedAt)
                    : "Chưa có lần lập chỉ mục"
                }
              />
              <Stat
                label="Mục metadata / nghiệp vụ"
                value={state.schemaItems}
                note={`Schema ${state.schemaVersion}`}
              />
              <Stat
                label="Ví dụ truy vấn"
                value={state.exampleCount}
                icon={<BookOpen size={23} />}
                note={`Ngữ nghĩa ${state.semanticVersion}`}
              />
            </div>
            <Card
              title="Chỉ mục của dataset"
              icon={<BrainCircuit size={20} />}
              actions={
                auth.can("ADMIN") ? (
                  <div className="inline-actions">
                    <Button
                      disabled={busy}
                      onClick={() => setConfirmReset(true)}
                    >
                      <Trash2 size={16} />
                      Xóa chỉ mục
                    </Button>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => index.mutate()}
                    >
                      <RefreshCw
                        size={16}
                        className={index.isPending ? "spin" : ""}
                      />
                      {index.isPending
                        ? "Đang lập chỉ mục…"
                        : "Lập lại chỉ mục"}
                    </Button>
                  </div>
                ) : undefined
              }
            >
              <div className="metadata-strip">
                <div>
                  <span>Embedding model</span>
                  <strong>{state.embeddingModel}</strong>
                </div>
                <div>
                  <span>Dataset</span>
                  <strong>{context.dataset!.name}</strong>
                </div>
                <div>
                  <span>Phạm vi</span>
                  <strong>{context.warehouse!.name}</strong>
                </div>
              </div>
              {state.status === "EMPTY" && (
                <Notice>
                  Dataset chưa có chỉ mục tri thức. ADMIN có thể lập chỉ mục từ
                  metadata và định nghĩa ngữ nghĩa đang hoạt động.
                </Notice>
              )}
              {state.status === "STALE" && (
                <Notice tone="warning">
                  Schema hoặc định nghĩa đã thay đổi. Lập lại chỉ mục trước khi
                  tra cứu để tránh dùng ngữ cảnh cũ.
                </Notice>
              )}
              {state.error && <Notice tone="error">{state.error}</Notice>}
              <p className="muted">
                Chỉ lưu metadata và cặp câu hỏi/SQL đã duyệt. Dòng dữ liệu kết
                quả và thông tin đăng nhập không được đưa vào bộ nhớ tri thức.
              </p>
            </Card>
            <Card title="Tra cứu ngữ cảnh" icon={<Search size={20} />}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  search.mutate();
                }}
                className="workbench-stack"
              >
                <div className="workbench-fields search-workbench">
                  <Field label="Câu hỏi cần phân tích">
                    <input
                      value={question}
                      maxLength={1000}
                      required
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Nhập câu hỏi để tìm metadata và ví dụ liên quan…"
                    />
                  </Field>
                  <Field label="Số mục liên quan">
                    <select
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                    >
                      {[3, 5, 10, 20].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={
                      state.status !== "READY" ||
                      busy ||
                      search.isPending ||
                      !question.trim()
                    }
                  >
                    <Search size={17} />
                    {search.isPending ? "Đang tra cứu…" : "Tra cứu"}
                  </Button>
                </div>
              </form>
              {search.error && <ErrorState error={search.error} />}{" "}
              {search.data && (
                <div className="workbench-stack">
                  <p className="muted">
                    Kết quả cho “{search.data.question}” ·{" "}
                    {search.data.embeddingModel}. Khoảng cách nhỏ hơn thể hiện
                    mức liên quan gần hơn.
                  </p>
                  {search.data.hits.length ? (
                    <div className="knowledge-hits">
                      {search.data.hits.map((hit, index) => (
                        <article
                          className="definition-card"
                          key={`${hit.itemType}:${hit.modelName}:${hit.name}:${index}`}
                        >
                          <header className="definition-header">
                            <h3>{hit.name}</h3>
                            <span className="pill">{hit.itemType}</span>
                          </header>
                          <small>
                            {hit.modelName || "Ngữ nghĩa dataset"} · Khoảng cách{" "}
                            {hit.distance.toFixed(4)}
                          </small>
                          <p className="knowledge-text">{hit.text}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Không tìm thấy ngữ cảnh phù hợp"
                      description="Thử diễn đạt câu hỏi khác hoặc kiểm tra định nghĩa nghiệp vụ."
                    />
                  )}
                  {search.data.examples.map((example) => (
                    <details className="definition-card" key={example.entryId}>
                      <summary>
                        {example.question} ·{" "}
                        {example.source === "approved-query"
                          ? "Truy vấn đã duyệt"
                          : "Cấu hình ngữ nghĩa"}
                      </summary>
                      <SqlBlock sql={example.sql} label={example.sqlDialect} />
                    </details>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </Resource>
      {index.error && <ErrorState error={index.error} />}{" "}
      {reset.error && <ErrorState error={reset.error} />}
      <Card title="Ví dụ truy vấn đã duyệt" icon={<BookOpen size={20} />}>
        <p className="muted">
          Ví dụ trong cấu hình ngữ nghĩa được đồng bộ khi lập chỉ mục. Có thể bổ
          sung truy vấn thành công của chính dataset này sau khi Java kiểm tra
          lại SQL.
        </p>
        {auth.can("ADMIN") && (
          <div className="workbench-fields search-workbench">
            <AsyncSelect
              label="Truy vấn thành công"
              cacheKey={context.datasetId}
              value={selected}
              onSelect={setSelected}
              load={(params, signal) =>
                historyApi.list(
                  {
                    ...params,
                    datasetId: context.datasetId,
                    warehouseId: context.warehouseId,
                    status: "SUCCESS",
                  },
                  signal,
                )
              }
              getId={(query) => query.queryId}
              getLabel={(query) => `${query.question} · ${query.queryId}`}
              disabled={busy || status.data?.status !== "READY"}
            />
            <Button
              disabled={!selected || busy || status.data?.status !== "READY"}
              onClick={() => promote.mutate()}
            >
              <Plus size={17} />
              {promote.isPending ? "Đang duyệt…" : "Duyệt vào tri thức"}
            </Button>
          </div>
        )}
        {promote.error && <ErrorState error={promote.error} />}{" "}
        {forget.error && <ErrorState error={forget.error} />}
        {status.data?.status === "READY" ? (
          <Resource resource={examples}>
            {(data) =>
              data.items.length ? (
                <div className="workbench-stack">
                  {data.items.map((example) => (
                    <details className="definition-card" key={example.entryId}>
                      <summary>{example.question}</summary>
                      <div className="workbench-footer">
                        <span className="pill">{example.sqlDialect}</span>
                        <span className="muted">
                          {example.source === "approved-query"
                            ? "Truy vấn đã duyệt"
                            : "Cấu hình ngữ nghĩa"}
                        </span>
                        {auth.can("ADMIN") &&
                          example.source === "approved-query" && (
                            <Button
                              variant="danger"
                              disabled={busy}
                              onClick={() => setDeleting(example.entryId)}
                            >
                              <Trash2 size={16} />
                              Bỏ ví dụ
                            </Button>
                          )}
                      </div>
                      <SqlBlock sql={example.sql} />
                      {example.source === "semantic-config" && (
                        <small>
                          Chỉnh ví dụ này trong Ngữ nghĩa nghiệp vụ, sau đó lập
                          lại chỉ mục.
                        </small>
                      )}
                    </details>
                  ))}
                </div>
              ) : (
                <Empty
                  title="Chưa có ví dụ"
                  description="Thêm ví dụ trong cấu hình ngữ nghĩa hoặc duyệt một truy vấn thành công."
                />
              )
            }
          </Resource>
        ) : (
          <Empty
            title="Cần chỉ mục đang hoạt động"
            description="Lập lại chỉ mục để quản lý các ví dụ đúng phiên bản metadata."
          />
        )}
      </Card>
      {confirmReset && (
        <Modal
          title="Xóa chỉ mục tri thức?"
          onClose={() => !reset.isPending && setConfirmReset(false)}
        >
          <p>
            Metadata được lập chỉ mục và các truy vấn đã duyệt riêng trong bộ
            nhớ sẽ bị xóa. Cấu hình ngữ nghĩa và dữ liệu warehouse vẫn được giữ.
            Bạn có thể lập lại chỉ mục sau đó.
          </p>
          <div className="workbench-footer">
            <Button
              disabled={reset.isPending}
              onClick={() => setConfirmReset(false)}
            >
              Hủy
            </Button>
            <Button
              variant="danger"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              Xóa chỉ mục
            </Button>
          </div>
          {reset.error && <ErrorState error={reset.error} />}
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Bỏ ví dụ đã duyệt?"
          onClose={() => !forget.isPending && setDeleting("")}
        >
          <p>
            Ví dụ này sẽ không còn được truy hồi khi sinh SQL. Truy vấn gốc vẫn
            có trong lịch sử.
          </p>
          <div className="workbench-footer">
            <Button disabled={forget.isPending} onClick={() => setDeleting("")}>
              Hủy
            </Button>
            <Button
              variant="danger"
              disabled={forget.isPending}
              onClick={() => forget.mutate(deleting)}
            >
              Bỏ ví dụ
            </Button>
          </div>
          {forget.error && <ErrorState error={forget.error} />}
        </Modal>
      )}
    </div>
  );
}
