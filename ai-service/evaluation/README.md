# AI evaluation corpus

The deterministic candidate-generation corpus contains 42 logical cases across
two explicitly named domains: the Chinook music-store sample and a synthetic
customer-support schema. Vietnamese/English phrasings of one intent share a
`logicalCaseId`. The corpus has matching expectations for PostgreSQL, MySQL,
and SQL Server, for 126 logical case/dialect combinations.

The synthetic support schema is evaluation-only. It contains no downloaded,
real, or production support data and is not a production warehouse or runtime UI
fallback. The explicit local acceptance runner may temporarily register a clearly
labelled synthetic test dataset against physical databases, then disables that
dataset and removes its generated table. Its semantic rules and enumerated
values are stated in that fixture so test expectations are explicit.

`python3 -m pytest ai-service -q` exercises all positive deterministic
expectations and rejection cases over the HTTP route. The Chinook expected SQL
fixtures are also checked against the declared semantic examples. The tests
verify candidate SQL, selected metrics/dimensions, chart recommendation, and
controlled error codes; they alone do not execute SQL through Java. The separate real acceptance runner
`python3 data/scripts/verify_cross_domain.py --base-url http://127.0.0.1:8080/api/v1`
executes 36 bilingual/rejection cases per engine through Java and Python, using
a generated 12-row fixture and comparing independently calculated SQLite
expectations at a declared mean tolerance of 0.000001. It is not enabled in the
production bootstrap and leaves a disabled test dataset for history provenance.

Mean-duration examples explicitly cast the integer duration to DECIMAL(38,10)
before AVG: SQL Server AVG(integer) truncates fractional results, and MySQL uses
a shorter scale for an uncast integer mean. Cross-engine result tests cover
these cases with fractional means instead of rounding the expected values away.

The HTTP suite exercises Vietnamese and English phrasings under shared logical case
IDs. A provider candidate is checked against the selected semantic context sent in its
prompt; warehouse and dataset identifiers and credential-reference fields are not part
of that provider payload. Python checks candidate shape and unsafe SQL patterns, while
Java remains the authoritative SQL identifier/security validator and executor.

The configured real-provider smoke is part of `test_app.py` and runs only when
`LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` are present. Provider credentials
must be supplied through the local environment and are never printed or stored
in the evaluation artifacts.
