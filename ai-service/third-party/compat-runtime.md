# LanceDB native CPU compatibility

The source-kit memory consumer uses the official LanceDB0.40.0 implementation. Linux x86_64 installs the official `lancedb-compat`0.40.0 wheel; other platforms use `lancedb`0.40.0. Only one distribution is installed. Both expose the same Python namespace/API. No replacement vector implementation, fake distribution metadata or global import monkeypatch is used.

The standard x86_64 wheel reproducibly exited139 on `list_tables()` under local Docker Desktop amd64 emulation. The compat wheel passed actual list/create/vector-search and source-kit MemoryStore indexing/query-history/recall. The publisher [documents](https://pypi.org/project/lancedb-compat/0.40.0/) the standard Haswell AVX2/FMA/F16C baseline and the compat x86-64-v2 build. This explains the selected compatibility remedy; it does not establish the precise native instruction causing the observed signal.

The official compat wheel has a packaging defect: `lancedb/__init__.py` asks `importlib.metadata.version("lancedb")` although its distribution is named `lancedb-compat`. `fix_lancedb_compat.py` changes only that lookup to the actual installed compat distribution name at install time. It refuses other versions, source hashes or overlapping standard/compat installations. The binary, public API, notices and remaining package code stay unchanged. The patch is idempotent and is run by both Docker and the host installer before the native execution build check.

| Item | SHA-256 |
|---|---|
| Official `lancedb_compat-0.40.0-cp310-abi3-manylinux_2_28_x86_64.whl` | `c19ff36e730d66a5fbe69cb1484e42c9e50847581515898357ade748c6f3cd57` |
| Original `lancedb/__init__.py` | `4c82a8bec2c215c6307e3e0b6607d0be4cd7dc1333804bb547ba22e0ae592162` |

Source/publisher: [LanceDB](https://github.com/lancedb/lancedb), Apache-2.0; the wheel contains its original LICENSE and copyright. Dependency source is separate from the two vendored snapshots, whose inventory and patch manifest remain unchanged by this install-time dependency repair.


Existing Linux x86_64 venvs are migrated by `infra/upstream/install_ai.py`: it invokes a preflight inside the explicitly selected Python venv, removes the old standard distribution (and both overlapping distributions if an earlier dual install exists), then installs the pinned requirements cleanly. Other operating systems/architectures keep their standard distribution. The preflight refuses system Python before any dependency mutation; no global packages are modified. Clone owners should run the installer rather than installing both wheels manually.
