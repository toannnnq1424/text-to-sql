package dev.nla;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Only ciphertext is stored; the independently provisioned master key never enters metadata. */
@Component
public class ModelProviderSecrets {
  private final Environment env;
  private final SecureRandom random = new SecureRandom();

  public ModelProviderSecrets(Environment env) {
    this.env = env;
  }

  public boolean available() {
    try {
      key();
      return true;
    } catch (ApiException unavailable) {
      return false;
    }
  }

  public void requireAvailable() {
    key();
  }

  private SecretKeySpec key() {
    try {
      byte[] decoded = Base64.getDecoder().decode(env.getProperty("NLA_MODEL_MASTER_KEY", ""));
      if (decoded.length != 32) throw new IllegalArgumentException();
      var key = new SecretKeySpec(decoded, "AES");
      Arrays.fill(decoded, (byte) 0);
      return key;
    } catch (IllegalArgumentException invalid) {
      throw unavailable();
    }
  }

  public String encrypt(String id, String secret) {
    var master = key();
    try {
      byte[] nonce = new byte[12];
      random.nextBytes(nonce);
      var cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, master, new GCMParameterSpec(128, nonce));
      cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
      byte[] plaintext = secret.getBytes(StandardCharsets.UTF_8);
      try {
        byte[] ciphertext = cipher.doFinal(plaintext);
        return "v1:"
            + Base64.getEncoder()
                .encodeToString(
                    ByteBuffer.allocate(nonce.length + ciphertext.length)
                        .put(nonce)
                        .put(ciphertext)
                        .array());
      } finally {
        Arrays.fill(plaintext, (byte) 0);
      }
    } catch (Exception failure) {
      throw unavailable();
    }
  }

  public String decrypt(String id, String encrypted) {
    var master = key();
    try {
      if (!encrypted.startsWith("v1:")) throw new IllegalArgumentException();
      byte[] bytes = Base64.getDecoder().decode(encrypted.substring(3));
      if (bytes.length < 28) throw new IllegalArgumentException();
      var cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, master, new GCMParameterSpec(128, Arrays.copyOf(bytes, 12)));
      cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
      byte[] plaintext = cipher.doFinal(bytes, 12, bytes.length - 12);
      try {
        return new String(plaintext, StandardCharsets.UTF_8);
      } finally {
        Arrays.fill(plaintext, (byte) 0);
      }
    } catch (Exception invalid) {
      throw unavailable();
    }
  }

  private static ApiException unavailable() {
    return new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "MODEL_CONFIGURATION_UNAVAILABLE",
        "Chưa provision master key hợp lệ hoặc không giải mã được cấu hình model. Liên hệ quản trị"
            + " deployment; không có lưu plaintext thay thế.");
  }
}
