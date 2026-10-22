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

`test_schema_relevance.py` checks context selection independently of model accuracy:
accented/accentless Vietnamese, English, compound identifier typos, physical names
shared by schemas, retained metric/dimension join paths, quoted filter values and
a 502-table context under a serialized request budget. Approximate table matches
come only from the request's authorized metadata, retain the original question,
and appear explicitly in candidate assumptions. Ties and ambiguous qualified or
bare names fail with a controlled error before inference. Deterministic mode
remains exact-example-only; these retrieval improvements do not broaden it into
a model. Provider transport fixtures verify the boundary without network calls;
their pass counts must not be reported as live-model SQL/result accuracy.

`readiness-corpus.json` is a separate validation-only corpus: 12 unseen analytical
scenarios and 3 ambiguity/safety cases, each exercised on the existing three
Chinook engines by `python3 infra/local/readiness-ai-runtime.py`. It must never be
loaded as runtime semantic examples. The runner requires the existing default to
be local Ollama and changes no provider, registry or ingestion configuration. Its
independent SQLite oracle uses a read-only physical source snapshot, pinned source
counts and snapshot hashes. It compares all persisted result pages, numeric values
at tolerance `0.000001`, duplicate rows and requested top-N order. Local reports
under `.local/compose-app/` retain query IDs, actual model provenance, SQL, latency
and failures. They are ignored local artifacts, not a claim that every model
question passes. Online providers are never selected by this runner.

The explicit-key ranking regression arose from a real local-model answer that
merged entities with duplicate display names. Candidate AST validation now checks
an explicit English `break ties by`/`tie-break by` column when a direct outer aggregate resolves it to one
authorized single-column primary key: grouped aggregates retain that key and the requested
ORDER BY direction. The existing one-correction/shared-time-budget path handles
violations; it does not synthesize SQL or add extra retries. This bounded predicate
does not prove arbitrary natural-language intent or resolve ambiguous/composite keys
or ordering through nested query scopes. Aliased key output and quoted filter values
are distinguished from key intent so they do not cause false positive rejections.
`--resume` verifies the corpus, provider and independent snapshot fingerprints and
runs only missing cases; it preserves previous failures instead of overwriting
them with later attempts. Follow-up measurements belong in a separate output.

The configured real-provider smoke is part of `test_app.py` and runs only when
`LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` are present. Provider credentials
must be supplied through the local environment and are never printed or stored
in the evaluation artifacts.
