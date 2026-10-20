# AI evaluation corpus

The deterministic candidate-generation corpus contains 42 logical cases across
two explicitly named domains: the Chinook music-store sample and a synthetic
customer-support schema. Vietnamese/English phrasings of one intent share a
`logicalCaseId`. The corpus has matching expectations for PostgreSQL, MySQL,
and SQL Server, for 126 logical case/dialect combinations.

The synthetic support schema is evaluation-only. It contains no downloaded,
real, or production support data and must never be presented as an available
warehouse or used to seed runtime UI data. Its semantic rules and enumerated
values are stated in that fixture so test expectations are explicit.

`python3 -m pytest ai-service -q` exercises all positive deterministic
expectations and rejection cases over the HTTP route. The Chinook expected SQL
fixtures are also checked against the declared semantic examples. The tests
verify candidate SQL, selected metrics/dimensions, chart recommendation, and
controlled error codes; they do not execute the synthetic support SQL through
Java or claim result equivalence against a physical support warehouse.

The configured real-provider smoke is part of `test_app.py` and runs only when
`LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` are present. Provider credentials
must be supplied through the local environment and are never printed or stored
in the evaluation artifacts.
