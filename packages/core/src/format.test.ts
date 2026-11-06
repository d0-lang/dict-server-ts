import { assert, describe, it } from "@effect/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CaseClass,
  FormSource,
  GRAMMAR_SOURCE_POS,
  PRON_KINDS,
  SCHEMA_VERSION,
  UD_POS,
} from "./schema.ts";

/**
 * `spec/dictionary/format.json` is the file format as data, for any
 * implementation; the TypeScript constants mirror it with literal types.
 */
const format = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "spec",
      "dictionary",
      "format.json",
    ),
    "utf8",
  ),
);

describe("spec/dictionary/format.json", () => {
  it("matches the TypeScript constants", () => {
    assert.strictEqual(format.schemaVersion, SCHEMA_VERSION);
    assert.deepStrictEqual(format.udPos, [...UD_POS]);
    assert.deepStrictEqual(format.pronKinds, [...PRON_KINDS]);
    assert.deepStrictEqual(format.caseClass, { ...CaseClass });
    assert.deepStrictEqual(format.formSource, { ...FormSource });
    assert.strictEqual(format.sourcePos.grammar, GRAMMAR_SOURCE_POS);
  });
});
