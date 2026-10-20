# Private file parser

Receives upload bytes only from Java and returns validated canonical NDJSON. It never connects to a warehouse or model provider. See [shared contract](../docs/contracts/file-ingestion.md) and [source attribution](third-party/NOTICE.md).

CSV/TSV/TXT, JSON/JSONL/NDJSON, XLSX sheets, Parquet, Arrow/Feather/IPC, ORC and Avro use pinned native readers. UTF-8/UTF-16, exact decimal/BIGINT, Unicode, null and nested JSON text are preserved. Inference scans the complete file. Formula/macros/external workbook references, duplicate headers, invalid rows and resource-limit violations fail before confirmation. Java owns persistence, mapping validation, grants, SQL generation, batch writes and audit.

Default Compose starts the parser automatically on its private network. For isolated tests:

```sh
python3 -m venv file-service/.venv
file-service/.venv/bin/pip install -r file-service/requirements.txt
file-service/.venv/bin/pytest -q file-service
```

`FILE_SERVICE_TOKEN` must contain at least32 characters. Deployment has one parser process with two concurrent jobs and container memory/CPU limits; Java bounds upload/spool and rejects queue saturation. No server path, external URL, SQL text or extension-install option is accepted. Dependency licensing is retained in installed package distributions; the adapted upstream Apache license/notice ships in the image.
