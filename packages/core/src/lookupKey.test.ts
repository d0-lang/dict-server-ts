import { assert, describe, it } from "@effect/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { caseClass, lookupKey } from "./lookupKey.ts";
import { CaseClass } from "./schema.ts";

/** `spec/dictionary/lookup-key.jsonl`: the vectors any implementation must match. */
const vectors: ReadonlyArray<{
  readonly word: string;
  readonly key: string;
  readonly caseClass: keyof typeof CaseClass;
}> = readFileSync(
  join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "spec",
    "dictionary",
    "lookup-key.jsonl",
  ),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line));

describe("lookupKey", () => {
  it("matches the spec vectors", () => {
    for (const v of vectors)
      assert.strictEqual(lookupKey(v.word), v.key, v.word);
  });

  it("caseClass matches the spec vectors", () => {
    for (const v of vectors) {
      assert.strictEqual(caseClass(v.word), CaseClass[v.caseClass], v.word);
    }
  });
});
