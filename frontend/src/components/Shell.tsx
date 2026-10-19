import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Home,
  MessageCircle,
  Clock3,
  Table2,
  BarChart3,
  CloudUpload,
  Database,
  Activity,
  Settings,
  Globe2,
  Bell,
  Menu,
  ChevronRight,
  LogIn,
  LogOut,
  ShieldCheck,
  X,
  ArrowRight,
} from "lucide-react";
import { useWarehouse, useLocale } from "../app/providers";
import { useAuth } from "../app/auth";
import { warehouseApi } from "../api/warehouseApi";
import { datasetApi } from "../api/datasetApi";
import { engineLabel } from "../lib/format";
import { AsyncSelect, Badge, Button, Notice } from "./ui";
import { BrandMark } from "./Artwork";
export const navigation = [
  { to: "/", label: "Trang chủ", icon: Home },
  { to: "/query", label: "Truy vấn", icon: MessageCircle },
  { to: "/history", label: "Lịch sử truy vấn", icon: Clock3 },
  { to: "/catalog", label: "Data Catalog", icon: Table2 },
  { to: "/evaluation", label: "Đánh giá", icon: BarChart3 },
  { to: "/ingestion", label: "Nạp dữ liệu", icon: CloudUpload },
  { to: "/warehouses", label: "Warehouses", icon: Database },
  { to: "/monitoring", label: "Giám sát", icon: Activity },
  { to: "/settings", label: "Cài đặt", icon: Settings },
];
export function Shell() {
  const c = useWarehouse(),
    auth = useAuth(),
    { t, locale, setLocale } = useLocale(),
    location = useLocation();
  const sidebarRef = useRef<HTMLElement>(null),
    [mobile, setMobile] = useState(
      () => window.matchMedia("(max-width: 1100px)").matches,
    );
  const [open, setOpen] = useState(false),
    [notifications, setNotifications] = useState(false),
    [authError, setAuthError] = useState("");
  const current = navigation.find((n) =>
    n.to === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(n.to),
  );
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const changed = () => {
      setMobile(media.matches);
      if (!media.matches) setOpen(false);
    };
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    const previous = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current
      ?.querySelector<HTMLButtonElement>(".mobile-close")
      ?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not(:disabled)",
        ) || [],
      );
      const first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [open, mobile]);

  const signin = () => void auth.login().catch((e) => setAuthError(e.message));
  return (
    <>
      <a className="skip-link" href="#main">
        Bỏ qua điều hướng
      </a>
      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Đóng điều hướng"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        inert={mobile && !open}
        role={mobile && open ? "dialog" : undefined}
        aria-modal={mobile && open ? true : undefined}
        className={`sidebar ${open ? "open" : ""}`}
        aria-label="Điều hướng chính"
      >
        <Link className="brand" to="/">
          <BrandMark />
          <span>
            Natural Language
            <br />
            Analytics Warehouse
          </span>
        </Link>
        <Button
          className="mobile-close"
          aria-label="Đóng menu"
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </Button>
        <nav>
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={25} strokeWidth={1.8} />
              <span>{t(label)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-context">
          <div className="sidebar-section-title">
            Workspace <span>⌄</span>
          </div>
          <div className="workspace-row">
            <span className="workspace-avatar">W</span>
            <div>
              <strong>{c.warehouse?.name || "Chưa chọn warehouse"}</strong>
              <small>
                {c.warehouse
                  ? engineLabel[c.warehouse.engine]
                  : "Kết nối dữ liệu của bạn"}
              </small>
            </div>
          </div>
          <div className="sidebar-section-title">
            Dataset <span>⌄</span>
          </div>
          <div className="workspace-row">
            <span className="dataset-avatar">
              <Database size={23} />
            </span>
            <div>
              <strong>{c.dataset?.name || "Chưa chọn dataset"}</strong>
              {c.dataset ? (
                <span
                  className={`sidebar-status ${c.dataset.status === "ACTIVE" ? "good" : "inactive"}`}
                >
                  <i />
                  {c.dataset.status}
                </span>
              ) : (
                <small>Chọn ở thanh phía trên</small>
              )}
            </div>
          </div>
        </div>
        <div className="sidebar-foot">
          <ShieldCheck size={14} />
          Read-only analytics
        </div>
      </aside>
      <div className="app-frame" inert={mobile && open}>
        <header className="topbar">
          <Button
            className="menu-button"
            aria-label="Mở menu"
            onClick={() => setOpen(true)}
          >
            <Menu size={22} />
          </Button>
          <div className="breadcrumb">
            <Link to="/" aria-label="Trang chủ">
              <Home size={20} fill="currentColor" />
            </Link>
            <ChevronRight size={15} />
            <span>{t(current?.label || "Trang không tồn tại")}</span>
          </div>
          <div className="global-context">
            <AsyncSelect
              label="Warehouse"
              value={c.warehouse}
              disabled={!c.enabled}
              getValueLabel={(w) => `${w.name} (${engineLabel[w.engine]})`}
              onSelect={c.selectWarehouse}
              load={warehouseApi.list}
              getId={(w) => w.warehouseId}
              getLabel={(w) =>
                `${w.name} (${engineLabel[w.engine]}) · ${w.status}`
              }
            />
            <AsyncSelect
              key={c.warehouseId}
              cacheKey={c.warehouseId}
              label="Dataset"
              value={c.dataset}
              disabled={!c.enabled || !c.warehouseId}
              getValueLabel={(d) => d.name}
              onSelect={c.selectDataset}
              load={(p, s) =>
                datasetApi.list({ ...p, warehouseId: c.warehouseId }, s)
              }
              getId={(d) => d.datasetId}
              getLabel={(d) =>
                `${d.name} · ${d.status} · semantic ${d.semanticVersion} / schema ${d.schemaVersion}`
              }
            />
            {c.dataset && <Badge status={c.dataset.status} />}
          </div>
          <div className="topbar-tools">
            <label className="language-select">
              <Globe2 size={22} />
              <select
                aria-label="Ngôn ngữ"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
              >
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </label>
            <div className="notification-wrap">
              <Button
                variant="ghost"
                aria-label="Thông báo hệ thống"
                aria-expanded={notifications}
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={22} />
              </Button>
              {notifications && (
                <div className="notification-menu">
                  <strong>Thông báo hệ thống</strong>
                  <p>
                    Theo dõi tình trạng warehouse, lỗi truy vấn và pipeline
                    trong Giám sát.
                  </p>
                  <Link
                    to="/monitoring"
                    onClick={() => setNotifications(false)}
                  >
                    Mở giám sát
                    <ArrowRight size={15} />
                  </Link>
                </div>
              )}
            </div>
            <div className="account">
              <span className="avatar">
                {auth.user?.profile.name?.charAt(0) || <LogIn size={19} />}
              </span>
              <div>
                <strong>
                  {auth.user?.profile.name || t("Chưa đăng nhập")}
                </strong>
                <small>
                  {auth.user
                    ? auth.user.profile.preferred_username || "OIDC session"
                    : "Natural Language Analytics"}
                </small>
              </div>
              {auth.user ? (
                <Button
                  aria-label="Đăng xuất"
                  variant="ghost"
                  onClick={() =>
                    void auth.logout().catch((e) => setAuthError(e.message))
                  }
                >
                  <LogOut size={18} />
                </Button>
              ) : (
                <Button aria-label="Đăng nhập" variant="ghost" onClick={signin}>
                  <LogIn size={19} />
                </Button>
              )}
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {(authError || auth.error) && (
            <Notice tone="error">{authError || auth.error}</Notice>
          )}
          {auth.ready && !auth.user && !c.enabled && (
            <div className="auth-banner">
              <ShieldCheck size={20} />
              <div>
                <strong>
                  {auth.configured
                    ? "Đăng nhập để truy cập dữ liệu của bạn"
                    : "Chưa cấu hình kết nối đăng nhập"}
                </strong>
                <span>
                  {auth.configured
                    ? "Sử dụng tài khoản được cấp quyền truy cập warehouse."
                    : "Cấu hình OIDC public client để kết nối an toàn tới Java API."}
                </span>
              </div>
              {auth.configured && (
                <Button variant="primary" onClick={signin}>
                  Đăng nhập
                  <ArrowRight size={16} />
                </Button>
              )}
            </div>
          )}
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>Natural Language Analytics Warehouse</span>
          <span>PostgreSQL · MySQL · SQL Server</span>
        </footer>
      </div>
    </>
  );
}
export function PageHeading({
  title,
  description,
  actions,
  art,
}: {
  title: ReactNode;
  description: string;
  actions?: ReactNode;
  art?: ReactNode;
}) {
  return (
    <header className={`page-heading ${art ? "has-art" : ""}`}>
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {art}
      {actions && <div className="heading-actions">{actions}</div>}
    </header>
  );
}
