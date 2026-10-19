package dev.nla;
import org.springframework.boot.ApplicationArguments;import org.springframework.boot.ApplicationRunner;import org.springframework.stereotype.Component;import org.springframework.context.annotation.Profile;import org.springframework.core.env.Environment;import org.springframework.transaction.support.TransactionTemplate;import org.springframework.transaction.PlatformTransactionManager;import java.nio.file.*;import java.time.*;import java.util.*;
@Component @Profile("local") public class LocalBootstrap implements ApplicationRunner {
 private final Store store;private final CatalogService catalog;private final Environment env;private final TransactionTemplate tx;
 public LocalBootstrap(Store store,CatalogService catalog,Environment env,PlatformTransactionManager manager){this.store=store;this.catalog=catalog;this.env=env;tx=new TransactionTemplate(manager);}
 public void run(ApplicationArguments args)throws Exception{
  boolean docker=env.getProperty("CHINOOK_DOCKER",Boolean.class,false);
  var specs=docker?List.of(Json.obj("suffix","pg","engine","POSTGRESQL","port",55432,"schema","public","file","postgresql"),Json.obj("suffix","mysql","engine","MYSQL","port",53306,"schema","nla_chinook","file","mysql"),Json.obj("suffix","mssql","engine","SQL_SERVER","port",51433,"schema","dbo","file","mssql")):List.of(Json.obj("suffix","pg","engine","POSTGRESQL","port",5432,"schema","public","file","postgresql"));
  for(var spec:specs){String suffix=Json.str(spec,"suffix"),warehouseId="wh-chinook-"+suffix;if(store.jdbc().queryForObject("SELECT count(*) FROM warehouse WHERE id=?",Integer.class,warehouseId)>0){refreshSeededDescription(warehouseId,"ds-chinook-"+suffix);continue;}
   String now=Instant.now().toString(),database="nla_chinook";var w=Json.obj("warehouseId",warehouseId,"name",database+" ("+spec.get("engine")+")","engine",spec.get("engine"),"host","127.0.0.1","port",spec.get("port"),"database",database,"defaultSchema",spec.get("schema"),"username",docker?"nla_reader":"nla_chinook_reader","status","ACTIVE","capabilities",Json.obj("readOnlyQuery",true,"metadataDiscovery",true),"createdAt",now,"updatedAt",now);
   Path path=Path.of(System.getProperty("nla.data.root","../data"),"chinook","semantic-"+spec.get("file")+".json");var semantic=Json.read(Files.readString(path));
   tx.executeWithoutResult(status->{store.insertWarehouse(w,"env:NLA_CHINOOK_"+(suffix.equals("mssql")?"MSSQL":suffix.toUpperCase(Locale.ROOT))+"_PASSWORD");var tables=catalog.discover(warehouseId,true).stream().filter(t->!Json.str(t,"name").startsWith("nla_")).toList();catalog.validateSemantic(semantic,tables);
    long columnCount=tables.stream().mapToLong(t->Json.objects(t.get("columns")).size()).sum();String dbName=Json.str(w,"database"),engine=Json.str(w,"engine"),schema=Json.str(spec,"schema");
    var d=Json.obj("datasetId","ds-chinook-"+suffix,"warehouseId",warehouseId,"name",dbName,"description",dbName+": phát hiện "+tables.size()+" bảng và "+columnCount+" cột trong schema "+schema+" trên "+engine+".","allowedSchemas",List.of(schema),"allowedTables",tables.stream().map(t->Json.obj("schema",t.get("schema"),"name",t.get("name"))).toList(),"semanticVersion",semantic.get("semanticVersion"),"schemaVersion",semantic.get("schemaVersion"),"status","ACTIVE","updatedAt",now);store.insertDataset(d,semantic);store.audit("LOCAL_CHINOOK_REGISTER",warehouseId);
   });
  }
 }
 private void refreshSeededDescription(String warehouseId,String datasetId){
  try{var d=store.get("dataset",datasetId);if(!"Chinook Music Store".equals(d.get("name"))&&!Json.str(d,"description").startsWith("Chinook 1.4.5:"))return;
   var w=store.warehouse(warehouseId);var tables=catalog.discover(warehouseId,true).stream().filter(t->!Json.str(t,"name").startsWith("nla_")).toList();long columns=tables.stream().mapToLong(t->Json.objects(t.get("columns")).size()).sum();String database=Json.str(w,"database"),engine=Json.str(w,"engine"),schema=Json.str(w,"defaultSchema");
   d.put("name",database);d.put("description",database+": phát hiện "+tables.size()+" bảng và "+columns+" cột trong schema "+schema+" trên "+engine+".");d.put("allowedTables",tables.stream().map(t->Json.obj("schema",t.get("schema"),"name",t.get("name"))).toList());d.put("allowedSchemas",List.of(schema));d.put("updatedAt",Instant.now().toString());store.updateDataset(d,store.semantic(datasetId));
  }catch(ApiException missing){if(!"RESOURCE_NOT_FOUND".equals(missing.code))throw missing;}
 }
}
