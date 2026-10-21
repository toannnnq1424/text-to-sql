package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import dev.nla.warehouse.Adapters;
import dev.nla.warehouse.WarehouseAdapter;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;

class DataQualityAsyncTest {
  static class Fixture implements AutoCloseable {
    final Store store = mock(Store.class);
    final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    final CatalogService catalog = mock(CatalogService.class);
    final Adapters adapters = mock(Adapters.class);
    final WarehouseAdapter adapter = mock(WarehouseAdapter.class);
    final Map<String, Object> warehouse =
        Json.obj("warehouseId", "warehouse", "engine", "POSTGRESQL", "status", "ACTIVE");
    final Map<String, Object> dataset =
        Json.obj("warehouseId", "warehouse", "datasetId", "dataset", "status", "ACTIVE");
    final Map<String, Map<String, Object>> persisted = new ConcurrentHashMap<>();
    final DataQualityService service;

    Fixture(List<Map<String, Object>> rules) throws Exception {
      this(rules, Duration.ofSeconds(120));
    }

    Fixture(List<Map<String, Object>> rules, Duration budget) throws Exception {
      when(store.jdbc()).thenReturn(jdbc);
      when(store.dataset("dataset")).thenReturn(dataset);
      when(store.warehouse("warehouse")).thenReturn(warehouse);
      when(store.credential("warehouse")).thenReturn("env:TEST_READER");
      when(adapters.password("env:TEST_READER")).thenReturn("private-test-only");
      when(adapters.get(warehouse)).thenReturn(adapter);
      when(adapter.engine()).thenReturn("POSTGRESQL");
      when(adapter.quoteIdentifier(anyString())).thenAnswer(c -> "\"" + c.getArgument(0) + "\"");
      when(catalog.tables("dataset")).thenReturn(List.of(DataQualityRulesTest.table()));
      doAnswer(
              c -> {
                var document = Json.read(Json.write(c.getArgument(2)));
                persisted.put(c.getArgument(0), document);
                return null;
              })
          .when(store)
          .run(anyString(), eq("DATA_QUALITY"), anyMap());
      doAnswer(
              call -> {
                Object[] a = call.getArguments();
                if (call.<String>getArgument(0).startsWith("UPDATE operation_run")) {
                  String time = (String) a[1];
                  var error = Json.read((String) a[2]);
                  String id = a.length == 5 ? (String) a[3] : null;
                  for (var doc : persisted.values()) {
                    if ("RUNNING".equals(doc.get("status"))
                        && (id == null || id.equals(doc.get("runId")))) {
                      doc.put("status", "ERROR");
                      doc.put("completedAt", time);
                      doc.put("error", error);
                    }
                  }
                }
                return 1;
              })
          .when(jdbc)
          .update(anyString(), any(Object[].class));
      service = spy(new DataQualityService(store, catalog, adapters, new SqlGuard(), budget));
      doReturn(Json.obj("datasetId", "dataset", "revision", "7", "rules", rules))
          .when(service)
          .rules("dataset");
      DataQualityExecutionTest.role("quality-operator", "OPERATOR");
    }

    Map<String, Object> terminal(String id) throws Exception {
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      do {
        var r = persisted.get(id);
        if (r != null && !r.get("status").equals("RUNNING")) return r;
        Thread.sleep(10);
      } while (System.nanoTime() < deadline);
      throw new AssertionError("No terminal quality run");
    }

    @Override
    public void close() {
      service.stop();
      SecurityContextHolder.clearContext();
    }
  }

