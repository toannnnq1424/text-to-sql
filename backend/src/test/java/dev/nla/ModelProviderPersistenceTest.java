package dev.nla;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.sql.DriverManager;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.EnableTransactionManagement;

/** Actual PostgreSQL/Flyway, isolated random schema; no application or warehouse data mutated. */
@EnabledIfEnvironmentVariable(named = "NLA_INTEGRATION", matches = "true")
class ModelProviderPersistenceTest {
  @Configuration(proxyBeanMethods = false)
  @EnableTransactionManagement
  static class Transactions {
    @Bean
    DataSourceTransactionManager transactionManager(DataSource dataSource) {
      return new DataSourceTransactionManager(dataSource);
    }
  }

  @Test
  void encryptedDurableProfilesRotatePreserveClearAndEnforceDefaultsAndRevisions()
      throws Exception {
    String url = "jdbc:postgresql://127.0.0.1:55432/postgres";
    String password = System.getenv("NLA_PG_ADMIN_PASSWORD");
    String schema = "provider_test_" + UUID.randomUUID().toString().replace("-", "");
    try (var admin = DriverManager.getConnection(url, "nla_provisioner", password)) {
      try {
        admin.createStatement().execute("CREATE SCHEMA " + schema);
        var dataSource =
            new DriverManagerDataSource(
                url + "?currentSchema=" + schema, "nla_provisioner", password);
        Flyway.configure()
            .dataSource(dataSource)
            .schemas(schema)
            .defaultSchema(schema)
            .locations("classpath:db/migration")
            .load()
            .migrate();
        var env =
            new MockEnvironment()
                .withProperty("NLA_MODEL_MASTER_KEY", ModelProviderSecretsTest.master(3))
                .withProperty("NLA_MODEL_PROVIDER_HOSTS", "localhost");
        var ai = mock(AiClient.class);
        when(ai.invoke(eq("model-provider/status"), anyMap(), anyInt()))
            .thenReturn(Json.obj("provider", null));
        try (var context = new AnnotationConfigApplicationContext()) {
          context.register(Transactions.class);
          context.registerBean(DataSource.class, () -> dataSource);
          context.registerBean(JdbcTemplate.class, () -> new JdbcTemplate(dataSource));
          context.registerBean(
              Store.class, () -> new Store(context.getBean(JdbcTemplate.class), false));
          context.registerBean(ModelProviderSecrets.class, () -> new ModelProviderSecrets(env));
          context.registerBean(ModelProviderPolicy.class, () -> new ModelProviderPolicy(env));
          context.registerBean(AiClient.class, () -> ai);
          context.registerBean(ModelProviderService.class);
          context.refresh();
          var service = context.getBean(ModelProviderService.class);
          var jdbc = context.getBean(JdbcTemplate.class);
          SecurityContextHolder.getContext()
              .setAuthentication(
                  new UsernamePasswordAuthenticationToken(
                      "test-admin", null, List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));
          var body =
              Json.obj(
                  "name",
                  "Owned test profile",
                  "kind",
                  "ONLINE",
                  "baseUrl",
                  "http://localhost:19001/v1",
                  "model",
                  "local-test-model",
                  "enabled",
                  true,
                  "apiKey",
                  "test-private-key-original");
          var created = service.create(body);
          String id = Json.str(created, "providerId");
          assertEquals("1", created.get("revision"));
          assertEquals(true, created.get("hasApiKey"));
          String cipher =
              jdbc.queryForObject(
                  "SELECT encrypted_api_key FROM model_provider WHERE id=?", String.class, id);
          assertFalse(cipher.contains("test-private-key-original"));
          assertFalse(Json.write(service.list()).contains("test-private-key"));
          var outgoing = Json.obj();
          service.select(id).apply(outgoing);
          assertEquals(false, Json.map(outgoing.get("modelConfig")).get("structuredOutput"));
          assertEquals(
              "test-private-key-original", Json.map(outgoing.get("modelConfig")).get("apiKey"));
          var recreated =
              new ModelProviderService(
                  new Store(jdbc, false),
                  new ModelProviderSecrets(env),
                  new ModelProviderPolicy(env),
                  ai);
          outgoing.clear();
          recreated.select(id).apply(outgoing);
          assertEquals(
              "test-private-key-original", Json.map(outgoing.get("modelConfig")).get("apiKey"));
          body.remove("apiKey");
          body.put("revision", "1");
          var preserved = service.update(id, body);
          assertEquals("2", preserved.get("revision"));
          assertEquals(
              cipher,
              jdbc.queryForObject(
                  "SELECT encrypted_api_key FROM model_provider WHERE id=?", String.class, id));
          assertEquals(
              "MODEL_PROVIDER_CONFLICT",
              assertThrows(ApiException.class, () -> service.update(id, body)).code);
          body.put("revision", "2");
          for (String field : List.of("name", "baseUrl", "model")) {
            String echoed =
                field.equals("baseUrl")
                    ? "http://localhost:19001/test-private-key-original"
                    : "test-private-key-original";
            var clearEcho = new LinkedHashMap<>(body);
            clearEcho.put(field, echoed);
            clearEcho.put("clearApiKey", true);
            clearEcho.put("enabled", false);
            assertEquals(
                "INVALID_REQUEST",
                assertThrows(ApiException.class, () -> service.update(id, clearEcho)).code);
            var rotateEcho = new LinkedHashMap<>(body);
            rotateEcho.put(field, echoed);
            rotateEcho.put("apiKey", "test-private-key-rotated");
            assertEquals(
                "INVALID_REQUEST",
                assertThrows(ApiException.class, () -> service.update(id, rotateEcho)).code);
          }
          assertEquals(
              cipher,
              jdbc.queryForObject(
                  "SELECT encrypted_api_key FROM model_provider WHERE id=?", String.class, id));
          assertEquals(
              2L,
              jdbc.queryForObject(
                  "SELECT revision FROM model_provider WHERE id=?", Long.class, id));
          assertFalse(Json.write(service.list()).contains("test-private-key"));
          body.put("name", "test-private-key-original");
          assertThrows(ApiException.class, () -> service.update(id, body));
          body.put("name", "Owned test profile");
          body.put("baseUrl", "http://localhost:19002/v1");
          assertThrows(ApiException.class, () -> service.update(id, body));
          body.put("apiKey", "test-private-key-rotated");
          var rotated = service.update(id, body);
          assertEquals("3", rotated.get("revision"));
          outgoing.clear();
          service.select(id).apply(outgoing);
          assertEquals(
              "test-private-key-rotated", Json.map(outgoing.get("modelConfig")).get("apiKey"));
          service.setDefault(Json.obj("providerId", id));
          assertEquals(id, service.selectDefault().snapshot().get("providerId"));
          env.setProperty("NLA_MODEL_PROVIDER_HOSTS", "");
          clearInvocations(ai);
          assertThrows(ApiException.class, service::selectDefault);
          verifyNoInteractions(ai);
          env.setProperty("NLA_MODEL_PROVIDER_HOSTS", "localhost");
          env.setProperty("NLA_MODEL_MASTER_KEY", ModelProviderSecretsTest.master(8));
          assertEquals(
              "MODEL_CONFIGURATION_UNAVAILABLE",
              assertThrows(ApiException.class, () -> service.select(id)).code);
          env.setProperty("NLA_MODEL_MASTER_KEY", ModelProviderSecretsTest.master(3));

          assertEquals(
              "MODEL_PROVIDER_CONFLICT",
              assertThrows(ApiException.class, () -> service.delete(id)).code);
          body.remove("apiKey");
          body.put("revision", "3");
          body.put("enabled", false);
          assertEquals(
              "MODEL_PROVIDER_CONFLICT",
              assertThrows(ApiException.class, () -> service.update(id, body)).code);
          service.setDefault(Json.obj("providerId", null));
          body.put("clearApiKey", true);
          var cleared = service.update(id, body);
          assertEquals(false, cleared.get("hasApiKey"));
          assertNull(
              jdbc.queryForObject(
                  "SELECT encrypted_api_key FROM model_provider WHERE id=?", String.class, id));
          assertThrows(ApiException.class, () -> service.select(id));
          assertEquals(
              0,
              jdbc.queryForObject(
                  "SELECT count(*) FROM audit_event WHERE details::text LIKE '%test-private-key%'",
                  Integer.class));
          service.delete(id);
          assertThrows(ApiException.class, () -> service.select(id));
          var local =
              service.create(
                  Json.obj(
                      "name",
                      "Local test",
                      "kind",
                      "OLLAMA",
                      "baseUrl",
                      "http://localhost:11434/v1",
                      "model",
                      "qwen3:4b",
                      "enabled",
                      true));
          outgoing.clear();
          service.select(Json.str(local, "providerId")).apply(outgoing);
          assertEquals(true, Json.map(outgoing.get("modelConfig")).get("structuredOutput"));
          assertFalse(Json.map(outgoing.get("modelConfig")).containsKey("apiKey"));
          String localId = Json.str(local, "providerId");
          jdbc.update(
              "UPDATE model_provider SET encrypted_api_key=? WHERE id=?", "v1:unreadable", localId);
          var recovery =
              Json.obj(
                  "name",
                  "Local recovered",
                  "kind",
                  "OLLAMA",
                  "baseUrl",
                  "http://localhost:11434/v1",
                  "model",
                  "qwen3:4b",
                  "enabled",
                  true,
                  "revision",
                  "1");
          assertEquals(
              "MODEL_CONFIGURATION_UNAVAILABLE",
              assertThrows(ApiException.class, () -> service.update(localId, recovery)).code);
          recovery.put("clearApiKey", true);
          var recovered = service.update(localId, recovery);
          assertEquals("2", recovered.get("revision"));
          assertEquals(false, recovered.get("hasApiKey"));
          assertNull(
              jdbc.queryForObject(
                  "SELECT encrypted_api_key FROM model_provider WHERE id=?",
                  String.class,
                  localId));
          assertNotNull(service.select(localId));
          service.delete(Json.str(local, "providerId"));
          env.setProperty("NLA_MODEL_MASTER_KEY", "invalid");
          assertEquals(false, service.list().get("configurationAvailable"));
          assertEquals(
              "MODEL_CONFIGURATION_UNAVAILABLE",
              assertThrows(ApiException.class, () -> service.create(body)).code);
          SecurityContextHolder.getContext()
              .setAuthentication(
                  new UsernamePasswordAuthenticationToken(
                      "test-viewer", null, List.of(new SimpleGrantedAuthority("ROLE_VIEWER"))));
          assertEquals(
              "FORBIDDEN", assertThrows(ApiException.class, () -> service.create(body)).code);
        }
      } finally {
        SecurityContextHolder.clearContext();
        admin.createStatement().execute("DROP SCHEMA " + schema + " CASCADE");
      }
    }
  }
}
