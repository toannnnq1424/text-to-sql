package dev.nla;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Application-wide provider profiles; only administrators can mutate this shared configuration. */
@Service
public class ModelProviderService {
  private final Store store;
  private final ModelProviderSecrets secrets;
  private final ModelProviderPolicy policy;
  private final AiClient ai;

  public ModelProviderService(
      Store store, ModelProviderSecrets secrets, ModelProviderPolicy policy, AiClient ai) {
    this.store = store;
    this.secrets = secrets;
    this.policy = policy;
    this.ai = ai;
  }

  public Map<String, Object> list() {
    var items = new ArrayList<Map<String, Object>>();
    for (var profile : rows()) items.add(summary(profile));
    var environment = environment(true);
    if (environment != null) items.add(environment);
    String selected = defaultId(false);
    if (selected == null
        && environment != null
        && Boolean.TRUE.equals(environment.get("configured"))) selected = "environment";
    return Json.obj(
        "items",
        items,
        "defaultProviderId",
        selected,
        "configurationAvailable",
        secrets.available());
  }

  private List<Map<String, Object>> rows() {
    return store
        .jdbc()
        .query("SELECT * FROM model_provider ORDER BY updated_at DESC,id", this::row);
  }

  private Map<String, Object> row(ResultSet rs, int index) throws SQLException {
    return Json.obj(
        "providerId",
        rs.getString("id"),
        "revision",
        Long.toString(rs.getLong("revision")),
        "name",
        rs.getString("name"),
        "kind",
        rs.getString("kind"),
        "baseUrl",
        rs.getString("base_url"),
        "model",
        rs.getString("model"),
        "enabled",
        rs.getBoolean("enabled"),
        "encryptedApiKey",
        rs.getString("encrypted_api_key"),
        "updatedAt",
        rs.getTimestamp("updated_at").toInstant().toString());
  }

  private Map<String, Object> profile(String id, boolean lock) {
    if (id == null || !id.matches("provider-[a-f0-9-]{36}")) throw ApiException.notFound();
    var profiles =
        store
            .jdbc()
            .query(
                "SELECT * FROM model_provider WHERE id=?" + (lock ? " FOR UPDATE" : ""),
                this::row,
                id);
    if (profiles.isEmpty()) throw ApiException.notFound();
    return profiles.getFirst();
  }

  private String defaultId(boolean lock) {
    return store
        .jdbc()
        .queryForObject(
            "SELECT provider_id FROM model_provider_default WHERE id=1"
                + (lock ? " FOR UPDATE" : ""),
            String.class);
  }

  private Map<String, Object> summary(Map<String, Object> profile) {
    var safe = new LinkedHashMap<>(profile);
    boolean hasKey = safe.remove("encryptedApiKey") != null;
    safe.put("hasApiKey", hasKey);
    boolean destinationAllowed;
    try {
      policy.url(Json.str(profile, "kind"), Json.str(profile, "baseUrl"));
      destinationAllowed = true;
    } catch (ApiException changedPolicy) {
      destinationAllowed = false;
    }
    safe.put(
        "configured",
        destinationAllowed
            && secrets.available()
            && ("OLLAMA".equals(profile.get("kind")) || hasKey));
    safe.put("source", "APPLICATION");
    safe.put("readOnly", false);
    return safe;
  }

  private Map<String, Object> environment(boolean required) {
    try {
      var response =
          ai.invoke("model-provider/status", Json.obj("correlationId", Errors.correlation()), 5);
      Object value = response.get("provider");
      if (value == null) return null;
      var provider = Json.map(value);
      if (!provider
              .keySet()
              .equals(
                  Set.of(
                      "providerId",
                      "revision",
                      "name",
                      "kind",
                      "baseUrl",
                      "model",
                      "hasApiKey",
                      "enabled",
                      "configured",
                      "source",
                      "readOnly",
                      "updatedAt"))
          || !"environment".equals(provider.get("providerId"))
          || !"ENVIRONMENT".equals(provider.get("source"))
          || !Boolean.TRUE.equals(provider.get("readOnly"))
          || !(provider.get("revision") instanceof String)
          || !Set.of("ONLINE", "OLLAMA").contains(provider.get("kind"))
          || !(provider.get("configured") instanceof Boolean)
          || !(provider.get("enabled") instanceof Boolean)
          || !(provider.get("hasApiKey") instanceof Boolean))
        throw new ApiException(
            HttpStatus.BAD_GATEWAY, "LLM_ERROR", "Trạng thái provider sai contract.");
      return provider;
    } catch (ApiException unavailable) {
      if (required) throw unavailable;
      return null;
    }
  }

  private void admin() {
    if (!store.admin())
      throw new ApiException(
          HttpStatus.FORBIDDEN, "FORBIDDEN", "Chỉ ADMIN được cấu hình provider.");
  }

