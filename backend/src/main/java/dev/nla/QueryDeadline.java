package dev.nla;

import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;

/** One monotonic request budget shared by metadata, AI, planning and database calls. */
final class QueryDeadline {
  private static final ThreadLocal<Long> DEADLINE = new ThreadLocal<>();

  private QueryDeadline() {}

  static void start() {
    DEADLINE.set(System.nanoTime() + TimeUnit.SECONDS.toNanos(60));
  }

  static void clear() {
    DEADLINE.remove();
  }

  static int seconds(int configured) {
    Long deadline = DEADLINE.get();
    if (deadline == null) return configured;
    long remaining = TimeUnit.NANOSECONDS.toSeconds(deadline - System.nanoTime());
    if (remaining < 1)
      throw new ApiException(
          HttpStatus.GATEWAY_TIMEOUT, "QUERY_TIMEOUT", "Truy vấn vượt thời gian toàn tác vụ.");
    return (int) Math.min(configured, remaining);
  }
}
