import type {
  ModelProvider,
  ModelProviders,
  ProviderSnapshot,
} from "../api/modelProviderSchema";

export const modeLabel = {
  AUTO: "Tự động · model mặc định",
  API: "Chọn model/API",
  DETERMINISTIC: "Offline · khớp ví dụ (không AI)",
  SEMANTIC: "Công thức ngữ nghĩa · không gọi AI",
};
export const providerLabel = (
  provider: Pick<ProviderSnapshot, "kind" | "model">,
) =>
  `${provider.kind === "OLLAMA" ? "Ollama local" : "API online"} · ${provider.model}`;
export const providerSourceLabel = (source: ProviderSnapshot["source"]) =>
  source === "APPLICATION"
    ? "Cấu hình trong ứng dụng"
    : "Cấu hình deployment (chỉ đọc)";
export const defaultProvider = (
  data?: ModelProviders,
): ModelProvider | undefined => {
  const id = data?.defaultProviderId;
  return data?.items.find(
    (item) =>
      (id ? item.providerId === id : item.source === "ENVIRONMENT") &&
      item.configured &&
      item.enabled,
  );
};
export function executionLabel(query: {
  executionMode: "API" | "DETERMINISTIC" | "SEMANTIC";
  model: string | null;
  provider: ProviderSnapshot | null;
}) {
  if (query.executionMode !== "API") return modeLabel[query.executionMode];
  if (!query.provider)
    return `${query.model || "Chưa ghi nhận model"} · snapshot cũ chưa có nguồn`;
  if (!query.model)
    return `${providerLabel(query.provider)} · chưa ghi nhận model trả về`;
  return `${providerLabel({ ...query.provider, model: query.model })}${query.model !== query.provider.model ? ` · cấu hình yêu cầu ${query.provider.model}` : ""}`;
}
