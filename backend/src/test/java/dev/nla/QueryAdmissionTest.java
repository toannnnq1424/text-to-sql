package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;
import org.springframework.mock.env.MockEnvironment;

class QueryAdmissionTest {
  static QueryAdmission gate(int maximum) {
    return new QueryAdmission(
        new MockEnvironment().withProperty("NLA_QUERY_MAX_CONCURRENT", Integer.toString(maximum)));
  }

  @ParameterizedTest
  @ValueSource(strings = {"0", "65", "-1", "", "eight", "1.5", "2147483648", " 8"})
  void invalidConfigurationCannotStartAnUnlimitedService(String value) {
    var error =
        assertThrows(
            IllegalStateException.class,
            () ->
                new QueryAdmission(
                    new MockEnvironment().withProperty("NLA_QUERY_MAX_CONCURRENT", value)));
    assertTrue(error.getMessage().contains("NLA_QUERY_MAX_CONCURRENT"));
  }

  @Test
  void defaultAndMaximumAreBoundedAndClosingALeaseTwiceDoesNotAddCapacity() {
    for (int maximum : new int[] {8, 64}) {
      var admission = maximum == 8 ? new QueryAdmission(new MockEnvironment()) : gate(maximum);
      var leases = new ArrayList<QueryAdmission.Lease>();
      try {
        for (int index = 0; index < maximum; index++) leases.add(admission.enter());
        assertEquals("QUERY_BUSY", assertThrows(ApiException.class, admission::enter).code);
      } finally {
        leases.forEach(QueryAdmission.Lease::close);
      }
      leases.getFirst().close();
      var fresh = new ArrayList<QueryAdmission.Lease>();
      try {
        for (int index = 0; index < maximum; index++) fresh.add(admission.enter());
        assertEquals("QUERY_BUSY", assertThrows(ApiException.class, admission::enter).code);
      } finally {
        fresh.forEach(QueryAdmission.Lease::close);
      }
    }
  }

  @Test
  void concurrentCallersCannotExceedCapacityOrAccumulateWaiters() throws Exception {
    var admission = gate(3);
    var start = new CountDownLatch(1);
    var attempted = new CountDownLatch(20);
    var release = new CountDownLatch(1);
    var entered = new AtomicInteger();
    var rejected = new AtomicInteger();
    try (var pool = Executors.newFixedThreadPool(20)) {
      var tasks = new ArrayList<java.util.concurrent.Future<?>>();
      for (int index = 0; index < 20; index++) {
        tasks.add(
            pool.submit(
                () -> {
                  try {
                    assertTrue(start.await(5, TimeUnit.SECONDS));
                    try (var lease = admission.enter()) {
                      entered.incrementAndGet();
                      attempted.countDown();
                      assertTrue(release.await(5, TimeUnit.SECONDS));
                    }
                  } catch (ApiException busy) {
                    assertEquals(HttpStatus.TOO_MANY_REQUESTS, busy.status);
                    assertEquals("QUERY_BUSY", busy.code);
                    rejected.incrementAndGet();
                    attempted.countDown();
                  } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    fail(interrupted);
                  }
                }));
      }
      start.countDown();
      try {
        assertTrue(attempted.await(5, TimeUnit.SECONDS), "Admission must not wait for held leases");
        assertEquals(3, entered.get());
        assertEquals(17, rejected.get());
      } finally {
        release.countDown();
      }
      for (var task : tasks) task.get(5, TimeUnit.SECONDS);
    }
    try (var lease = admission.enter()) {
      assertNotNull(lease);
    }
  }

  @Test
  void anInterruptedCallerCannotStartWorkAndBusyEnvelopeIsSafelyRetryable() {
    var admission = gate(1);
    Thread.currentThread().interrupt();
    try {
      assertEquals("QUERY_TIMEOUT", assertThrows(ApiException.class, admission::enter).code);
      assertTrue(Thread.currentThread().isInterrupted());
      assertEquals(
          "QUERY_TIMEOUT", assertThrows(ApiException.class, () -> QueryDeadline.seconds(10)).code);
    } finally {
      Thread.interrupted();
    }
    try (var lease = admission.enter()) {
      var busy = assertThrows(ApiException.class, admission::enter);
      var response = new Errors().api(busy);
      var body = Json.map(Json.map(response.getBody()).get("error"));
      assertEquals(429, response.getStatusCode().value());
      assertEquals(true, body.get("retryable"));
      assertEquals(Json.obj(), body.get("details"));
      assertNotNull(body.get("correlationId"));
    }
    assertEquals(false, Errors.body("FORBIDDEN", "Denied", Json.obj()).get("retryable"));
  }
}
