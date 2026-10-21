package dev.nla;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class ModelProviderSecretsTest {
  static String master(int value) {
    byte[] bytes = new byte[32];
    java.util.Arrays.fill(bytes, (byte) value);
    return Base64.getEncoder().encodeToString(bytes);
  }

  @Test
  void randomizedAuthenticatedCiphertextSurvivesServiceRecreationButNotWrongKeyOrOwner() {
    var env = new MockEnvironment().withProperty("NLA_MODEL_MASTER_KEY", master(7));
    var secrets = new ModelProviderSecrets(env);
    String clear = "private-online-key-for-test";
    String first = secrets.encrypt("profile-a", clear);
    String second = secrets.encrypt("profile-a", clear);
    assertNotEquals(first, second);
    assertFalse(first.contains(clear));
    assertEquals(clear, new ModelProviderSecrets(env).decrypt("profile-a", first));
    assertThrows(ApiException.class, () -> secrets.decrypt("profile-b", first));
    var wrong =
        new ModelProviderSecrets(
            new MockEnvironment().withProperty("NLA_MODEL_MASTER_KEY", master(9)));
    assertThrows(ApiException.class, () -> wrong.decrypt("profile-a", first));
    byte[] bytes = Base64.getDecoder().decode(first.substring(3));
    bytes[15] ^= 1;
    assertThrows(
        ApiException.class,
        () -> secrets.decrypt("profile-a", "v1:" + Base64.getEncoder().encodeToString(bytes)));
  }

  @Test
  void missingOrMalformedMasterNeverFallsBackToPlaintext() {
    for (String value :
        new String[] {"", "not-base64", Base64.getEncoder().encodeToString(new byte[16])}) {
      var secrets =
          new ModelProviderSecrets(
              new MockEnvironment().withProperty("NLA_MODEL_MASTER_KEY", value));
      assertFalse(secrets.available());
      var error = assertThrows(ApiException.class, () -> secrets.encrypt("id", "secret"));
      assertEquals("MODEL_CONFIGURATION_UNAVAILABLE", error.code);
      assertFalse(error.getMessage().contains(value.isEmpty() ? "secret" : value));
    }
  }
}
