package dev.nla;
import org.springframework.web.bind.annotation.*;import org.springframework.security.access.prepost.PreAuthorize;import org.springframework.http.ResponseEntity;import java.util.*;
@RestController @RequestMapping("/api/v1/warehouse/ingestion") public class IngestionController {
 private final Store store;private final PipelineService pipelines;public IngestionController(Store s,PipelineService p){store=s;pipelines=p;}
 @GetMapping("/sources") Object sources(@RequestParam Map<String,String>p){return Page.of(pipelines.sources(),p,"name",Set.of("name","sourceId","createdAt"));}
 @PostMapping("/run") @PreAuthorize("hasAnyRole('OPERATOR','ADMIN')") ResponseEntity<?> run(@RequestBody Map<String,Object>b){return ResponseEntity.accepted().body(pipelines.run(b));}
 @GetMapping("/runs") Object runs(@RequestParam Map<String,String>p){return Page.of(store.runs("INGESTION"),p,"startedAt",Set.of("createdAt","startedAt","completedAt","durationMs","rowsWritten","status"));}
 @GetMapping("/runs/{id}") Object detail(@PathVariable String id){return store.run(id,"INGESTION");}
}
