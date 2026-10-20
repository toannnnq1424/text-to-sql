# Server-managed evaluation catalog

`./suites.json` is the server-controlled catalog consumed by Java. It names suites
and maps each supported engine to a JSON case file under the configured data root.
Java derives case counts from those files; no suite ID, domain or count belongs in
business core code. Paths cannot escape the data root, including through symlinks.
Each corpus is bounded and must declare matching suiteId/engine, unique case IDs,
questions, expected rejections or expected SQL/chart. Expected SQL is validated
against the selected authorized dataset before an evaluation run is created.

The support files are generated test-only artifacts from
`ai-service/evaluation/synthetic-support.json`, with the source SHA-256 recorded
in each file. They are synthetic and do not create a runtime warehouse or add
examples to a user's semantic model. They require a matching registered physical
dataset and its declared semantic examples, like any other suite. The explicit
`verify_cross_domain.py` runner uses a temporary physical fixture through Java
and independently calculated expectations; it disables that test dataset and
removes its table afterward.

To add a configured suite, supply reviewed files and update this catalog in the
server data deployment. No new folder, adapter or core domain condition is needed
for each user warehouse. The catalog is configuration and is not accepted as a
browser filesystem path. Tests must distinguish candidate quality, independent
result equivalence and live provider mode; deterministic fixture lookup does not
prove an LLM understands novel questions.