  private Map<String, Object> validate(Map<String, Object> body, boolean update) {
    RegistryController.fields(
        body,
        update
            ? Set.of(
                "name", "kind", "baseUrl", "model", "enabled", "apiKey", "revision", "clearApiKey")
            : Set.of("name", "kind", "baseUrl", "model", "enabled", "apiKey"));
    String name = ModelProviderPolicy.text(body.get("name"), 120, "Tên provider");
    String kind = Objects.toString(body.get("kind"), "");
    if (!Set.of("ONLINE", "OLLAMA").contains(kind) || !(body.get("enabled") instanceof Boolean))
      throw ApiException.bad("Loại/trạng thái provider không hợp lệ.");
    String url = policy.url(kind, ModelProviderPolicy.text(body.get("baseUrl"), 2048, "URL"));
    String model = ModelProviderPolicy.model(body.get("model"));
    if (body.containsKey("apiKey")) {
      if (!(body.get("apiKey") instanceof String key)
          || key.isBlank()
          || key.length() > 8192
          || key.chars()
              .anyMatch(
                  c ->
                      Character.isISOControl(c)
                          || Character.isWhitespace(c)
                          || Character.isSpaceChar(c)))
        throw ApiException.bad("API key tối đa8192 ký tự, không chứa control hoặc khoảng trắng.");
      if (name.contains(key) || url.contains(key) || model.contains(key))
        throw ApiException.bad("API key chỉ được nhập trong trường bí mật.");
    }
    if (body.containsKey("clearApiKey") && !(body.get("clearApiKey") instanceof Boolean))
      throw ApiException.bad("clearApiKey phải là boolean.");
    if (Boolean.TRUE.equals(body.get("clearApiKey")) && body.containsKey("apiKey"))
      throw ApiException.bad("Không vừa thay vừa xóa API key.");
    return Json.obj(
        "name", name, "kind", kind, "baseUrl", url, "model", model, "enabled", body.get("enabled"));
  }

  @Transactional
  public Map<String, Object> create(Map<String, Object> body) {
    admin();
    secrets.requireAvailable();
    var profile = validate(body, false);
    String id = Json.id("provider");
    String cipher =
        body.containsKey("apiKey") ? secrets.encrypt(id, (String) body.get("apiKey")) : null;
    requireKey(profile, cipher);
    store
        .jdbc()
        .update(
            "INSERT INTO"
                + " model_provider(id,revision,name,kind,base_url,model,enabled,encrypted_api_key)"
                + " VALUES (?,1,?,?,?,?,?,?)",
            id,
            profile.get("name"),
            profile.get("kind"),
            profile.get("baseUrl"),
            profile.get("model"),
            profile.get("enabled"),
            cipher);
    store.audit("MODEL_PROVIDER_CREATE", id, Json.obj("revision", "1"));
    return summary(profile(id, false));
  }

  @Transactional
  public Map<String, Object> update(String id, Map<String, Object> body) {
    admin();
    secrets.requireAvailable();
    if ("environment".equals(id)) throw ApiException.bad("Cấu hình môi trường chỉ đọc.");
    var updated = validate(body, true);
    if (!(body.get("revision") instanceof String revision) || !revision.matches("[1-9][0-9]{0,18}"))
      throw ApiException.bad("Revision phải là chuỗi số nguyên dương hiện tại.");
    String defaultProvider = defaultId(true);
    var current = profile(id, true);
    if (!revision.equals(current.get("revision")))
      throw conflict("Cấu hình đã thay đổi; tải lại trước khi lưu.");
    boolean destinationChanged =
        !updated.get("baseUrl").equals(current.get("baseUrl"))
            || !updated.get("kind").equals(current.get("kind"));
    if (destinationChanged
        && current.get("encryptedApiKey") != null
        && !body.containsKey("apiKey")
        && !Boolean.TRUE.equals(body.get("clearApiKey")))
      throw ApiException.bad("Đổi đích kết nối phải thay hoặc xóa API key tường minh.");
    String previousCipher = (String) current.get("encryptedApiKey");
    String previousKey = null;
    if (previousCipher != null) {
      try {
        previousKey = secrets.decrypt(id, previousCipher);
      } catch (ApiException unavailable) {
        // An explicit replacement/clear must still recover a profile with unreadable ciphertext.
        if (!body.containsKey("apiKey") && !Boolean.TRUE.equals(body.get("clearApiKey")))
          throw unavailable;
      }
    }
    rejectSecretMetadata(updated, previousKey);
    String cipher = Boolean.TRUE.equals(body.get("clearApiKey")) ? null : previousCipher;
    if (body.containsKey("apiKey")) cipher = secrets.encrypt(id, (String) body.get("apiKey"));
    if (cipher != null) rejectSecretMetadata(updated, secrets.decrypt(id, cipher));

    if (id.equals(defaultProvider)
        && (!Boolean.TRUE.equals(updated.get("enabled"))
            || ("ONLINE".equals(updated.get("kind")) && cipher == null)))
      throw conflict("Đổi provider mặc định trước khi tắt hoặc xóa key profile này.");
    requireKey(updated, cipher);
    long next = Long.parseLong(revision) + 1;
    store
        .jdbc()
        .update(
            "UPDATE model_provider SET"
                + " revision=?,name=?,kind=?,base_url=?,model=?,enabled=?,encrypted_api_key=?,updated_at=now()"
                + " WHERE id=?",
            next,
            updated.get("name"),
            updated.get("kind"),
            updated.get("baseUrl"),
            updated.get("model"),
            updated.get("enabled"),
            cipher,
            id);
    store.audit("MODEL_PROVIDER_UPDATE", id, Json.obj("revision", Long.toString(next)));
    return summary(profile(id, false));
  }

