import { describe, expect, it } from "vitest";
import {
  readWarehouseSelection,
  warehouseSelectionKey,
} from "./warehouseSelection";

describe("warehouse selection storage", () => {
  it("keeps different signed-in identities in separate contexts", () => {
    const storage = new Map<string, string>([
      [
        warehouseSelectionKey("user/a"),
        JSON.stringify({ warehouseId: "warehouse-a", datasetId: "dataset-a" }),
      ],
      [
        warehouseSelectionKey("user-b"),
        JSON.stringify({ warehouseId: "warehouse-b", datasetId: "dataset-b" }),
      ],
    ]);

    const adapter = { getItem: (key: string) => storage.get(key) ?? null };
    expect(readWarehouseSelection(adapter, "user/a")).toEqual({
      identity: "user/a",
      warehouseId: "warehouse-a",
      datasetId: "dataset-a",
    });
    expect(readWarehouseSelection(adapter, "user-b")).toEqual({
      identity: "user-b",
      warehouseId: "warehouse-b",
      datasetId: "dataset-b",
    });
  });

  it("starts empty for missing, malformed, or incorrectly typed data", () => {
    const storage = new Map<string, string>([
      [warehouseSelectionKey("broken-json"), "{"],
      [
        warehouseSelectionKey("wrong-shape"),
        JSON.stringify({ warehouseId: 5, datasetId: null }),
      ],
    ]);
    const adapter = { getItem: (key: string) => storage.get(key) ?? null };

    for (const identity of ["missing", "broken-json", "wrong-shape"]) {
      expect(readWarehouseSelection(adapter, identity)).toEqual({
        identity,
        warehouseId: "",
        datasetId: "",
      });
    }
  });
});
