"""Safety and exact-source checks for the optional administrative sample loader."""

import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import adventureworks as sample


class SourceProjectionTest(unittest.TestCase):
    def member(self, content, **overrides):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        archive = Path(self.directory.name) / "sample.zip"
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("items.csv", content)
        table = {
            "file": "items.csv",
            "sha256": hashlib.sha256(content).hexdigest(),
            "sourceColumnCount": 3,
            "rowCount": 2,
            "columns": [
                {"name": "id", "sourceIndex": 0, "type": "INTEGER", "nullable": False},
                {"name": "amount", "sourceIndex": 1, "type": "DECIMAL", "nullable": True},
                {"name": "label", "sourceIndex": 2, "type": "STRING", "nullable": True},
            ],
            **overrides,
        }
        return archive, table

    def test_preserves_decimal_unicode_and_nulls(self):
        archive, table = self.member("1|123456789012345.6789|Nhạc\n2||\n".encode())
        self.assertEqual(
            sample.rows_for(archive, table),
            [
                {"id": "1", "amount": "123456789012345.6789", "label": "Nhạc"},
                {"id": "2", "amount": None, "label": None},
            ],
        )

    def test_checksum_width_count_and_nonfinite_values_fail_closed(self):
        scenarios = [
            (b"1|2|ok\n2|3|ok\n", {"sha256": "0" * 64}),
            (b"1|2\n2|3|ok\n", {}),
            (b"1|2|ok\n", {}),
            (b"1|NaN|bad\n2|3|ok\n", {}),
            (b"1|Infinity|bad\n2|3|ok\n", {}),
        ]
        for content, overrides in scenarios:
            with self.subTest(content=content, overrides=overrides):
                archive, table = self.member(content, **overrides)
                with self.assertRaises(ValueError):
                    sample.rows_for(archive, table)

    def test_identifier_and_text_escaping_for_all_three_engines(self):
        expected = {
            "POSTGRESQL": ('"SalesAmount"', "'O''Brien\\path'"),
            "MYSQL": ("`SalesAmount`", "'O''Brien\\\\path'"),
            "SQL_SERVER": ("[SalesAmount]", "N'O''Brien\\path'"),
        }
        for engine, (identifier, text) in expected.items():
            with self.subTest(engine=engine):
                self.assertEqual(sample.quote(engine, "SalesAmount"), identifier)
                self.assertEqual(sample.literal(engine, "O'Brien\\path"), text)
                self.assertEqual(sample.literal(engine, None), "NULL")
                with self.assertRaises(ValueError):
                    sample.quote(engine, "x; DROP TABLE y")

    def test_existing_database_requires_matching_ownership_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(sample, "LOCAL", Path(directory)):
                with patch.object(sample.db, "execute", return_value="1") as execute:
                    with self.assertRaisesRegex(ValueError, "not owned"):
                        sample.provision("POSTGRESQL", {})
                    self.assertEqual(execute.call_count, 1)
                    marker = Path(directory) / "POSTGRESQL-owned.json"
                    marker.write_text(json.dumps({"sourceSha256": "unrelated"}))
                    with self.assertRaisesRegex(ValueError, "not owned"):
                        sample.provision("POSTGRESQL", {})
                    self.assertEqual(execute.call_count, 2)

    def test_oracle_uses_order_date_and_exact_decimal_aggregation(self):
        rows = {
            "DimDate": [{"DateKey": "1", "CalendarYear": "2020"}],
            "DimSalesTerritory": [{"SalesTerritoryKey": "4", "SalesTerritoryCountry": "Canada"}],
        }
        values = [
            {
                "OrderDateKey": "1",
                "SalesTerritoryKey": "4",
                "SalesAmount": "0.1001",
                "OrderQuantity": "2",
            },
            {
                "OrderDateKey": "1",
                "SalesTerritoryKey": "4",
                "SalesAmount": "0.2002",
                "OrderQuantity": "3",
            },
        ]
        rows.update(FactInternetSales=values, FactResellerSales=values)
        result = sample.oracle(rows)["FactInternetSales"]
        self.assertEqual(result["totalRevenue"], "0.3003")
        self.assertEqual(result["totalQuantity"], "5")
        self.assertEqual(result["annualRevenue"], {"2020": "0.3003"})
        self.assertEqual(result["countryRevenue"], {"Canada": "0.3003"})

    def test_manifest_contains_only_closed_projected_relationships(self):
        tables = {table["name"]: table for table in sample.SOURCE["tables"]}
        self.assertEqual(len(tables), 12)
        for table in tables.values():
            columns = {column["name"] for column in table["columns"]}
            self.assertTrue(set(table["primaryKey"]).issubset(columns))
            for relation in table["foreignKeys"]:
                self.assertIn(relation["column"], columns)
                target = tables[relation["referenceTable"]]
                self.assertIn(relation["referenceColumn"], target["primaryKey"])


if __name__ == "__main__":
    unittest.main()
