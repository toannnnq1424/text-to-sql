import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  Database,
  GitBranch,
  KeyRound,
  Layers3,
  Lightbulb,
  Table2,
  TrendingUp,
} from "lucide-react";
import { useWarehouse } from "../app/providers";
import { catalogApi } from "../api/catalogApi";
import type { Metric, Dimension, TableMetadata } from "../api/schema";
import { PageHeading } from "../components/Shell";
import { Artwork } from "../components/Artwork";
import {
  ApiAccess,
  Card,
  ContextGate,
  DataGrid,
  DetailList,
  Empty,
  Field,
  Filters,
  Pagination,
  Resource,
  SqlBlock,
  Stat,
  Tabs,
  useListState,
} from "../components/ui";
const sections = [
  ["overview", "Tổng quan", BookOpen],
  ["tables", "Bảng", Table2],
  ["metrics", "Metrics", TrendingUp],
  ["dimensions", "Dimensions", Layers3],
  ["relationships", "Mối quan hệ", GitBranch],
  ["examples", "Ví dụ câu hỏi", Lightbulb],
] as const;
export function CatalogPage() {
  const c = useWarehouse();
  return (
    <>
      <PageHeading
        title="Data Catalog"
        description="Khám phá các bảng, cột, mối quan hệ và ngữ nghĩa dữ liệu trong warehouse. Tìm hiểu cấu trúc dữ liệu để đặt câu hỏi chính xác hơn."
        art={<Artwork kind="database" />}
      />
      <ApiAccess>
        <ContextGate>
          <CatalogContent key={c.datasetId} />
        </ContextGate>
      </ApiAccess>
    </>
  );
}
function CatalogContent() {
  const c = useWarehouse(),
    nav = useNavigate(),
    { section = "overview", itemId } = useParams(),
    list = useListState("name");
  const summary = useQuery({
    queryKey: ["catalog", c.datasetId],
    queryFn: ({ signal }) => catalogApi.summary(c.datasetId, signal),
  });
  const selected = sections.some((s) => s[0] === section)
    ? section
    : "overview";
  const categories =
    selected === "tables"
      ? summary.data?.tableCategories
      : selected === "metrics"
        ? summary.data?.metricCategories
        : [];
  return (
    <>
      {selected === "overview" && (
        <Tabs
          items={sections.map(([s, label, Icon]) => ({
            to: `/catalog/${s}`,
            label,
            icon: <Icon size={19} />,
            active: s === selected,
          }))}
        />
      )}
      {selected === "overview" ? (
        <Resource resource={summary}>
          {(data) => (
            <>
              <div className="stats-grid four">
                <Stat
                  label="Bảng dữ liệu"
                  value={data.tableCount}
                  icon={<Database />}
                />
                <Stat
                  label="Metrics"
                  value={data.metricCount}
                  icon={<TrendingUp />}
                  tone="purple"
                />
                <Stat
                  label="Dimensions"
                  value={data.dimensionCount}
                  icon={<Layers3 />}
                  tone="green"
                />
                <Stat
                  label="Mối quan hệ"
                  value={data.relationshipCount}
                  icon={<GitBranch />}
                />
              </div>
              <Card title={c.dataset?.name || "Dataset"}>
                <p>{c.dataset?.description}</p>
                <DetailList
                  items={[
                    ["Semantic version", data.semanticVersion],
                    ["Schema version", data.schemaVersion],
                    ["Ví dụ câu hỏi", data.exampleCount],
                    ["Dataset ID", data.datasetId],
                  ]}
                />
                <div className="chips">
                  {data.tableCategories.map((x) => (
                    <Link
                      className="chip"
                      key={x.name}
                      to={`/catalog/tables?category=${encodeURIComponent(x.name)}`}
                    >
                      {x.name}
                      <strong>{x.count}</strong>
                    </Link>
                  ))}
                </div>
              </Card>
            </>
          )}
        </Resource>
      ) : (
        <>
          <Filters
            key={`${selected}-${JSON.stringify(list.params)}`}
            onApply={list.patch}
            onReset={list.reset}
          >
            <Field label="Tìm kiếm">
              <input
                name="search"
                defaultValue={String(list.params.search || "")}
                placeholder="Tìm theo tên, mô tả, cột…"
              />
            </Field>
            {["tables", "metrics"].includes(selected) && (
              <Field label="Danh mục">
                <select
                  name="category"
                  defaultValue={String(list.params.category || "")}
                >
                  <option value="">Tất cả</option>
                  {categories?.map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </select>
              </Field>
            )}
            {selected === "tables" && (
              <>
                <Field label="Schema / catalog">
                  <input
                    name="schema"
                    defaultValue={String(list.params.schema || "")}
                    placeholder="Tất cả schemas"
                  />
                </Field>
                <Field label="Khả năng truy vấn">
                  <select
                    name="queryable"
                    defaultValue={String(list.params.queryable || "")}
                  >
                    <option value="">Tất cả</option>
                    <option value="true">Truy vấn được</option>
                    <option value="false">Không truy vấn được</option>
                  </select>
                </Field>
                <Field label="Trạng thái">
                  <input
                    name="status"
                    defaultValue={String(list.params.status || "")}
                    placeholder="Tất cả trạng thái"
                  />
                </Field>
              </>
            )}
            {["dimensions", "metrics"].includes(selected) && (
              <Field label="Kiểu dữ liệu">
                <input
                  name="dataType"
                  defaultValue={String(list.params.dataType || "")}
                  placeholder="Tất cả kiểu dữ liệu"
                />
              </Field>
            )}
            {selected === "relationships" && (
              <Field label="Table ID">
                <input
                  name="tableId"
                  defaultValue={String(list.params.tableId || "")}
                  placeholder="Lọc theo bảng"
                />
              </Field>
            )}
            {selected === "examples" && (
              <Field label="Ngôn ngữ">
                <select
                  name="language"
                  defaultValue={String(list.params.language || "")}
                >
                  <option value="">Tất cả</option>
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">English</option>
                </select>
              </Field>
            )}
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
          <Tabs
            items={sections.map(([s, label, Icon]) => ({
              to: `/catalog/${s}`,
              label,
              icon: <Icon size={19} />,
              active: s === selected,
            }))}
          />
          <div
            className={`${itemId ? "catalog-grid" : "catalog-single"} ${["tables", "metrics"].includes(selected) ? "with-categories" : ""}`}
          >
            {["tables", "metrics"].includes(selected) && (
              <div className="catalog-categories">
                <Card title="Danh mục">
                  <button
                    className={
                      !list.params.category
                        ? "category-row active"
                        : "category-row"
                    }
                    onClick={() => list.patch({ category: "" })}
                  >
                    <Database size={17} />
                    Tất cả
                    <span>
                      {selected === "tables"
                        ? summary.data?.tableCount
                        : summary.data?.metricCount}
                    </span>
                  </button>
                  {categories?.map((category) => (
                    <button
                      key={category.name}
                      className={
                        list.params.category === category.name
                          ? "category-row active"
                          : "category-row"
                      }
                      onClick={() => list.patch({ category: category.name })}
                    >
                      <Layers3 size={17} />
                      {category.name}
                      <span>{category.count}</span>
                    </button>
                  ))}
                </Card>
                <Card title="Tổng quan dataset">
                  <DetailList
                    items={[
                      ["Số bảng", summary.data?.tableCount],
                      ["Metrics", summary.data?.metricCount],
                      ["Dimensions", summary.data?.dimensionCount],
                      ["Mối quan hệ", summary.data?.relationshipCount],
                    ]}
                  />
                </Card>
              </div>
            )}
            <Card
              title={sections.find((s) => s[0] === selected)?.[1] || "Catalog"}
            >
              {selected === "tables" ? (
                <TableList
                  onSelect={(id) =>
                    nav(`/catalog/tables/${encodeURIComponent(id)}`)
                  }
                />
              ) : selected === "metrics" ? (
                <MetricList
                  onSelect={(id) =>
                    nav(`/catalog/metrics/${encodeURIComponent(id)}`)
                  }
                />
              ) : selected === "dimensions" ? (
                <DimensionList
                  onSelect={(id) =>
                    nav(`/catalog/dimensions/${encodeURIComponent(id)}`)
                  }
                />
              ) : selected === "relationships" ? (
                <RelationshipList />
              ) : (
                <ExampleList />
              )}
            </Card>
            {itemId &&
              ["tables", "metrics", "dimensions"].includes(selected) && (
                <aside>
                  <CatalogDetail
                    key={`${c.datasetId}-${selected}-${itemId}`}
                    kind={selected}
                    id={itemId}
                  />
                </aside>
              )}
          </div>
        </>
      )}
    </>
  );
}
function TableList({ onSelect }: { onSelect: (id: string) => void }) {
  const c = useWarehouse(),
    list = useListState("name"),
    query = useQuery({
      queryKey: ["catalog-tables", c.datasetId, list.params],
      queryFn: ({ signal }) =>
        catalogApi.tables(c.datasetId, list.params, signal),
    });
  return (
    <Resource resource={query}>
      {(data) => (
        <>
          <DataGrid
            rows={data.items}
            rowKey={(t) => t.tableId}
            onSelect={(t) => onSelect(t.tableId)}
            sort={String(list.params.sort)}
            direction={String(list.params.direction)}
            onSort={list.sort}
            columns={[
              {
                key: "name",
                label: "Tên bảng (Logical)",
                sortable: true,
                render: (t) => <strong>{t.logicalName}</strong>,
              },
              {
                key: "physical",
                label: "Bảng vật lý",
                render: (t) => (
                  <code>
                    {t.schema}.{t.name}
                  </code>
                ),
              },
              {
                key: "grain",
                label: "Grain (Mức hạt)",
                render: (t) => t.grain,
              },
              {
                key: "columns",
                label: "Số cột",
                render: (t) => t.columns.length,
              },
              {
                key: "queryable",
                label: "Truy vấn được",
                render: (t) => (t.queryable ? "Có" : "Không"),
              },
            ]}
          />
          <Pagination {...data} onChange={list.paginate} />
        </>
      )}
    </Resource>
  );
}
function MetricList({ onSelect }: { onSelect: (id: string) => void }) {
  const c = useWarehouse(),
    list = useListState("name"),
    query = useQuery({
      queryKey: ["catalog-metrics", c.datasetId, list.params],
      queryFn: ({ signal }) =>
        catalogApi.metrics(c.datasetId, list.params, signal),
    });
  return (
    <Resource resource={query}>
      {(data) => (
        <>
          <DataGrid
            rows={data.items}
            rowKey={(m) => m.name}
            onSelect={(m) => onSelect(m.name)}
            sort={String(list.params.sort)}
            direction={String(list.params.direction)}
            onSort={list.sort}
            columns={[
              {
                key: "name",
                label: "Tên metric",
                sortable: true,
                render: (m) => <strong>{m.name}</strong>,
              },
              {
                key: "description",
                label: "Mô tả",
                render: (m) => m.description,
              },
              {
                key: "expression",
                label: "Công thức",
                render: (m) => <code>{m.expression}</code>,
              },
              { key: "unit", label: "Đơn vị", render: (m) => m.unit },
              {
                key: "synonyms",
                label: "Synonyms",
                render: (m) => (
                  <div className="chips">
                    {m.synonyms.map((x) => (
                      <span key={x} className="chip">
                        {x}
                      </span>
                    ))}
                  </div>
                ),
              },
            ]}
          />
          <Pagination {...data} onChange={list.paginate} />
        </>
      )}
    </Resource>
  );
}
function DimensionList({ onSelect }: { onSelect: (id: string) => void }) {
  const c = useWarehouse(),
    list = useListState("name"),
    query = useQuery({
      queryKey: ["catalog-dimensions", c.datasetId, list.params],
      queryFn: ({ signal }) =>
        catalogApi.dimensions(c.datasetId, list.params, signal),
    });
  return (
    <Resource resource={query}>
      {(data) => (
        <>
          <DataGrid
            rows={data.items}
            rowKey={(d) => d.name}
            onSelect={(d) => onSelect(d.name)}
            sort={String(list.params.sort)}
            direction={String(list.params.direction)}
            onSort={list.sort}
            columns={[
              {
                key: "name",
                label: "Tên dimension",
                sortable: true,
                render: (d) => d.name,
              },
              {
                key: "description",
                label: "Mô tả",
                render: (d) => d.description,
              },
              {
                key: "mapping",
                label: "Physical mapping",
                render: (d) => `${d.table.schema}.${d.table.name}.${d.column}`,
              },
              {
                key: "dataType",
                label: "Kiểu dữ liệu",
                render: (d) => d.dataType,
              },
            ]}
          />
          <Pagination {...data} onChange={list.paginate} />
        </>
      )}
    </Resource>
  );
}
function RelationshipList() {
  const c = useWarehouse(),
    list = useListState("name"),
    query = useQuery({
      queryKey: ["catalog-relationships", c.datasetId, list.params],
      queryFn: ({ signal }) =>
        catalogApi.relationships(c.datasetId, list.params, signal),
    });
  return (
    <Resource resource={query}>
      {(data) => (
        <>
          <div className="relationship-list">
            {data.items.map((x, i) => (
              <article className="relationship" key={i}>
                <div>
                  <GitBranch size={22} />
                  <code>
                    {x.from.table.schema}.{x.from.table.name}.{x.from.column}
                  </code>
                </div>
                <span className="chip">
                  {x.cardinality}
                  <ArrowRight size={16} />
                </span>
                <code>
                  {x.to.table.schema}.{x.to.table.name}.{x.to.column}
                </code>
              </article>
            ))}
            {!data.items.length && (
              <Empty
                title="Chưa có mối quan hệ"
                description="Các join path được định nghĩa trong semantic model của dataset."
              />
            )}
          </div>
          <Pagination {...data} onChange={list.paginate} />
        </>
      )}
    </Resource>
  );
}
function ExampleList() {
  const c = useWarehouse(),
    list = useListState("question"),
    query = useQuery({
      queryKey: ["catalog-examples", c.datasetId, list.params],
      queryFn: ({ signal }) =>
        catalogApi.examples(c.datasetId, list.params, signal),
    });
  return (
    <Resource resource={query}>
      {(data) => (
        <>
          {data.items.length ? (
            data.items.map((x, i) => (
              <article className="catalog-example" key={i}>
                <h3>{x.question}</h3>
                <small>
                  {x.sqlDialect} · {x.language || "—"}
                </small>
                <SqlBlock sql={x.sql} />
                <Link
                  className="text-link"
                  to="/query"
                  state={{ question: x.question }}
                >
                  Đặt câu hỏi này
                  <ArrowRight size={15} />
                </Link>
              </article>
            ))
          ) : (
            <Empty />
          )}
          <Pagination {...data} onChange={list.paginate} />
        </>
      )}
    </Resource>
  );
}
function CatalogDetail({ kind, id }: { kind: string; id: string }) {
  const c = useWarehouse();
  const table = useQuery({
      queryKey: ["table", c.datasetId, id],
      queryFn: ({ signal }) => catalogApi.table(c.datasetId, id, signal),
      enabled: kind === "tables",
    }),
    metric = useQuery({
      queryKey: ["metric", c.datasetId, id],
      queryFn: ({ signal }) => catalogApi.metric(c.datasetId, id, signal),
      enabled: kind === "metrics",
    }),
    dimension = useQuery({
      queryKey: ["dimension", c.datasetId, id],
      queryFn: ({ signal }) => catalogApi.dimension(c.datasetId, id, signal),
      enabled: kind === "dimensions",
    });
  return (
    <Card
      title="Thông tin chi tiết"
      actions={
        <Link to={`/catalog/${kind}`} className="text-link">
          Đóng
        </Link>
      }
    >
      {kind === "tables" ? (
        <Resource resource={table}>
          {(data) => <TableDetail table={data} />}
        </Resource>
      ) : kind === "metrics" ? (
        <Resource resource={metric}>
          {(data) => <MetricDetail metric={data} />}
        </Resource>
      ) : (
        <Resource resource={dimension}>
          {(data) => <DimensionDetail dimension={data} />}
        </Resource>
      )}
    </Card>
  );
}
function TableDetail({ table: t }: { table: TableMetadata }) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20);
  const columns = t.columns.filter((c) =>
    `${c.name} ${c.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="dataset-title">
        <span className="icon-tile">
          <Database size={26} />
        </span>
        <div>
          <h3>{t.logicalName}</h3>
          <code>
            {t.schema}.{t.name}
          </code>
        </div>
      </div>
      <p>{t.description}</p>
      <DetailList
        items={[
          ["Grain", t.grain],
          ["Số cột", t.columns.length],
          ["Truy vấn được", t.queryable ? "Có" : "Không"],
          ["Primary key", t.primaryKey.join(", ") || "—"],
        ]}
      />
      <h3>Cột dữ liệu</h3>
      <input
        aria-label="Tìm cột"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        placeholder="Tìm tên cột hoặc mô tả…"
      />
      <DataGrid
        rows={columns.slice((page - 1) * pageSize, page * pageSize)}
        rowKey={(c) => c.name}
        columns={[
          {
            key: "name",
            label: "Tên cột",
            render: (c) => (
              <span>
                {t.primaryKey.includes(c.name) && <KeyRound size={13} />}{" "}
                {c.name}
              </span>
            ),
          },
          { key: "dataType", label: "Kiểu", render: (c) => c.dataType },
          {
            key: "nullable",
            label: "Nullable",
            render: (c) => (c.nullable ? "Có" : "Không"),
          },
          { key: "description", label: "Mô tả", render: (c) => c.description },
        ]}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        totalItems={columns.length}
        totalPages={Math.ceil(columns.length / pageSize)}
        onChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
      />
      <h3>Foreign keys</h3>
      {t.foreignKeys.length ? (
        t.foreignKeys.map((fk, i) => (
          <p className="break-word" key={i}>
            {fk.from.column} → {fk.to.table.schema}.{fk.to.table.name}.
            {fk.to.column} ({fk.cardinality})
          </p>
        ))
      ) : (
        <p className="muted">Không có foreign key được khai báo.</p>
      )}
    </>
  );
}
function MetricDetail({ metric: m }: { metric: Metric }) {
  return (
    <>
      <h3>{m.name}</h3>
      <p>{m.description}</p>
      <DetailList
        items={[
          ["Đơn vị", m.unit],
          ["Synonyms", m.synonyms.join(", ")],
          ["Compatible dimensions", m.compatibleDimensions.join(", ")],
          [
            "Bảng nguồn",
            m.tableRefs.map((t) => `${t.schema}.${t.name}`).join(", "),
          ],
        ]}
      />
      <SqlBlock sql={m.expression} label="Biểu thức metric" />
      {m.examples?.map((ex, i) => (
        <p key={i}>{ex.question}</p>
      ))}
    </>
  );
}
function DimensionDetail({ dimension: d }: { dimension: Dimension }) {
  return (
    <>
      <h3>{d.name}</h3>
      <p>{d.description}</p>
      <DetailList
        items={[
          ["Physical mapping", `${d.table.schema}.${d.table.name}.${d.column}`],
          ["Kiểu dữ liệu", d.dataType],
          ["Synonyms", d.synonyms.join(", ")],
        ]}
      />
    </>
  );
}
