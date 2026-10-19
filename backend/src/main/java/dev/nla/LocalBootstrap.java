package dev.nla;
import org.springframework.boot.ApplicationArguments;import org.springframework.boot.ApplicationRunner;import org.springframework.stereotype.Component;import org.springframework.context.annotation.Profile;import org.springframework.core.env.Environment;import org.springframework.transaction.support.TransactionTemplate;import org.springframework.transaction.PlatformTransactionManager;import java.nio.file.*;import java.time.*;import java.util.*;
@Component @Profile("local") public class LocalBootstrap implements ApplicationRunner {
 private final Store store;private final CatalogService catalog;private final Environment env;private final TransactionTemplate tx;
 public LocalBootstrap(Store store,CatalogService catalog,Environment env,PlatformTransactionManager manager){this.store=store;this.catalog=catalog;this.env=env;tx=new TransactionTemplate(manager);}
 public void run(ApplicationArguments args)throws Exception{
  boolean docker=env.getProperty("CHINOOK_DOCKER",Boolean.class,false);
  var specs=docker?List.of(Json.obj("suffix","pg","engine","POSTGRESQL","port",55432,"schema","public","file","postgresql"),Json.obj("suffix","mysql","engine","MYSQL","port",53306,"schema","nla_chinook","file","mysql"),Json.obj("suffix","mssql","engine","SQL_SERVER","port",51433,"schema","dbo","file","mssql")):List.of(Json.obj("suffix","pg","engine","POSTGRESQL","port",5432,"schema","public","file","postgresql"));
  for(var spec:specs){String suffix=Json.str(spec,"suffix"),warehouseId="wh-chinook-"+suffix;if(store.jdbc().queryForObject("SELECT count(*) FROM warehouse WHERE id=?",Integer.class,warehouseId)>0)continue;
   String now=Instant.now().toString();var w=Json.obj("warehouseId",warehouseId,"name","Chinook "+spec.get("engine"),"engine",spec.get("engine"),"host","127.0.0.1","port",spec.get("port"),"database","nla_chinook","defaultSchema",spec.get("schema"),"username",docker?"nla_reader":"nla_chinook_reader","status","ACTIVE","capabilities",Json.obj("readOnlyQuery",true,"metadataDiscovery",true),"createdAt",now,"updatedAt",now);
   Path path=Path.of(System.getProperty("nla.data.root","../data"),"chinook","semantic-"+spec.get("file")+".json");var semantic=Json.read(Files.readString(path));
   tx.executeWithoutResult(status->{store.insertWarehouse(w,"env:NLA_CHINOOK_"+(suffix.equals("mssql")?"MSSQL":suffix.toUpperCase(Locale.ROOT))+"_PASSWORD");var tables=catalog.discover(warehouseId,true).stream().filter(t->!Json.str(t,"name").startsWith("nla_")).toList();catalog.validateSemantic(semantic,tables);
    var d=Json.obj("datasetId","ds-chinook-"+suffix,"warehouseId",warehouseId,"name","Chinook Music Store","description","Chinook 1.4.5: nhạc, nghệ sĩ, khách hàng và hóa đơn. Metadata và kết quả đọc trực tiếp từ "+spec.get("engine")+".","allowedSchemas",List.of(spec.get("schema")),"allowedTables",tables.stream().map(t->Json.obj("schema",t.get("schema"),"name",t.get("name"))).toList(),"semanticVersion",semantic.get("semanticVersion"),"schemaVersion",semantic.get("schemaVersion"),"status","ACTIVE","updatedAt",now);store.insertDataset(d,semantic);store.audit("LOCAL_CHINOOK_REGISTER",warehouseId);
   });
  }
 }
}
