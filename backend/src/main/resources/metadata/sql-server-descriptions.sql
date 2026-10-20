-- Copyright 2025 Google LLC
-- Licensed under the Apache License, Version 2.0. See third_party/data-tool-runtime/LICENSE.
-- Modified for NLA: narrow description-only, schema-bound, bounded JDBC discovery.
WITH table_info AS (
    SELECT t.object_id AS table_oid, t.name AS table_name
    FROM sys.objects t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = ? AND t.type IN ('U', 'V') AND t.is_ms_shipped = 0
)
SELECT ti.table_name, CAST(NULL AS NVARCHAR(128)) AS column_name,
       CAST(ep.value AS NVARCHAR(4000)) AS description
FROM table_info ti
JOIN sys.extended_properties ep ON ep.major_id = ti.table_oid
    AND ep.minor_id = 0 AND ep.class = 1 AND ep.name = 'MS_Description'
UNION ALL
SELECT ti.table_name, c.name AS column_name,
       CAST(epc.value AS NVARCHAR(4000)) AS description
FROM sys.columns c
JOIN table_info ti ON c.object_id = ti.table_oid
JOIN sys.extended_properties epc ON epc.major_id = c.object_id
    AND epc.minor_id = c.column_id AND epc.class = 1 AND epc.name = 'MS_Description'
