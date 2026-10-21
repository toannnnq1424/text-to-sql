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
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

class ModelProviderControllerTest {
  @Configuration(proxyBeanMethods = false)
  @EnableMethodSecurity
  static class ConfigurationForTest {
    @Bean
    ModelProviderService service() {
      return mock(ModelProviderService.class);
    }

    @Bean
    ModelProviderController controller(ModelProviderService service) {
      return new ModelProviderController(service);
    }
  }

  @Test
  void onlyAdministratorsMayMutateGlobalProfiles() {
    try (var context = new AnnotationConfigApplicationContext(ConfigurationForTest.class)) {
      var controller = context.getBean(ModelProviderController.class);
      var service = context.getBean(ModelProviderService.class);
      assertThrows(
          AuthenticationCredentialsNotFoundException.class, () -> controller.create(Json.obj()));
      for (String role : List.of("VIEWER", "ANALYST", "OPERATOR")) {
        SecurityContextHolder.getContext()
            .setAuthentication(
                new UsernamePasswordAuthenticationToken(
                    "reader", null, List.of(new SimpleGrantedAuthority("ROLE_" + role))));
        assertThrows(AccessDeniedException.class, () -> controller.create(Json.obj()));
        assertThrows(AccessDeniedException.class, () -> controller.update("id", Json.obj()));
        assertThrows(
            AccessDeniedException.class,
            () -> controller.defaultProvider(Json.obj("providerId", null)));
        assertThrows(AccessDeniedException.class, () -> controller.delete("id"));
      }
      verifyNoInteractions(service);
      SecurityContextHolder.getContext()
          .setAuthentication(
              new UsernamePasswordAuthenticationToken(
                  "admin", null, List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));
      when(service.create(Json.obj())).thenReturn(Json.obj("revision", "1"));
      assertEquals(201, controller.create(Json.obj()).getStatusCode().value());
      controller.list();
      verify(service).list();
    } finally {
      SecurityContextHolder.clearContext();
    }
  }
}
