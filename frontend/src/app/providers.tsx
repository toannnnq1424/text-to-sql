import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { warehouseApi } from "../api/warehouseApi";
import { datasetApi } from "../api/datasetApi";
import type { Warehouse, Dataset } from "../api/schema";
import { useAuth, canReadApi } from "./auth";
const en: Record<string, string> = {
  "Trang chủ": "Home",
  "Truy vấn": "Query",
  "Lịch sử truy vấn": "Query history",
  "Đánh giá": "Evaluation",
  "Nạp dữ liệu": "Ingestion",
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
function readId(key: string) {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
export function WarehouseProvider({ children }: { children: ReactNode }) {
  const auth = useAuth(),
    enabled = canReadApi(auth),
    client = useQueryClient();
  const identity=auth.user?.profile.sub||'anonymous';
  const previousIdentity=useRef(identity);
  useEffect(()=>{if(previousIdentity.current!==identity){void client.cancelQueries();client.clear();previousIdentity.current=identity;}},[identity,client]);
  const [warehouseId, setWarehouseId] = useState(() => readId("warehouseId")),
    [datasetId, setDatasetId] = useState(() => readId("datasetId"));
  const warehouseList = useQuery({
    queryKey: ["warehouses", "initial"],
    queryFn: ({ signal }) =>
      warehouseApi.list({ page: 1, pageSize: 20 }, signal),
    enabled,
  });
  const warehouseDetail = useQuery({
    queryKey: ["warehouse", warehouseId],
    queryFn: ({ signal }) => warehouseApi.get(warehouseId, signal),
    enabled: enabled && Boolean(warehouseId),
  });
  const warehouse = warehouseDetail.data;
  useEffect(() => {
    if (enabled && !warehouseId && warehouseList.data?.items.length) {
      const w =
        warehouseList.data.items.find((w) => w.status === "ACTIVE") ||
        warehouseList.data.items[0];
      setWarehouseId(w.warehouseId);
    }
  }, [enabled, warehouseId, warehouseList.data]);
  const datasets = useQuery({
    queryKey: ["datasets", "initial", warehouseId],
    queryFn: ({ signal }) =>
      datasetApi.list({ warehouseId, page: 1, pageSize: 20 }, signal),
    enabled: enabled && Boolean(warehouseId),
  });
  const datasetDetail = useQuery({
    queryKey: ["dataset", datasetId],
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
      setDatasetId(d.datasetId);
    }
  }, [enabled, warehouseId, datasetId, datasets.data]);
  useEffect(() => {
    if (datasetDetail.data && datasetDetail.data.warehouseId !== warehouseId)
      setDatasetId("");
  }, [datasetDetail.data, warehouseId]);
  useEffect(() => {
    sessionStorage.setItem("warehouseId", warehouseId);
    sessionStorage.setItem("datasetId", datasetId);
  }, [warehouseId, datasetId]);
  const selectWarehouse = (w: Warehouse) => {
    if (w.warehouseId === warehouseId) return;
    void client.cancelQueries();
    setDatasetId("");
    setWarehouseId(w.warehouseId);
  };
  const selectDataset = (d: Dataset) => {
    if (d.warehouseId !== warehouseId) return;
    void client.cancelQueries();
    client.setQueryData(["dataset", d.datasetId], d);
    setDatasetId(d.datasetId);
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
export const queryClientDefaults = {
  queries: {
    retry: false as const,
    refetchOnWindowFocus: false,
    staleTime: 15000,
  },
  mutations: { retry: false as const },
};
