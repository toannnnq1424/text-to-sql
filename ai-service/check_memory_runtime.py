"""Fail the image build if the native vector runtime cannot execute on its CPU."""

import tempfile

import lancedb


def check():
    with tempfile.TemporaryDirectory(prefix="nla-memory-build-") as directory:
        database = lancedb.connect(directory)
        database.list_tables()
        table = database.create_table("build_check", [{"vector": [1.0, 0.0]}])
        results = table.search([1.0, 0.0]).limit(1).to_list()
        if len(results) != 1 or results[0]["_distance"] != 0:
            raise RuntimeError("The native vector runtime failed its execution check.")


if __name__ == "__main__":
    check()
