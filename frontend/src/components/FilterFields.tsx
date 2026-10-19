import { useState } from "react";
import { AsyncSelect, Field } from "./ui";
import { warehouseApi } from "../api/warehouseApi";
import { datasetApi } from "../api/datasetApi";
import { engineLabel } from "../lib/format";
import type { Params } from "../api/client";
export function RegistryFilterFields({ params }: { params: Params }) {
  const [wh, setWh] = useState<{ id: string; label: string } | undefined>(
      params.warehouseId
        ? { id: String(params.warehouseId), label: String(params.warehouseId) }
        : undefined,
    ),
    [ds, setDs] = useState<{ id: string; label: string } | undefined>(
      params.datasetId
        ? { id: String(params.datasetId), label: String(params.datasetId) }
        : undefined,
    );
  return (
    <>
      <div className="field">
        <AsyncSelect
          label="Lọc warehouse"
          value={wh}
          onSelect={(w) => {
            setWh(w);
            setDs(undefined);
          }}
          load={async (p, s) => {
            const list = await warehouseApi.list(p, s);
            return {
              ...list,
              items: list.items.map((w) => ({
                id: w.warehouseId,
                label: `${w.name} (${engineLabel[w.engine]})`,
              })),
            };
          }}
          getId={(w) => w.id}
          getLabel={(w) => w.label}
        />
        <input type="hidden" name="warehouseId" value={wh?.id || ""} />
        {wh && (
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setWh(undefined);
              setDs(undefined);
            }}
          >
            Tất cả warehouses
          </button>
        )}
      </div>
      <Field label="Engine">
        <select name="engine" defaultValue={String(params.engine || "")}>
          <option value="">Tất cả engines</option>
          {Object.entries(engineLabel).map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <div className="field">
        <AsyncSelect
          key={wh?.id || "all"}
          cacheKey={`filter-${wh?.id || "all"}`}
          label="Lọc dataset"
          value={ds}
          onSelect={setDs}
          load={async (p, s) => {
            const list = await datasetApi.list(
              { ...p, warehouseId: wh?.id },
              s,
            );
            return {
              ...list,
              items: list.items.map((d) => ({
                id: d.datasetId,
                label: d.name,
              })),
            };
          }}
          getId={(d) => d.id}
          getLabel={(d) => d.label}
        />
        <input type="hidden" name="datasetId" value={ds?.id || ""} />
        {ds && (
          <button
            type="button"
            className="text-link"
            onClick={() => setDs(undefined)}
          >
            Tất cả datasets
          </button>
        )}
      </div>
    </>
  );
}
export function DateFilterFields({ params }: { params: Params }) {
  const date = (v: Params[string]) => {
    if (!v) return "";
    const d = new Date(typeof v === "number" ? v : String(v));
    return Number.isNaN(d.getTime())
      ? ""
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Ho_Chi_Minh",
        }).format(d);
  };
  return (
    <>
      <Field label="Từ ngày (UTC+07)">
        <input type="date" name="fromDate" defaultValue={date(params.from)} />
      </Field>
      <Field label="Đến ngày (UTC+07)">
        <input
          type="date"
          name="toDate"
          defaultValue={
            params.to
              ? date(new Date(String(params.to)).getTime() - 86400000)
              : ""
          }
        />
      </Field>
    </>
  );
}
