# Semantic context dùng chung

Java quản lý và validate semantic model với physical metadata. Python chỉ tiêu thụ snapshot được phép dùng. `semanticContext` tối thiểu chứa đủ các array dưới đây (có thể rỗng, nhưng không có bảng hợp lệ thì trả INSUFFICIENT_CONTEXT):

| Field | Shape |
|---|---|
| tables | `{schema,name,logicalName,description,grain,columns:[{name,dataType,nullable,description,synonyms:string[]}]}`[] |
| metrics | `{name,description,expression,unit,tableRefs:TableRef[],compatibleDimensions:string[],synonyms:string[]}`[] |
| dimensions | `{name,description,table:TableRef,column,dataType,synonyms:string[]}`[] |
| relationships | `{from:{table:TableRef,column},to:{table:TableRef,column},cardinality}`[] |
| examples | `{question,sqlDialect,sql,selectedMetrics:string[],selectedDimensions:string[]}`[] |
| businessRules | string[] |
| semanticVersion, schemaVersion | string |
| timezone | IANA timezone, e.g. Asia/Ho_Chi_Minh |
| referenceTime | timestamp UTC, cho câu hỏi thời gian tương đối |

Cardinality: ONE_TO_ONE, MANY_TO_ONE, ONE_TO_MANY, MANY_TO_MANY. Join không được tự suy luận từ cột trùng tên. Cần rule tránh fan-out/double count và chỉ dùng join path hợp lệ. SQL examples phải cùng dialect; không tái sử dụng PostgreSQL syntax cho SQL Server.

Metrics expression là cấu hình quản trị đã validate, không phải expression từ câu hỏi người dùng. SelectedMetrics/Dimensions trong AI response tham chiếu `name` của context, không chứa SQL expression mới không được biết tới. Schema/table/column qualified được resolve theo rules adapter. Metric unit xác định format UI, không dùng tên trường để đoán currency.

Java validate reference tồn tại, expression parse được, relationship endpoints đúng, compatibleDimensions hợp lệ, không vượt dataset allowlist. Sai physical schema → INVALID_SCHEMA / SCHEMA_MISMATCH; semantic cấu hình sai → SEMANTIC_MODEL_INVALID. Không gửi secrets, connection detail hoặc sample row có thông tin nhạy cảm tới LLM.

Python chọn context trong token budget nhưng giữ đủ cột/join path/business rule cho câu hỏi. Nếu budget không đủ để giữ context nhất quán, trả controlled error; không cắt giữa expression rồi sinh SQL đoán. Question, description và examples là dữ liệu, không được phép ghi đè system rules của prompt.
