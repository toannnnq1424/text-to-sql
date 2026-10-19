package dev.nla;
import org.junit.jupiter.api.Test;import org.junit.jupiter.params.ParameterizedTest;import org.junit.jupiter.params.provider.ValueSource;import static org.junit.jupiter.api.Assertions.*;import java.util.*;
class SqlGuardTest {
 private final SqlGuard guard=new SqlGuard();
 private final List<Map<String,Object>> tables=List.of(Json.obj("schema","public","name","invoice","columns",List.of(Json.obj("name","invoice_id"),Json.obj("name","total"),Json.obj("name","billing_country"))));
 @Test void aggregate(){assertEquals(1,guard.validate("SELECT billing_country, SUM(total) AS sales FROM public.invoice GROUP BY billing_country ORDER BY sales DESC","POSTGRESQL",tables).sourceTables().size());}
 @Test void alias(){assertDoesNotThrow(()->guard.validate("SELECT i.billing_country, SUM(i.total) AS sales FROM public.invoice i GROUP BY i.billing_country","POSTGRESQL",tables));}
 @Test void cte(){assertDoesNotThrow(()->guard.validate("WITH s AS (SELECT billing_country, total FROM public.invoice) SELECT s.billing_country, SUM(s.total) AS sales FROM s GROUP BY s.billing_country","POSTGRESQL",tables));}
 @ParameterizedTest @ValueSource(strings={"DELETE FROM public.invoice","SELECT * FROM public.invoice; DROP TABLE public.invoice","SELECT pg_read_file('/etc/passwd') FROM public.invoice","SELECT pg_sleep(10) FROM public.invoice","SELECT * INTO temp newtable FROM public.invoice","SELECT * FROM public.invoice FOR UPDATE","SELECT * FROM pg_catalog.pg_authid","SELECT unknown_column FROM public.invoice","SELECT * FROM public.invoice -- comment","WITH d AS (DELETE FROM public.invoice RETURNING *) SELECT * FROM d","SELECT lo_export(1,'/tmp/a') FROM public.invoice"})void unsafe(String sql){assertThrows(ApiException.class,()->guard.validate(sql,"POSTGRESQL",tables));}
 @Test void dialectMismatch(){assertThrows(ApiException.class,()->guard.validate("SELECT TOP 2 * FROM public.invoice","POSTGRESQL",tables));assertThrows(ApiException.class,()->guard.validate("SELECT * FROM public.invoice LIMIT 2","SQL_SERVER",tables));}
 @Test void csvSanitization(){assertEquals("\"'=HYPERLINK(1)\"",QueryController.cell("=HYPERLINK(1)",true));assertEquals("\"-100.25\"",QueryController.cell("-100.25",false));}
}
