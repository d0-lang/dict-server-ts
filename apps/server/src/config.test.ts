import { assert, describe, it } from "@effect/vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLanguages } from "./config.ts";

describe("discoverLanguages", () => {
  it("lists the pairs with a dictionary file, sorted", () => {
    const dir = mkdtempSync(join(tmpdir(), "dict-config-"));
    try {
      for (const file of [
        "pl_en.sqlite",
        "de_en.sqlite",
        "de_en.sqlite.tmp",
        "identity.json",
        "notes.sqlite",
      ]) {
        writeFileSync(join(dir, file), "");
      }
      mkdirSync(join(dir, "raw"));
      assert.deepStrictEqual(discoverLanguages(dir), ["de_en", "pl_en"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("is empty when the directory doesn't exist", () => {
    assert.deepStrictEqual(discoverLanguages("/nonexistent/dict-data"), []);
  });
});