  private static void rejectSecretMetadata(Map<String, Object> profile, String key) {
    if (key == null) return;
    for (String field : List.of("name", "baseUrl", "model"))
      if (Json.str(profile, field).contains(key))
        throw ApiException.bad("API key chỉ được nhập trong trường bí mật.");
  }

  private static void requireKey(Map<String, Object> profile, String cipher) {
    if (Boolean.TRUE.equals(profile.get("enabled"))
        && "ONLINE".equals(profile.get("kind"))
        && cipher == null) throw ApiException.bad("Provider ONLINE đang bật cần API key.");
  }

  @Transactional
  public Map<String, Object> setDefault(Map<String, Object> body) {
    admin();
    RegistryController.fields(body, Set.of("providerId"));
    if (!body.containsKey("providerId")
        || (body.get("providerId") != null && !(body.get("providerId") instanceof String)))
      throw ApiException.bad("providerId phải là string hoặc null.");
    defaultId(true);
    String id = (String) body.get("providerId");
    if (id != null) select(id);
    String stored = "environment".equals(id) ? null : id;
    store.jdbc().update("UPDATE model_provider_default SET provider_id=? WHERE id=1", stored);
    store.audit("MODEL_PROVIDER_DEFAULT", stored == null ? "environment" : stored);
    return list();
  }

  @Transactional
  public void delete(String id) {
    admin();
    if ("environment".equals(id)) throw ApiException.bad("Cấu hình môi trường chỉ đọc.");
    if (id.equals(defaultId(true))) throw conflict("Đổi provider mặc định trước khi xóa.");
    profile(id, true);
    store.jdbc().update("DELETE FROM model_provider WHERE id=?", id);
    store.audit("MODEL_PROVIDER_DELETE", id);
  }

  public Selection selectDefault() {
    String id = defaultId(false);
    return select(id == null ? "environment" : id);
  }

  public Selection select(String id) {
    if ("environment".equals(id)) {
      var value = environment(true);
      if (value == null
          || !Boolean.TRUE.equals(value.get("enabled"))
          || !Boolean.TRUE.equals(value.get("configured"))) throw unavailable();
      return new Selection(snapshot(value), null);
    }
    var profile = profile(id, false);
    if (!Boolean.TRUE.equals(profile.get("enabled"))) throw unavailable();
    secrets.requireAvailable();
    String url = policy.url(Json.str(profile, "kind"), Json.str(profile, "baseUrl"));
    String encrypted = (String) profile.get("encryptedApiKey");
    requireKey(profile, encrypted);
    var config =
        Json.obj(
            "kind",
            profile.get("kind"),
            "baseUrl",
            url,
            "model",
            profile.get("model"),
            "structuredOutput",
            "OLLAMA".equals(profile.get("kind")));
    if (encrypted != null) config.put("apiKey", secrets.decrypt(id, encrypted));
    return new Selection(snapshot(profile), config);
  }

  private static Map<String, Object> snapshot(Map<String, Object> profile) {
    var value = new LinkedHashMap<String, Object>();
    for (String field : List.of("providerId", "revision", "name", "kind", "model"))
      value.put(field, profile.get(field));
    value.put("source", profile.getOrDefault("source", "APPLICATION"));
    return value;
  }

  /** Deliberately no generated toString: credentials never belong in logs or history. */
  public static final class Selection {
    private final Map<String, Object> snapshot;
    private final Map<String, Object> config;

    Selection(Map<String, Object> snapshot, Map<String, Object> config) {
      this.snapshot = snapshot;
      this.config = config;
    }

    public Map<String, Object> snapshot() {
      return new LinkedHashMap<>(snapshot);
    }

    public void apply(Map<String, Object> request) {
      if (config != null) request.put("modelConfig", new LinkedHashMap<>(config));
    }
  }

  private static ApiException conflict(String message) {
    return new ApiException(HttpStatus.CONFLICT, "MODEL_PROVIDER_CONFLICT", message);
  }

  private static ApiException unavailable() {
    return new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "MODEL_PROVIDER_UNAVAILABLE",
        "Provider chưa được bật/cấu hình; hãy chọn model trong Settings.");
  }
}
