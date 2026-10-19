export type WarehouseSelection = {
  identity: string;
  warehouseId: string;
  datasetId: string;
};

export function warehouseSelectionKey(identity: string) {
  return `nla-context:${encodeURIComponent(identity)}`;
}

export function readWarehouseSelection(
  storage: Pick<Storage, "getItem">,
  identity: string,
): WarehouseSelection {
  try {
    const value = JSON.parse(
      storage.getItem(warehouseSelectionKey(identity)) || "{}",
    ) as { warehouseId?: unknown; datasetId?: unknown };
    return {
      identity,
      warehouseId:
        typeof value.warehouseId === "string" ? value.warehouseId : "",
      datasetId: typeof value.datasetId === "string" ? value.datasetId : "",
    };
  } catch {
    return { identity, warehouseId: "", datasetId: "" };
  }
}
