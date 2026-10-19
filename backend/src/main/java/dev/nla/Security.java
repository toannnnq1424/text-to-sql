package dev.nla;
import org.springframework.context.annotation.*;import org.springframework.core.env.Environment;import org.springframework.security.config.annotation.web.builders.HttpSecurity;import org.springframework.security.web.SecurityFilterChain;import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;import org.springframework.security.oauth2.server.resource.authentication.*;import org.springframework.security.core.authority.SimpleGrantedAuthority;import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;import org.springframework.security.core.context.SecurityContextHolder;import org.springframework.web.filter.OncePerRequestFilter;import jakarta.servlet.*;import jakarta.servlet.http.*;import java.io.IOException;import java.nio.charset.StandardCharsets;import java.security.MessageDigest;import java.util.*;
@Configuration @EnableMethodSecurity
public class Security {
 @Bean SecurityFilterChain chain(HttpSecurity http,Environment env)throws Exception{
  boolean local=env.getProperty("nla.local",Boolean.class,false);
  http.csrf(csrf->csrf.disable()).sessionManagement(s->s.sessionCreationPolicy(org.springframework.security.config.http.SessionCreationPolicy.STATELESS));
  http.exceptionHandling(e->e.authenticationEntryPoint((req,res,ex)->send(res,401,"UNAUTHENTICATED","Cần đăng nhập.")).accessDeniedHandler((req,res,ex)->send(res,403,"FORBIDDEN","Không có quyền thực hiện thao tác.")));
  http.authorizeHttpRequests(a->{a.requestMatchers("/api/v1/health").permitAll();if(local)a.requestMatchers(org.springframework.http.HttpMethod.GET,"/api/v1/**").permitAll();a.anyRequest().authenticated();});
  if(local){
   if(!Set.of("127.0.0.1","localhost","::1").contains(env.getProperty("server.address","127.0.0.1")))throw new IllegalStateException("Local profile requires loopback binding");
   String token=env.getProperty("LOCAL_API_TOKEN","");
   http.addFilterBefore(new OncePerRequestFilter(){protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain)throws ServletException,IOException{String auth=req.getHeader("Authorization");if(auth!=null){if(token.length()<32||!auth.startsWith("Bearer ")||!MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),auth.substring(7).getBytes(StandardCharsets.UTF_8))){send(res,401,"UNAUTHENTICATED","Local access token không hợp lệ.");return;}SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("local-admin",null,List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));}chain.doFilter(req,res);}},AnonymousAuthenticationFilter.class);
  }else{
   JwtAuthenticationConverter converter=new JwtAuthenticationConverter();converter.setJwtGrantedAuthoritiesConverter(jwt->{Object claim=jwt.getClaims().get("roles");return claim instanceof List<?> roles?roles.stream().filter(String.class::isInstance).map(Object::toString).filter(Set.of("VIEWER","ANALYST","OPERATOR","ADMIN")::contains).map(r->new SimpleGrantedAuthority("ROLE_"+r)).map(a->(org.springframework.security.core.GrantedAuthority)a).toList():List.of();});http.oauth2ResourceServer(o->o.jwt(j->j.jwtAuthenticationConverter(converter)));
  }
  return http.build();
 }
 static void send(HttpServletResponse res,int status,String code,String message)throws IOException{res.setStatus(status);res.setContentType("application/json");res.getWriter().write(Json.write(Json.obj("error",Errors.body(code,message,Json.obj()))));}
}
