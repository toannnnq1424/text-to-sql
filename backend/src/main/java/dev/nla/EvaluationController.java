package dev.nla;
import org.springframework.web.bind.annotation.*;import org.springframework.security.access.prepost.PreAuthorize;import org.springframework.http.ResponseEntity;import java.util.*;
@RestController @RequestMapping("/api/v1/evaluation") public class EvaluationController {
 private final Store store;private final EvaluationService service;public EvaluationController(Store s,EvaluationService e){store=s;service=e;}
 @GetMapping("/test-suites") Object suites(@RequestParam Map<String,String>p){return Page.of(service.suites(),p,"name",Set.of("name","suiteId","createdAt"));}
 @PostMapping("/run") @PreAuthorize("hasAnyRole('OPERATOR','ADMIN')") ResponseEntity<?> run(@RequestBody Map<String,Object>b){return ResponseEntity.accepted().body(service.run(b));}
 @GetMapping("/runs") Object runs(@RequestParam Map<String,String>p){return Page.of(store.runs("EVALUATION"),p,"createdAt",Set.of("createdAt","status","runId"));}
 @GetMapping("/runs/{id}") Object run(@PathVariable String id){return store.run(id,"EVALUATION");}
 @GetMapping("/results") Object results(@RequestParam Map<String,String>p){return Page.of(store.runs("EVALUATION_CASE"),p,"createdAt",Set.of("createdAt","caseId","latencyMs","difficulty","status"));}
 @GetMapping("/results/{id}") Object result(@PathVariable String id){return store.run(id,"EVALUATION_CASE");}
}
