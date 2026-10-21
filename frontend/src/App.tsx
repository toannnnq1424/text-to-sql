import { Component, lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./app/auth";
import {
  LocaleProvider,
  WarehouseProvider,
  queryClientDefaults,
} from "./app/providers";
import { Shell } from "./components/Shell";
import { Card, Button, Empty, Loading } from "./components/ui";
const Home = lazy(() =>
    import("./pages/HomePage").then((m) => ({ default: m.HomePage })),
  ),
  Query = lazy(() =>
    import("./pages/QueryPage").then((m) => ({ default: m.QueryPage })),
  ),
  Result = lazy(() =>
    import("./pages/ResultPage").then((m) => ({ default: m.ResultPage })),
  ),
  History = lazy(() =>
    import("./pages/HistoryPage").then((m) => ({ default: m.HistoryPage })),
  ),
  Catalog = lazy(() =>
    import("./pages/CatalogPage").then((m) => ({ default: m.CatalogPage })),
  ),
  Warehouses = lazy(() =>
    import("./pages/WarehousesPage").then((m) => ({
      default: m.WarehousesPage,
    })),
  ),
  Ingestion = lazy(() =>
    import("./pages/IngestionPage").then((m) => ({ default: m.IngestionPage })),
  ),
  Evaluation = lazy(() =>
    import("./pages/EvaluationPage").then((m) => ({
      default: m.EvaluationPage,
    })),
  ),
  Monitoring = lazy(() =>
    import("./pages/MonitoringPage").then((m) => ({
      default: m.MonitoringPage,
    })),
  ),
  Settings = lazy(() =>
    import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
  ),
  SqlImport = lazy(() =>
    import("./pages/SqlImportPage").then((m) => ({ default: m.SqlImportPage })),
  );
const Semantic = lazy(() =>
  import("./pages/SemanticPage").then((m) => ({ default: m.SemanticPage })),
);
const Knowledge = lazy(() =>
  import("./pages/KnowledgePage").then((m) => ({ default: m.KnowledgePage })),
);
const Pipelines = lazy(() =>
  import("./pages/PipelinesPage").then((m) => ({ default: m.PipelinesPage })),
);
const Quality = lazy(() =>
  import("./pages/QualityPage").then((m) => ({ default: m.QualityPage })),
);
export const client = new QueryClient({ defaultOptions: queryClientDefaults });
export function AppRoutes() {
  return (
    <Suspense fallback={<Loading label="Đang mở màn hình…" />}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="query" element={<Query />} />
          <Route path="query/:id" element={<Result />} />
          <Route path="query/:id/:tab" element={<Result />} />
          <Route path="history" element={<History />} />
          <Route path="history/:id" element={<Result history />} />
          <Route path="history/:id/:tab" element={<Result history />} />
          <Route
            path="catalog"
            element={<Navigate to="/catalog/overview" replace />}
          />
          <Route path="catalog/:section" element={<Catalog />} />
          <Route path="catalog/:section/:itemId" element={<Catalog />} />
          <Route path="semantic" element={<Semantic />} />
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="pipelines" element={<Pipelines />} />
          <Route path="quality" element={<Quality />} />
          <Route path="warehouses" element={<Warehouses />} />
          <Route path="ingestion" element={<Ingestion />} />
          <Route path="ingestion/:runId" element={<Ingestion />} />
          <Route path="import/sql" element={<SqlImport />} />
          <Route path="import/sql/:runId" element={<SqlImport />} />
          <Route path="evaluation" element={<Evaluation />} />
          <Route path="evaluation/results/:resultId" element={<Evaluation />} />
          <Route path="monitoring" element={<Monitoring />} />
          <Route path="settings" element={<Settings />} />
          <Route
            path="auth/silent-callback"
            element={<Loading label="Đang làm mới phiên đăng nhập…" />}
          />
          <Route
            path="auth/callback"
            element={<Loading label="Đang hoàn tất đăng nhập…" />}
          />
          <Route
            path="*"
            element={
              <Card>
                <Empty
                  title="Không tìm thấy trang"
                  description="Đường dẫn không tồn tại hoặc đã thay đổi."
                  action={
                    <Link className="button primary" to="/">
                      Quay lại trang chủ
                    </Link>
                  }
                />
              </Card>
            }
          />
        </Route>
      </Routes>
    </Suspense>
  );
}
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="fatal-error">
        <h1>Không thể hiển thị ứng dụng</h1>
        <p>
          Vui lòng tải lại trang. Nếu lỗi tiếp tục, kiểm tra cấu hình frontend
          và kết nối Java API.
        </p>
        <Button onClick={() => window.location.reload()}>Tải lại</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <LocaleProvider>
            <WarehouseProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </WarehouseProvider>
          </LocaleProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