  @Test
  void returnsPersistedSnapshotBeforeWarehouseAndPropagatesPrincipal() throws Exception {
    var original = DataQualityRulesTest.rule("ROW_COUNT");
    try (var f = new Fixture(List.of(original))) {
      var entered = new CountDownLatch(1);
      var release = new CountDownLatch(1);
      var principal = new AtomicReference<String>();
      when(f.adapter.executeReadOnlyQuery(
              anyMap(), anyString(), anyString(), eq(1), eq(16384), eq(15)))
          .thenAnswer(
              call -> {
                entered.countDown();
                assertTrue(release.await(3, TimeUnit.SECONDS));
                principal.set(SecurityContextHolder.getContext().getAuthentication().getName());
                return Json.obj(
                    "rows",
                    List.of(Json.obj("checked_rows", "6", "violations", "0")),
                    "truncated",
                    false);
              });
      try {
        var accepted = f.service.run("dataset", Json.obj());
        assertEquals("RUNNING", accepted.get("status"));
        assertTrue(f.persisted.containsKey(accepted.get("runId")));
        assertTrue(entered.await(2, TimeUnit.SECONDS));
        original.put("min", "999");
        release.countDown();
        var finished = f.terminal(Json.str(accepted, "runId"));
        assertEquals("PASSED", finished.get("status"));
        assertEquals("7", finished.get("revision"));
        assertEquals("0", Json.objects(finished.get("rules")).getFirst().get("min"));
        assertEquals("quality-operator", principal.get());
        assertEquals("RUNNING", accepted.get("status"));
        assertFalse(Json.write(finished).contains("private-test-only"));
      } finally {
        release.countDown();
      }
    }
  }

  @Test
  void partialResultsSurviveTimeoutAndUnexecutedCountsAreNull() throws Exception {
    var first = DataQualityRulesTest.rule("NOT_NULL");
    var second = DataQualityRulesTest.rule("UNIQUE");
    second.put("ruleId", "second");
    try (var f = new Fixture(List.of(first, second))) {
      var calls = new AtomicInteger();
      when(f.adapter.executeReadOnlyQuery(
              anyMap(), anyString(), anyString(), anyInt(), anyInt(), anyInt()))
          .thenAnswer(
              call -> {
                if (calls.getAndIncrement() == 0)
                  return Json.obj(
                      "rows", List.of(Json.obj("checked_rows", "6", "violations", "1")));
                throw new SQLTimeoutException("private database detail");
              });
      var finished = f.terminal(Json.str(f.service.run("dataset", Json.obj()), "runId"));
      assertEquals("ERROR", finished.get("status"));
      assertEquals("QUALITY_TIMEOUT", Json.map(finished.get("error")).get("code"));
      var checks = Json.objects(finished.get("checks"));
      assertEquals(2, checks.size());
      assertEquals("FAILED", checks.getFirst().get("status"));
      assertEquals("1", checks.getFirst().get("violations"));
      assertEquals("ERROR", checks.getLast().get("status"));
      assertNull(checks.getLast().get("checkedRows"));
      assertNull(checks.getLast().get("violations"));
      assertFalse(Json.write(finished).contains("private database detail"));
    }
  }

  @Test
  void boundedQueueRejectsBeforeAnExtraRunAndDoesNotCallWarehouseForEmptyRules() throws Exception {
    try (var f = new Fixture(List.of(DataQualityRulesTest.rule("ROW_COUNT")))) {
      var entered = new CountDownLatch(2);
      var release = new CountDownLatch(1);
      when(f.adapter.executeReadOnlyQuery(
              anyMap(), anyString(), anyString(), anyInt(), anyInt(), anyInt()))
          .thenAnswer(
              call -> {
                entered.countDown();
                release.await(5, TimeUnit.SECONDS);
                return Json.obj("rows", List.of(Json.obj("checked_rows", "0", "violations", "0")));
              });
      try {
        f.service.run("dataset", Json.obj());
        f.service.run("dataset", Json.obj());
        assertTrue(entered.await(2, TimeUnit.SECONDS));
        for (int i = 0; i < 8; i++) f.service.run("dataset", Json.obj());
        var busy = assertThrows(ApiException.class, () -> f.service.run("dataset", Json.obj()));
        assertEquals("QUALITY_BUSY", busy.code);
        assertEquals(503, busy.status.value());
        assertEquals(10, f.persisted.size());
      } finally {
        release.countDown();
      }
    }
    try (var f = new Fixture(List.of())) {
      assertThrows(ApiException.class, () -> f.service.run("dataset", Json.obj()));
      verifyNoInteractions(f.adapter);
    }
  }

