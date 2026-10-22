import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Visualization,
  scalarColumn,
  suggestChart,
  validateChart,
  plotRows,
} from "./Visualization";
import type { QueryResult } from "../api/schema";
import { queryApi } from "../api/queryApi";

afterEach(() => vi.restoreAllMocks());

const result: QueryResult = {
  columns: [
    {
      name: "station",
      label: "Station",
      dataType: "STRING",
      semanticRole: "DIMENSION",
    },
    {
      name: "area",
      label: "Area",
      dataType: "STRING",
      semanticRole: "DIMENSION",
    },
    {
      name: "temperature",
      label: "Temperature",
      dataType: "DECIMAL",
      semanticRole: "METRIC",
      unit: "C",
    },
    {
      name: "temperature_max",
      label: "Maximum",
      dataType: "DECIMAL",
      semanticRole: "METRIC",
      unit: "C",
    },
    {
      name: "rain",
      label: "Rainfall",
      dataType: "DECIMAL",
      semanticRole: "METRIC",
      unit: "mm",
    },
  ],
  rows: [
    {
      station: "North",
      area: "A",
      temperature: "12.50",
      temperature_max: "18.25",
      rain: "3.00",
    },
    {
      station: "South",
      area: "B",
      temperature: "17.50",
      temperature_max: "21.00",
      rain: "1.00",
    },
  ],
  returnedRowCount: 2,
  page: 1,
  pageSize: 20,
  truncated: false,
};
describe("result shape and chart controls", () => {
  it("locally pages a wide fallback snapshot with bounded DOM, exact copy and accessible last-page controls", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    const requestPage = vi.spyOn(queryApi, "result");
    const runQuery = vi.spyOn(queryApi, "run");
    const columns: QueryResult["columns"] = Array.from(
      { length: 200 },
      (_, index) => ({
        name: "column_" + index,
        label: "Column " + index,
        dataType: index === 1 ? "DECIMAL" : "STRING",
        semanticRole: index === 1 ? "METRIC" : "DIMENSION",
      }),
    );
    const rows = Array.from({ length: 1000 }, (_, row) =>
      Object.fromEntries(
        columns.map((column, index) => [
          column.name,
          index === 1
            ? "9007199254740993.123456789"
            : `Value ${row + 1}-${index}`,
        ]),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Visualization
          spec={{
            type: "bar",
            title: "Invalid axis",
            x: "missing",
            series: [],
          }}
          result={{ ...result, columns, rows, returnedRowCount: 1000 }}
        />
      </QueryClientProvider>,
    );
    const navigation = screen.getByRole("navigation", {
      name: "Phân trang bảng biểu đồ",
    });
    const table = screen.getByRole("table");
    const renderedRows = () => within(table).getAllByRole("row").slice(1);
    expect(renderedRows()).toHaveLength(20);
    expect(table.querySelectorAll("tbody td")).toHaveLength(20 * 202);
    expect(
      within(navigation).getByRole("button", { name: "Trang đầu" }),
    ).toBeDisabled();
    await user.click(
      within(navigation).getByRole("button", { name: "Trang sau" }),
    );
    const first = within(renderedRows()[0]);
    expect(first.getAllByRole("cell")[0]).toHaveTextContent("21");
    expect(first.getByRole("button", { name: "Value 21-0" })).toBeVisible();
    await user.click(
      first.getByRole("button", { name: "9.007.199.254.740.993,123456789" }),
    );
    expect(copy).toHaveBeenLastCalledWith("9007199254740993.123456789");
    await user.click(first.getByRole("button", { name: "Sao chép dòng 21" }));
    expect(copy).toHaveBeenLastCalledWith(JSON.stringify(rows[20]));
    const last = within(navigation).getByRole("button", { name: "Trang cuối" });
    last.focus();
    await user.keyboard("{Enter}");
    expect(within(renderedRows()[0]).getAllByRole("cell")[0]).toHaveTextContent(
      "981",
    );
    expect(
      within(renderedRows().at(-1)!).getAllByRole("cell")[0],
    ).toHaveTextContent("1000");
    expect(renderedRows()).toHaveLength(20);
    expect(
      within(navigation).getByRole("button", { name: "Trang sau" }),
    ).toBeDisabled();
    expect(last).toBeDisabled();
    expect(requestPage).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  }, 15000);

  it("pages only available snapshot rows and identifies an unloaded remainder", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 35 }, (_, index) => ({
      station: `Station ${index + 1}`,
      area: "Area",
      temperature: "12.50",
      temperature_max: "18.25",
      rain: "3.00",
    }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Visualization
          spec={{ type: "table", title: "Partial snapshot", series: [] }}
          result={{ ...result, rows, returnedRowCount: 1500 }}
        />
      </QueryClientProvider>,
    );
    expect(
      screen.getByText(/Bảng này có 35 dòng đã tải trong 1\.500 dòng snapshot/),
    ).toBeVisible();
    const navigation = screen.getByRole("navigation", {
      name: "Phân trang bảng biểu đồ",
    });
    await user.click(
      within(navigation).getByRole("button", { name: "Trang cuối" }),
    );
    const rowsOnLastPage = within(screen.getByRole("table"))
      .getAllByRole("row")
      .slice(1);
    expect(rowsOnLastPage).toHaveLength(15);
    expect(within(rowsOnLastPage[0]).getAllByRole("cell")[0]).toHaveTextContent(
      "21",
    );
    expect(
      within(rowsOnLastPage.at(-1)!).getAllByRole("cell")[0],
    ).toHaveTextContent("35");
    expect(
      within(navigation).getByRole("button", { name: "Trang sau" }),
    ).toBeDisabled();
    expect(within(navigation).getByText("2 / 2")).toBeVisible();
  });

  it("presents one count as a compact exact scalar even when the stored chart proposal was table", () => {
    const scalar: QueryResult = {
      ...result,
      columns: [
        {
          name: "record_count",
          label: "Record count",
          dataType: "BIGINT",
          semanticRole: "METRIC",
        },
      ],
      rows: [{ record_count: "9007199254740993123" }],
      returnedRowCount: 1,
    };
    render(
      <Visualization
        spec={{ type: "table", title: "Result", series: [] }}
        result={scalar}
      />,
    );
    expect(screen.getByText("9.007.199.254.740.993.123")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cột nhóm" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cột trục X")).not.toBeInTheDocument();
    expect(scalarColumn(scalar)?.name).toBe("record_count");
  });
  it("infers grouped compatible measures and time series from actual column types", () => {
    expect(suggestChart(result)).toMatchObject({
      type: "grouped-bar",
      x: "station",
      series: [{ column: "temperature" }, { column: "temperature_max" }],
    });
    expect(
      suggestChart({
        ...result,
        columns: [
          { name: "day", label: "Day", dataType: "DATE", semanticRole: "TIME" },
          ...result.columns.slice(2),
        ],
        rows: [
          {
            day: "2026-10-01",
            temperature: "12.50",
            temperature_max: "18.25",
            rain: "3.00",
          },
          {
            day: "2026-10-02",
            temperature: "17.50",
            temperature_max: "21.00",
            rain: "1.00",
          },
        ],
      }),
    ).toMatchObject({ type: "line", x: "day" });
  });
  it("keeps explicit row-list table recommendations and allows deliberate chart setup", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Visualization
          spec={{ type: "table", title: "Raw row listing", series: [] }}
          result={result}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("table")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Cột" }),
    ).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Cột trục X"), "station");
    await user.click(screen.getByLabelText(/^Temperature/));
    await user.click(screen.getByRole("button", { name: "Cột" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("orders only canonical temporal plot copies while preserving table and CSV source order", () => {
    const source: QueryResult = {
      ...result,
      columns: [
        {
          name: "day",
          label: "Day",
          dataType: "TIMESTAMP",
          semanticRole: "TIME",
        },
        result.columns[2],
      ],
      rows: [
        { day: "2026-10-02T00:00:00Z", temperature: "18" },
        { day: "2026-10-01T01:00:00+07:00", temperature: "12" },
        { day: "2026-10-01T00:00:00Z", temperature: "15" },
      ],
      returnedRowCount: 3,
    };
    const spec = {
      type: "line" as const,
      title: "Trend",
      x: "day",
      series: [{ column: "temperature", label: "Temperature" }],
    };
    expect(plotRows(source, spec).map((row) => row.temperature)).toEqual([
      "12",
      "15",
      "18",
    ]);
    expect(source.rows.map((row) => row.temperature)).toEqual([
      "18",
      "12",
      "15",
    ]);
    expect(plotRows(source, { ...spec, type: "bar" })).toEqual(source.rows);
  });
  it("requires known matching units before combining measures", () => {
    const unknown = {
      ...result,
      columns: result.columns.map((column) => ({ ...column, unit: undefined })),
    };
    expect(suggestChart(unknown).series).toHaveLength(1);
    expect(
      validateChart(
        {
          type: "grouped-bar",
          title: "Unknown units",
          x: "station",
          series: [{ column: "temperature" }, { column: "temperature_max" }],
        },
        unknown,
      ).spec.type,
    ).toBe("table");
  });
  it("changes axes and series while preventing mixed units", async () => {
    render(<Visualization spec={suggestChart(result)} result={result} />);
    const user = userEvent.setup();
    expect(screen.getByLabelText(/Rainfall/)).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Cột trục X"), "area");
    expect(screen.getByLabelText("Cột trục X")).toHaveValue("area");
    await user.click(screen.getByLabelText(/Maximum/));
    expect(screen.getByRole("button", { name: "Tròn" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Cột nhóm" }),
    ).not.toBeInTheDocument();
  });
});
