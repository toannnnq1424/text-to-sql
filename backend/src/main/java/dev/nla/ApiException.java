package dev.nla;
import org.springframework.http.HttpStatus;
public class ApiException extends RuntimeException {
 public final HttpStatus status;public final String code;public final Object details;
 public ApiException(HttpStatus status,String code,String message){this(status,code,message,Json.obj());}
 public ApiException(HttpStatus status,String code,String message,Object details){super(message);this.status=status;this.code=code;this.details=details;}
 public static ApiException notFound(){return new ApiException(HttpStatus.NOT_FOUND,"RESOURCE_NOT_FOUND","Không tìm thấy tài nguyên.");}
 public static ApiException bad(String message){return new ApiException(HttpStatus.BAD_REQUEST,"INVALID_REQUEST",message);}
}
