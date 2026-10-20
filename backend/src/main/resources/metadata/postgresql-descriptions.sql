-- Copyright 2025 Google LLC
-- Licensed under the Apache License, Version 2.0. See third_party/data-tool-runtime/LICENSE.
-- Modified for NLA: narrow description-only, schema-bound, bounded JDBC discovery.
WITH table_info AS (
    SELECT t.oid AS table_oid, t.relname AS table_name
    FROM pg_class t
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
    WHERE ns.nspname = ? AND t.relkind IN ('r', 'p', 'v', 'm', 'f')
)
SELECT ti.table_name, NULL::text AS column_name,
       LEFT(obj_description(ti.table_oid, 'pg_class'), 4000) AS description
FROM table_info ti
WHERE obj_description(ti.table_oid, 'pg_class') IS NOT NULL
UNION ALL
SELECT ti.table_name, att.attname AS column_name,
       LEFT(col_description(att.attrelid, att.attnum), 4000) AS description
FROM pg_attribute att
JOIN table_info ti ON att.attrelid = ti.table_oid
WHERE att.attnum > 0 AND NOT att.attisdropped
  AND col_description(att.attrelid, att.attnum) IS NOT NULL