  @Test
  void restartMarksIncompleteWithoutReexecutingAndOwnershipIsChecked() throws Exception {
    try (var f = new Fixture(List.of(DataQualityRulesTest.rule("ROW_COUNT")))) {
      var interrupted =
          Json.obj(
              "runId",
              "interrupted",
              "status",
              "RUNNING",
              "checks",
              new ArrayList<>(
                  List.of(Json.obj("ruleId", "finished", "status", "PASSED", "checkedRows", "6"))));
      f.persisted.put("interrupted", interrupted);
      f.service.recover();
      assertEquals("ERROR", interrupted.get("status"));
      assertEquals("QUALITY_INTERRUPTED", Json.map(interrupted.get("error")).get("code"));
      assertEquals(1, Json.objects(interrupted.get("checks")).size());
      verifyNoInteractions(f.adapter);
      when(f.store.run("owned-by-other", "DATA_QUALITY"))
          .thenReturn(Json.obj("datasetId", "other"));
      assertEquals(
          "RESOURCE_NOT_FOUND",
          assertThrows(ApiException.class, () -> f.service.get("dataset", "owned-by-other")).code);
    }
  }

  @Test
  void shutdownCannotTurnLastInFlightQueryIntoSuccess() throws Exception {
    try (var f = new Fixture(List.of(DataQualityRulesTest.rule("ROW_COUNT")))) {
      var entered = new CountDownLatch(1);
      var release = new CountDownLatch(1);
      var returned = new CountDownLatch(1);
      when(f.adapter.executeReadOnlyQuery(
              anyMap(), anyString(), anyString(), anyInt(), anyInt(), anyInt()))
          .thenAnswer(
              call -> {
                entered.countDown();
                while (release.getCount() > 0) {
                  try {
                    release.await(100, TimeUnit.MILLISECONDS);
                  } catch (InterruptedException ignored) {
                  }
                }
                returned.countDown();
                return Json.obj("rows", List.of(Json.obj("checked_rows", "6", "violations", "0")));
              });
      try {
        var accepted = f.service.run("dataset", Json.obj());
        String id = Json.str(accepted, "runId");
        assertTrue(entered.await(2, TimeUnit.SECONDS));
        f.service.stop();
        assertEquals("ERROR", f.terminal(id).get("status"));
        release.countDown();
        assertTrue(returned.await(2, TimeUnit.SECONDS));
        Thread.sleep(100);
        var terminal = f.persisted.get(id);
        assertEquals("ERROR", terminal.get("status"));
        assertEquals("QUALITY_INTERRUPTED", Json.map(terminal.get("error")).get("code"));
      } finally {
        release.countDown();
      }
    }
  }

  @Test
  void queueWaitIsInsideRunDeadlineAndExpiredQueuedJobNeverCallsWarehouse() throws Exception {
    try (var f =
        new Fixture(List.of(DataQualityRulesTest.rule("ROW_COUNT")), Duration.ofSeconds(2))) {
      var entered = new CountDownLatch(2);
      var release = new CountDownLatch(1);
      var calls = new AtomicInteger();
      when(f.adapter.executeReadOnlyQuery(
              anyMap(), anyString(), anyString(), anyInt(), anyInt(), anyInt()))
          .thenAnswer(
              call -> {
                calls.incrementAndGet();
                entered.countDown();
                while (release.getCount() > 0) {
                  try {
                    release.await(100, TimeUnit.MILLISECONDS);
                  } catch (InterruptedException ignored) {
                  }
                }
                throw new SQLException("Private error after deadline cancellation");
              });
      try {
        var first = f.service.run("dataset", Json.obj());
        f.service.run("dataset", Json.obj());
        assertTrue(entered.await(1, TimeUnit.SECONDS));
        var queued = f.service.run("dataset", Json.obj());
        var expired = f.terminal(Json.str(queued, "runId"));
        assertEquals("ERROR", expired.get("status"));
        assertEquals("QUALITY_TIMEOUT", Json.map(expired.get("error")).get("code"));
        assertEquals(0, Json.objects(expired.get("checks")).size());
        assertEquals(2, calls.get());
        release.countDown();
        verify(f.store, timeout(2000).times(2))
            .audit(eq("QUALITY_RUN_COMPLETED"), anyString(), anyMap());
        assertEquals(
            "QUALITY_TIMEOUT",
            Json.map(f.persisted.get(first.get("runId")).get("error")).get("code"));
      } finally {
        release.countDown();
      }
    }
  }
}
