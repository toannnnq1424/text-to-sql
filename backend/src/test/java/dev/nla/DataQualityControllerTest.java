package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.context.SecurityContextHolder;

class DataQualityControllerTest {
  @Configuration(proxyBeanMethods = false)
  @EnableMethodSecurity
  static class Config {
    @Bean
    DataQualityService service() {
      return mock(DataQualityService.class);
    }

    @Bean
    DataQualityController controller(DataQualityService service) {
      return new DataQualityController(service);
    }
  }

  @Test
  void authenticatedReadsAndOperatorAdminOnlyMutationsUseMethodSecurityProxy() {
    try (var context = new AnnotationConfigApplicationContext(Config.class)) {
      var controller = context.getBean(DataQualityController.class);
      var service = context.getBean(DataQualityService.class);
      SecurityContextHolder.clearContext();
      assertThrows(
          AuthenticationCredentialsNotFoundException.class, () -> controller.rules("dataset"));
      for (String role : List.of("VIEWER", "ANALYST")) {
        DataQualityExecutionTest.role("reader", role);
        controller.rules("dataset");
        assertThrows(AccessDeniedException.class, () -> controller.save("dataset", Json.obj()));
        assertThrows(AccessDeniedException.class, () -> controller.run("dataset", Json.obj()));
      }
      for (String role : List.of("OPERATOR", "ADMIN")) {
        DataQualityExecutionTest.role("writer", role);
        controller.save("dataset", Json.obj());
        assertEquals(202, controller.run("dataset", Json.obj()).getStatusCode().value());
      }
      verify(service, times(2)).save("dataset", Json.obj());
      verify(service, times(2)).run("dataset", Json.obj());
    } finally {
      SecurityContextHolder.clearContext();
    }
  }
}
