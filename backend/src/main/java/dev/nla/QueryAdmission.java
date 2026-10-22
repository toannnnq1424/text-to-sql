package dev.nla;

import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Bounds complete query pipelines without retaining a waiting queue or request data. */
@Component
public final class QueryAdmission {
  private final Semaphore permits;

  public QueryAdmission(Environment environment) {
    int limit;
    try {
      limit = Integer.parseInt(environment.getProperty("NLA_QUERY_MAX_CONCURRENT", "8"));
      if (limit < 1 || limit > 64) throw new NumberFormatException();
    } catch (NumberFormatException invalid) {
      throw new IllegalStateException("NLA_QUERY_MAX_CONCURRENT must be an integer from 1 to 64.");
    }
    permits = new Semaphore(limit);
  }

  Lease enter() {
    if (Thread.currentThread().isInterrupted())
      throw new ApiException(
          HttpStatus.GATEWAY_TIMEOUT, "QUERY_TIMEOUT", "Yêu cầu truy vấn đã dừng.");
    if (!permits.tryAcquire())
      throw new ApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          "QUERY_BUSY",
          "Hệ thống đang xử lý đủ số truy vấn đồng thời; vui lòng thử lại sau.");
    return new Lease(permits);
  }

  static final class Lease implements AutoCloseable {
    private final Semaphore permits;
    private final AtomicBoolean closed = new AtomicBoolean();

    private Lease(Semaphore permits) {
      this.permits = permits;
    }

    @Override
    public void close() {
      if (closed.compareAndSet(false, true)) permits.release();
    }
  }
}
