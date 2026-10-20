package dev.nla;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.*;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
@EnableMethodSecurity
public class Security {
  @Bean
  SecurityFilterChain chain(HttpSecurity http, Environment env) throws Exception {
    boolean local = env.getProperty("nla.local", Boolean.class, false);
    http.csrf(csrf -> csrf.disable())
        .sessionManagement(
            s ->
                s.sessionCreationPolicy(
                    org.springframework.security.config.http.SessionCreationPolicy.STATELESS));
    http.exceptionHandling(
        e ->
            e.authenticationEntryPoint(
                    (req, res, ex) -> send(res, 401, "UNAUTHENTICATED", "Cần đăng nhập."))
                .accessDeniedHandler(
                    (req, res, ex) ->
                        send(res, 403, "FORBIDDEN", "Không có quyền thực hiện thao tác.")));
    http.authorizeHttpRequests(
        a -> {
          a.requestMatchers("/api/v1/health").permitAll();
          if (local)
            a.requestMatchers(org.springframework.http.HttpMethod.GET, "/api/v1/**").permitAll();
          a.anyRequest().authenticated();
        });
    if (local) {
      if (!Set.of("127.0.0.1", "localhost", "::1")
          .contains(env.getProperty("server.address", "127.0.0.1")))
        throw new IllegalStateException("Local profile requires loopback binding");
      String token = env.getProperty("LOCAL_API_TOKEN", "");
      http.addFilterBefore(
          new OncePerRequestFilter() {
            protected void doFilterInternal(
                HttpServletRequest req, HttpServletResponse res, FilterChain chain)
                throws ServletException, IOException {
              String auth = req.getHeader("Authorization");
              if (auth != null) {
                if (token.length() < 32
                    || !auth.startsWith("Bearer ")
                    || !MessageDigest.isEqual(
                        token.getBytes(StandardCharsets.UTF_8),
                        auth.substring(7).getBytes(StandardCharsets.UTF_8))) {
                  send(res, 401, "UNAUTHENTICATED", "Local access token không hợp lệ.");
                  return;
                }
                SecurityContextHolder.getContext()
                    .setAuthentication(
                        new UsernamePasswordAuthenticationToken(
                            "local-admin",
                            null,
                            List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));
              }
              chain.doFilter(req, res);
            }
          },
          AnonymousAuthenticationFilter.class);
    } else {
      String issuer = env.getProperty("OIDC_ISSUER_URI", "");
      String audience = env.getProperty("OIDC_AUDIENCE", "");
      if (issuer.isBlank() || audience.isBlank())
        throw new IllegalStateException(
            "OIDC_ISSUER_URI and OIDC_AUDIENCE are required outside the local profile");
      String jwkSetUri = env.getProperty("OIDC_JWK_SET_URI", "");
      var decoder =
          jwkSetUri.isBlank()
              ? NimbusJwtDecoder.withIssuerLocation(issuer).build()
              : NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build();
      OAuth2TokenValidator<Jwt> issuerValidator = JwtValidators.createDefaultWithIssuer(issuer);
      OAuth2TokenValidator<Jwt> audienceValidator =
          jwt -> {
            Object claim = jwt.getClaims().get("aud");
            boolean valid =
                claim instanceof String value
                    ? audience.equals(value)
                    : claim instanceof Collection<?> values && values.contains(audience);
            return valid
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(
                    new OAuth2Error("invalid_token", "Required audience is missing", null));
          };
      OAuth2TokenValidator<Jwt> subjectValidator =
          jwt ->
              jwt.getSubject() != null && !jwt.getSubject().isBlank()
                  ? OAuth2TokenValidatorResult.success()
                  : OAuth2TokenValidatorResult.failure(
                      new OAuth2Error("invalid_token", "Required subject is missing", null));
      decoder.setJwtValidator(
          new DelegatingOAuth2TokenValidator<>(
              issuerValidator, audienceValidator, subjectValidator));
      JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
      converter.setJwtGrantedAuthoritiesConverter(
          jwt -> {
            Object claim = jwt.getClaims().get("roles");
            return claim instanceof List<?> roles
                ? roles.stream()
                    .filter(String.class::isInstance)
                    .map(Object::toString)
                    .filter(Set.of("VIEWER", "ANALYST", "OPERATOR", "ADMIN")::contains)
                    .map(r -> new SimpleGrantedAuthority("ROLE_" + r))
                    .map(a -> (org.springframework.security.core.GrantedAuthority) a)
                    .toList()
                : List.of();
          });
      http.oauth2ResourceServer(
          o -> o.jwt(j -> j.decoder(decoder).jwtAuthenticationConverter(converter)));
    }
    return http.build();
  }

  static void send(HttpServletResponse res, int status, String code, String message)
      throws IOException {
    res.setStatus(status);
    res.setContentType("application/json");
    res.getWriter().write(Json.write(Json.obj("error", Errors.body(code, message, Json.obj()))));
  }
}
