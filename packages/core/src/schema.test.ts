import { assert, describe, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { readDDL, schema } from "./schema.ts";

describe("dictionary schema", () => {
  it("hand-written DDL matches the Drizzle tables", () => {
    const db = new Database(":memory:");
    db.run(readDDL());
    for (const table of Object.values(schema)) {
      const config = getTableConfig(table);
      const actual = db
        .query<{ name: string; notnull: number; pk: number }, []>(
          `PRAGMA table_info(${config.name})`,
        )
        .all();
      assert.deepStrictEqual(
        actual.map((c) => c.name).sort(),
        config.columns.map((c) => c.name).sort(),
        config.name,
      );
      for (const column of config.columns) {
        const row = actual.find((c) => c.name === column.name)!;
        assert.strictEqual(
          row.notnull === 1 || row.pk > 0,
          column.notNull,
          `${config.name}.${column.name}`,
        );
      }
      const pk = actual
        .filter((c) => c.pk > 0)
        .map((c) => c.name)
        .sort();
      const expectedPk =
        config.primaryKeys[0]?.columns.map((c) => c.name).sort() ??
        config.columns.filter((c) => c.primary).map((c) => c.name);
      assert.deepStrictEqual(pk, expectedPk, `${config.name} primary key`);
    }
    db.close();
  });
});
