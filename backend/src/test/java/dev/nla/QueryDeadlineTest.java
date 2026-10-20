package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class QueryDeadlineTest {
  @Test
  void queryBudgetCapsEveryDownstreamCallAndIsClearedBetweenRequests() {
    assertEquals(120, QueryDeadline.seconds(120));
    QueryDeadline.start();
    try {
      assertTrue(QueryDeadline.seconds(120) <= 60);
      assertEquals(3, QueryDeadline.seconds(3));
    } finally {
      QueryDeadline.clear();
    }
    assertEquals(120, QueryDeadline.seconds(120));
  }
}
