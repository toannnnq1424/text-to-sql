package dev.nla;

import java.util.*;

public final class Page {
  private Page() {}

  public static int number(Map<String, String> p, String key, int fallback, int max) {
    String value = p.get(key);
    if (value == null) return fallback;
    try {
      int n = Integer.parseInt(value);
      if (n < 1 || n > max) throw ApiException.bad("Phân trang không hợp lệ.");
      return n;
    } catch (NumberFormatException e) {
      throw ApiException.bad("Phân trang không hợp lệ.");
    }
  }

  public static Map<String, Object> of(
      List<Map<String, Object>> rows,
      Map<String, String> p,
      String defaultSort,
      Set<String> sortKeys) {
    int page = number(p, "page", 1, 1000000), size = number(p, "pageSize", 20, 100);
    String sort = p.getOrDefault("sort", defaultSort);
    if (!sortKeys.contains(sort)) throw ApiException.bad("Trường sắp xếp không hợp lệ.");
    String direction = p.getOrDefault("direction", "DESC");
    if (!Set.of("ASC", "DESC").contains(direction))
      throw ApiException.bad("Thứ tự sắp xếp không hợp lệ.");
    String search = p.getOrDefault("search", "").toLowerCase(Locale.ROOT);
    var filtered =
        rows.stream()
            .filter(
                row ->
                    search.isBlank()
                        || Json.write(row).toLowerCase(Locale.ROOT).contains(search)
                        || (row.containsKey("schema")
                            && row.containsKey("name")
                            && (Json.str(row, "schema") + "." + Json.str(row, "name"))
                                .toLowerCase(Locale.ROOT)
                                .contains(search)))
            .filter(
                row ->
                    p.entrySet().stream()
                        .allMatch(
                            e -> {
                              String k = e.getKey(), v = e.getValue();
                              if (v.isBlank()
                                  || Set.of(
                                          "search",
                                          "page",
                                          "pageSize",
                                          "sort",
                                          "direction",
                                          "from",
                                          "to",
                                          "fromDate",
                                          "toDate")
                                      .contains(k)) return true;
                              return !row.containsKey(k)
                                  || Objects.toString(row.get(k), "").equals(v);
                            }))
            .filter(
                row -> {
                  String created =
                      Json.str(row, row.containsKey("createdAt") ? "createdAt" : "startedAt");
                  if (created.isBlank()) return true;
                  try {
                    var t = java.time.Instant.parse(created);
                    return (!p.containsKey("from")
                            || !t.isBefore(java.time.Instant.parse(p.get("from"))))
                        && (!p.containsKey("to")
                            || t.isBefore(java.time.Instant.parse(p.get("to"))));
                  } catch (Exception e) {
                    throw ApiException.bad("Khoảng thời gian không hợp lệ.");
                  }
                })
            .toList();
    Comparator<Map<String, Object>> cmp =
        (a, b) -> {
          Object x = a.get(sort), y = b.get(sort);
          if (x instanceof Number n && y instanceof Number m)
            return Double.compare(n.doubleValue(), m.doubleValue());
          return Objects.toString(x, "").compareToIgnoreCase(Objects.toString(y, ""));
        };
    if (direction.equals("DESC")) cmp = cmp.reversed();
    var ordered = filtered.stream().sorted(cmp.thenComparing(Json::write)).toList();
    long offset = (long) (page - 1) * size;
    return Json.obj(
        "items",
        ordered.stream().skip(offset).limit(size).toList(),
        "page",
        page,
        "pageSize",
        size,
        "totalItems",
        ordered.size(),
        "totalPages",
        (int) Math.ceil((double) ordered.size() / size));
  }
}
