package dev.nla;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;

public final class Json {
  private static final ObjectMapper MAPPER =
      new ObjectMapper()
          .findAndRegisterModules()
          .enable(com.fasterxml.jackson.databind.DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);

  private Json() {}

  public static Map<String, Object> obj(Object... pairs) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) out.put((String) pairs[i], pairs[i + 1]);
    return out;
  }

  public static String write(Object value) {
    try {
      return MAPPER.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalArgumentException("Cannot serialize application metadata", e);
    }
  }

  public static Map<String, Object> read(String value) {
    try {
      return MAPPER.readValue(value, new TypeReference<>() {});
    } catch (Exception e) {
      throw new IllegalStateException("Invalid persisted metadata", e);
    }
  }

  @SuppressWarnings("unchecked")
  public static Map<String, Object> map(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  @SuppressWarnings("unchecked")
  public static List<Map<String, Object>> objects(Object value) {
    return value instanceof List<?> l ? l.stream().map(Json::map).toList() : List.of();
  }

  public static String str(Map<String, Object> map, String key) {
    return Objects.toString(map.get(key), "");
  }

  public static String id(String prefix) {
    return prefix + "-" + UUID.randomUUID();
  }
}
