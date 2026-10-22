import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { warehouseApi } from "../api/warehouseApi";
import { datasetApi } from "../api/datasetApi";
import type { Warehouse, Dataset } from "../api/schema";
import { useAuth, canReadApi } from "./auth";
import {
  readWarehouseSelection,
  warehouseSelectionKey,
  type WarehouseSelection,
} from "./warehouseSelection";
const en: Record<string, string> = {
  "Trang chủ": "Home",
  "Truy vấn": "Query",
  "Lịch sử truy vấn": "Query history",
  "Đánh giá": "Evaluation",
  "Nạp dữ liệu": "Ingestion",
  "Ngữ nghĩa nghiệp vụ": "Business semantics",
  "Tri thức AI": "AI knowledge",
  "Pipelines dữ liệu": "Data pipelines",
  "Chất lượng dữ liệu": "Data quality",
  "Giám sát": "Monitoring",
  "Cài đặt": "Settings",
  "Ngôn ngữ": "Language",
  "Tất cả": "All",
  "Tìm kiếm": "Search",
  "Thử lại": "Retry",
  "Đang tải dữ liệu…": "Loading data…",
  "Đăng nhập": "Sign in",
  "Chưa đăng nhập": "Not signed in",
  "Đăng xuất": "Sign out",
  "Áp dụng": "Apply",
  "Đặt lại": "Reset",
  Lưu: "Save",
  Hủy: "Cancel",
  Đóng: "Close",
  "Không có dữ liệu": "No data",
  "Thêm warehouse": "Add warehouse",
};
const LocaleContext = createContext({
  locale: "vi",
  setLocale: (_v: string) => {},
  t: (s: string) => s,
});
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(() =>
    localStorage.getItem("nla-locale") === "en" ? "en" : "vi",
  );
  const setLocale = (v: string) => {
    setLocaleState(v);
    localStorage.setItem("nla-locale", v);
  };
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <LocaleContext
      value={{
        locale,
        setLocale,
        t: (s) => (locale === "en" ? en[s] || s : s),
      }}
    >
      {children}
    </LocaleContext>
  );
}
export const useLocale = () => useContext(LocaleContext);
type ContextState = {
  warehouse: Warehouse | undefined;
  dataset: Dataset | undefined;
  warehouseId: string;
  datasetId: string;
  selectWarehouse: (w: Warehouse) => void;
  selectDataset: (d: Dataset) => void;
  warehouseLoading: boolean;
  datasetLoading: boolean;
  error: Error | null;
  reload: () => void;
  enabled: boolean;
};
const WarehouseContext = createContext<ContextState | null>(null);
export function WarehouseProvider({ children }: { children: ReactNode }) {
  const auth = useAuth(),
    enabled = canReadApi(auth),
    client = useQueryClient();
  const identity = auth.user?.profile.sub || "anonymous";
  const previousIdentity = useRef(identity);
  useEffect(() => {
    if (previousIdentity.current !== identity) {
      void client.cancelQueries();
      client.clear();
      previousIdentity.current = identity;
    }
  }, [identity, client]);
  const [selection, setSelection] = useState(() =>
    readWarehouseSelection(sessionStorage, identity),
  );
  const activeSelection =
    selection.identity === identity
      ? selection
      : readWarehouseSelection(sessionStorage, identity);
  const { warehouseId, datasetId } = activeSelection;
  useEffect(() => {
    if (selection.identity !== identity) setSelection(activeSelection);
  }, [activeSelection, identity, selection.identity]);
  const warehouseList = useQuery({
    queryKey: ["warehouses", identity, "initial"],
    queryFn: ({ signal }) =>
      warehouseApi.list({ page: 1, pageSize: 20 }, signal),
    enabled,
  });
  const warehouseDetail = useQuery({
    queryKey: ["warehouse", identity, warehouseId],
    queryFn: ({ signal }) => warehouseApi.get(warehouseId, signal),
    enabled: enabled && Boolean(warehouseId),
  });
  const warehouse = warehouseDetail.data;
  useEffect(() => {
    if (enabled && !warehouseId && warehouseList.data?.items.length) {
      const w =
        warehouseList.data.items.find((w) => w.status === "ACTIVE") ||
        warehouseList.data.items[0];
      setSelection({ identity, warehouseId: w.warehouseId, datasetId: "" });
    }
  }, [enabled, identity, warehouseId, warehouseList.data]);
  const datasets = useQuery({
    queryKey: ["datasets", identity, "initial", warehouseId],
    queryFn: ({ signal }) =>
      datasetApi.list({ warehouseId, page: 1, pageSize: 20 }, signal),
    enabled: enabled && Boolean(warehouseId),
  });
  const datasetDetail = useQuery({
    queryKey: ["dataset", identity, datasetId],
    queryFn: ({ signal }) => datasetApi.get(datasetId, signal),
    enabled: enabled && Boolean(datasetId),
  });
  const dataset =
    datasetDetail.data?.warehouseId === warehouseId
      ? datasetDetail.data
      : undefined;
  useEffect(() => {
    if (enabled && warehouseId && !datasetId && datasets.data?.items.length) {
      const d =
        datasets.data.items.find((d) => d.status === "ACTIVE") ||
        datasets.data.items[0];
      setSelection({ identity, warehouseId, datasetId: d.datasetId });
    }
  }, [enabled, identity, warehouseId, datasetId, datasets.data]);
  useEffect(() => {
    if (datasetDetail.data && datasetDetail.data.warehouseId !== warehouseId)
      setSelection({ identity, warehouseId, datasetId: "" });
  }, [datasetDetail.data, identity, warehouseId]);
  useEffect(() => {
    sessionStorage.setItem(
      warehouseSelectionKey(identity),
      JSON.stringify({ warehouseId, datasetId }),
    );
  }, [identity, warehouseId, datasetId]);
  const selectWarehouse = (w: Warehouse) => {
    if (w.warehouseId === warehouseId) return;
    void client.cancelQueries();
    const next = { identity, warehouseId: w.warehouseId, datasetId: "" };
    setSelection(next);
    sessionStorage.setItem(
      warehouseSelectionKey(identity),
      JSON.stringify(next),
    );
  };
  const selectDataset = (d: Dataset) => {
    if (d.warehouseId !== warehouseId) return;
    void client.cancelQueries();
    client.setQueryData(["dataset", identity, d.datasetId], d);
    const next = { ...activeSelection, datasetId: d.datasetId };
    setSelection(next);
    sessionStorage.setItem(
      warehouseSelectionKey(identity),
      JSON.stringify(next),
    );
  };
  useEffect(() => {
    if (!enabled && auth.ready) {
      client.clear();
    }
  }, [enabled, auth.ready, client]);
  return (
    <WarehouseContext
      value={{
        warehouse,
        dataset,
        warehouseId,
        datasetId,
        selectWarehouse,
        selectDataset,
        warehouseLoading:
          enabled && (warehouseList.isLoading || warehouseDetail.isLoading),
        datasetLoading:
          enabled && (datasets.isLoading || datasetDetail.isLoading),
        error:
          warehouseList.error ||
          warehouseDetail.error ||
          datasets.error ||
          datasetDetail.error,
        reload: () => {
          void client.invalidateQueries();
        },
        enabled,
      }}
    >
      {children}
    </WarehouseContext>
  );
}
export function useWarehouse() {
  const context = useContext(WarehouseContext);
  if (!context) throw new Error("WarehouseProvider is required");
  return context;
}
export function retryApiRead(failureCount: number, error: unknown) {
  return error instanceof ApiError && error.retryable && failureCount < 2;
}

export const queryClientDefaults = {
  queries: {
    retry: retryApiRead,
    retryDelay: (attempt: number) => Math.min(150 * 2 ** attempt, 600),
    refetchOnWindowFocus: false,
    staleTime: 15000,
  },
  mutations: { retry: false as const },
};
