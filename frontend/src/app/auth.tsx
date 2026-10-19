import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { UserManager, WebStorageStateStore, User } from "oidc-client-ts";
import { setTokenProvider } from "../api/client";
import { hasRole } from "./permissions";
export type AuthState = {
  user: User | null;
  ready: boolean;
  configured: boolean;
  error: string | null;
  can: (role: "VIEWER" | "ANALYST" | "OPERATOR" | "ADMIN") => boolean;
  login: () => Promise<void>;
  localLogin?: (token: string) => Promise<void>;
  localMode?: boolean;
  logout: () => Promise<void>;
};
export const AuthContext = createContext<AuthState>({
  user: null,
  ready: false,
  configured: false,
  error: null,
  can: () => false,
  login: async () => {
    throw new Error("OIDC chưa được cấu hình.");
  },
  logout: async () => {
    throw new Error("Chưa có phiên đăng nhập.");
  },
});
let manager: UserManager | undefined;
let configurationError: string | null = null;
let initialSession: Promise<User | null> | undefined;
const authority = import.meta.env.VITE_OIDC_AUTHORITY,
  client = import.meta.env.VITE_OIDC_CLIENT_ID;
const localAuth =
  import.meta.env.DEV && import.meta.env.VITE_LOCAL_AUTH === "true";
let localToken: string | null = null;
const configured = Boolean(authority && client);
if (configured) {
  try {
    const url = new URL(authority);
    if (
      url.protocol !== "https:" &&
      !(
        import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    )
      throw new Error("OIDC authority cần HTTPS.");
    manager = new UserManager({
      authority,
      client_id: client,
      redirect_uri: window.location.origin + "/auth/callback",
      silent_redirect_uri: window.location.origin + "/auth/silent-callback",
      post_logout_redirect_uri: window.location.origin,
      scope: import.meta.env.VITE_OIDC_SCOPE || "openid profile email",
      response_type: "code",
      automaticSilentRenew: true,
      // Keep the OIDC session across reloads in this tab, without persisting
      // access tokens in localStorage or sharing them with other tabs.
      userStore: new WebStorageStateStore({ store: sessionStorage }),
      stateStore: new WebStorageStateStore({ store: sessionStorage }),
    });
  } catch {
    configurationError =
      "Cấu hình OIDC không hợp lệ. Authority cần HTTPS và một public client ID hợp lệ.";
  }
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState<string | null>(configurationError);
  useEffect(() => {
    let live = true;
    const loaded = (u: User) => {
      if (live) {
        setUser(u);
        setError(null);
      }
    };
    const unloaded = () => {
      if (live) setUser(null);
    };
    const expired = () => {
      unloaded();
      if (live) setError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    };
    manager?.events.addUserLoaded(loaded);
    manager?.events.addUserUnloaded(unloaded);
    manager?.events.addAccessTokenExpired(expired);
    const init = async () => {
      try {
        if (localAuth) {
          const { request } = await import("../api/client");
          const { z } = await import("zod");
          setTokenProvider(async () => localToken);
          const session = await request(
            "/session",
            z.object({
              subject: z.string(),
              name: z.string(),
              roles: z.array(z.string()),
              local: z.literal(true),
            }),
          );
          if (live)
            setUser(
              new User({
                access_token: localToken || "",
                token_type: "Bearer",
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                profile: {
                  sub: session.subject,
                  name: session.name,
                  roles: session.roles,
                  iss: window.location.origin,
                  aud: "local",
                  exp: Math.floor(Date.now() / 1000) + 3600,
                  iat: Math.floor(Date.now() / 1000),
                },
              }),
            );
          return;
        }
        if (manager) {
          const m = manager;
          initialSession ??= (async () => {
            if (window.location.pathname === "/auth/silent-callback") {
              await m.signinSilentCallback();
              return null;
            }
            if (window.location.pathname === "/auth/callback") {
              const u = await m.signinRedirectCallback();
              const candidate =
                typeof u.state === "object" && u.state && "returnTo" in u.state
                  ? String(u.state.returnTo)
                  : "/";
              const target = new URL(candidate, window.location.origin);
              const safe =
                candidate.startsWith("/") &&
                target.origin === window.location.origin &&
                !candidate.includes("\\")
                  ? target.pathname + target.search
                  : "/";
              window.history.replaceState({}, "", safe);
              window.dispatchEvent(new PopStateEvent("popstate"));
              return u;
            }
            return m.getUser();
          })();
          const u = await initialSession;
          if (live) setUser(u && !u.expired ? u : null);
        }
      } catch {
        if (live)
          setError(
            "Không thể hoàn tất đăng nhập OIDC. Kiểm tra cấu hình và thử lại.",
          );
      } finally {
        if (live) setReady(true);
      }
    };
    void init();
    if (!localAuth)
      setTokenProvider(async () => {
        const u = await manager?.getUser();
        return u && !u.expired ? u.access_token : null;
      });
    return () => {
      live = false;
      manager?.events.removeUserLoaded(loaded);
      manager?.events.removeUserUnloaded(unloaded);
      manager?.events.removeAccessTokenExpired(expired);
    };
  }, []);
  function can(role: "VIEWER" | "ANALYST" | "OPERATOR" | "ADMIN") {
    if (!user || user.expired) return false;
    return hasRole(
      user.profile,
      role,
      import.meta.env.VITE_OIDC_ROLE_CLAIM || "roles",
    );
  }
  const localLogin = async (token: string) => {
    if (!localAuth || token.trim().length < 32)
      throw new Error("Local token không hợp lệ.");
    const { request } = await import("../api/client");
    const { z } = await import("zod");
    const previous = localToken;
    localToken = token.trim();
    setTokenProvider(async () => localToken);
    try {
      const session = await request(
        "/session",
        z.object({
          subject: z.string(),
          name: z.string(),
          roles: z.array(z.string()),
          local: z.literal(true),
        }),
      );
      setUser(
        new User({
          access_token: localToken,
          token_type: "Bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          profile: {
            sub: session.subject,
            name: session.name,
            roles: session.roles,
            iss: window.location.origin,
            aud: "local",
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
          },
        }),
      );
      setError(null);
    } catch (e) {
      localToken = previous;
      throw e;
    }
  };
  const login = async () => {
    if (!manager)
      throw new Error("Cần cấu hình OIDC authority và public client ID.");
    await manager.signinRedirect({
      state: { returnTo: window.location.pathname + window.location.search },
    });
  };
  const logout = async () => {
    if (localAuth) {
      localToken = null;
      setUser(null);
      window.location.reload();
      return;
    }
    if (manager) {
      await manager.signoutRedirect();
      setUser(null);
    }
  };
  return (
    <AuthContext
      value={{
        user,
        ready,
        configured: Boolean(manager),
        error,
        can,
        login,
        logout,
        localLogin,
        localMode: localAuth,
      }}
    >
      {children}
    </AuthContext>
  );
}
export const useAuth = () => useContext(AuthContext);
export function canReadApi(auth: AuthState) {
  return (
    auth.ready &&
    (Boolean(auth.user) ||
      (import.meta.env.DEV &&
        import.meta.env.VITE_ALLOW_ANONYMOUS_DEV === "true"))
  );
}
