import type { Engine } from "../api/schema";
import type { Transform } from "../api/workbenchSchema";

/** Identifier bindings for the mapping editor, never an executable SQL statement. */
export function mappingReference(name: string, engine: Engine): string {
  if (engine === "MYSQL") return `input.\`${name.replaceAll("`", "``")}\``;
  if (engine === "SQL_SERVER") return `input.[${name.replaceAll("]", "]]")}]`;
  return `input."${name.replaceAll('"', '""')}"`;
}

export function passThroughTransform(
  names: string[],
  engine: Engine,
): Transform {
  const used = new Set<string>();
  return {
    columns: names.map((source, index) => {
      let name = source.replace(/[^A-Za-z0-9_]/g, "_");
      if (!/^[A-Za-z_]/.test(name)) name = `column_${name}`;
      name = name.slice(0, 63) || `column_${index + 1}`;
      const base = name;
      let suffix = 1;
      while (used.has(name.toLowerCase())) {
        const end = `_${suffix++}`;
        name = `${base.slice(0, 63 - end.length)}${end}`;
      }
      used.add(name.toLowerCase());
      return { name, expression: mappingReference(source, engine) };
    }),
    filter: "",
    groupBy: [],
  };
}
