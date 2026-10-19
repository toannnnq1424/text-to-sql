import { z } from "zod";
import { ErrorBodySchema, type ErrorBody } from "./schema";
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public correlationId = "",
    public status = 0,
    public details: Record<string, unknown> = {},
    public retryable = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export type Params = Record<
  string,
  string | number | boolean | undefined | null
>;
let tokenProvider: () => Promise<string | null> = async () => null;
export const setTokenProvider = (provider: typeof tokenProvider) => {
  tokenProvider = provider;
};
const rawBase = import.meta.env.VITE_API_BASE_URL || "/api/v1";
function baseUrl() {
  const url = new URL(rawBase, window.location.origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ApiError(
      "CONFIGURATION_ERROR",
      "Cấu hình địa chỉ API Java không hợp lệ.",
    );
  return url.href.replace(/\/$/, "");
}
export const encodeId = (id: string) => encodeURIComponent(id);
export function apiUrl(path: string, params?: Params) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("://") ||
    path.includes("..")
  )
    throw new ApiError("INVALID_REQUEST", "Đường dẫn API không hợp lệ.");
  const url = new URL(baseUrl() + path);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      url.searchParams.set(key, String(value));
  });
  return url.href;
}
export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT";
  body?: unknown;
  params?: Params;
  signal?: AbortSignal;
  timeoutMs?: number;
};
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const response = await transport(path, options);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "INVALID_RESPONSE",
      "API Java trả về dữ liệu không phải JSON.",
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new ApiError(
      "CONTRACT_MISMATCH",
      "Dữ liệu API không khớp contract. Không thể hiển thị kết quả an toàn.",
      response.headers.get("X-Correlation-ID") || "",
    );
  return parsed.data;
}
async function transport(
  path: string,
  options: RequestOptions,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 65000);
  const correlationId = crypto.randomUUID();
  try {
    const token = await tokenProvider();
    if (controller.signal.aborted)
      throw new DOMException("Aborted", "AbortError");
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Correlation-ID": correlationId,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined)
      headers["Content-Type"] = "application/json";
    const response = await fetch(apiUrl(path, options.params), {
      method: options.method || "GET",
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      headers,
      signal: controller.signal,
      credentials: "same-origin",
      redirect: "error",
    });
    if (!response.ok) {
      let error: ErrorBody | undefined;
      try {
        const body = await response.json();
        const p = ErrorBodySchema.safeParse(body.error);
        if (p.success) error = p.data;
      } catch {
        /* Non-JSON proxy responses use the safe local message. */
      }
      const defaults: Record<number, string> = {
        401: "Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.",
        403: "Bạn không có quyền thực hiện thao tác này.",
        404: "Không tìm thấy dữ liệu yêu cầu.",
        410: "Kết quả đã hết hạn lưu trữ. Hãy chạy truy vấn mới.",
        429: "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
        504: "Yêu cầu đã hết thời gian xử lý.",
      };
      throw new ApiError(
        error?.code || `HTTP_${response.status}`,
        error?.message ||
          defaults[response.status] ||
          "Không thể xử lý yêu cầu tới Java API.",
        error?.correlationId ||
          response.headers.get("X-Correlation-ID") ||
          correlationId,
        response.status,
        error?.details || {},
        error?.retryable || false,
      );
    }
    // Consume the body within the same deadline; a stalled or oversized response
    // must not leave the UI pending after headers have arrived.
    const reader = response.body?.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    if (reader) {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 10 * 1024 * 1024) {
            await reader.cancel();
            throw new ApiError(
              "RESPONSE_TOO_LARGE",
              "Dữ liệu API vượt giới hạn an toàn 10 MiB.",
              correlationId,
            );
          }
          chunks.push(new Uint8Array(part.value));
        }
      } finally {
        reader.releaseLock();
      }
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut)
      throw new ApiError(
        "QUERY_TIMEOUT",
        "Hết thời gian chờ API. Kiểm tra lịch sử trước khi gửi lại để tránh chạy trùng.",
        correlationId,
        0,
        {},
        false,
      );
    if (controller.signal.aborted)
      throw new DOMException("Aborted", "AbortError");
    throw new ApiError(
      "NETWORK_ERROR",
      "Không kết nối được Java API. Kiểm tra dịch vụ và thử lại.",
      correlationId,
      0,
      {},
      true,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
export async function downloadCsv(queryId: string, signal?: AbortSignal) {
  const response = await transport(`/query/${encodeId(queryId)}/export.csv`, {
    signal,
  });
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/csv"))
    throw new ApiError("INVALID_RESPONSE", "API không trả về file CSV hợp lệ.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `query-${queryId.replace(/[^\w-]/g, "_")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
