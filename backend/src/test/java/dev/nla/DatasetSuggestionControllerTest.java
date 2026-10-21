package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

class DatasetSuggestionControllerTest {
  @Configuration(proxyBeanMethods = false)
  @EnableMethodSecurity
  static class MethodSecurityContext {
    @Bean
    DatasetSuggestionService service() {
      return mock(DatasetSuggestionService.class);
    }

    @Bean
    DatasetSuggestionController controller(DatasetSuggestionService service) {
      return new DatasetSuggestionController(service);
    }
  }

  @Test
  void applicationContextCanProxySecuredControllerAndEnforceAdministratorRole() {
    try (var context = new AnnotationConfigApplicationContext(MethodSecurityContext.class)) {
      var controller = context.getBean(DatasetSuggestionController.class);
      var service = context.getBean(DatasetSuggestionService.class);
      assertTrue(AopUtils.isAopProxy(controller));
      var request = Json.obj("instruction", "Describe existing metadata");
      assertThrows(
          AuthenticationCredentialsNotFoundException.class,
          () -> controller.assist("dataset", request));
      verifyNoInteractions(service);
      var authentication =
          new UsernamePasswordAuthenticationToken(
              "admin", "unused", List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
      SecurityContextHolder.getContext().setAuthentication(authentication);
      var expected = Json.obj("model", "configured");
      when(service.assist("dataset", request)).thenReturn(expected);
      assertSame(expected, controller.assist("dataset", request));
    } finally {
      SecurityContextHolder.clearContext();
    }
  }
}
