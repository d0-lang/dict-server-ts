import { assert, describe, it } from "@effect/vitest";
import { compoundLinkers, splitCompound } from "./compounds.ts";

const words = new Set([
  "gemüse",
  "fonds",
  "schifffahrt",
  "geschichte",
  "militär",
  "patrouillen",
  "lauf",
  "tag",
  "hanse",
]);
const split = (word: string) =>
  splitCompound(word, (part) => words.has(part), compoundLinkers("de_en")!);

describe("splitCompound", () => {
  it("splits into known parts, removing linking elements", () => {
    assert.deepStrictEqual(split("gemüsefonds"), ["gemüse", "fonds"]);
    assert.deepStrictEqual(split("schifffahrtsgeschichte"), [
      "schifffahrt",
      "geschichte",
    ]);
    assert.deepStrictEqual(split("hansetag"), ["hanse", "tag"]);
  });

  it("splits a modifier that is itself a compound", () => {
    assert.deepStrictEqual(split("militärpatrouillenlauf"), [
      "militär",
      "patrouillen",
      "lauf",
    ]);
  });

  it("gives up rather than leave an unknown part", () => {
    assert.strictEqual(split("stromatolithen"), undefined);
    assert.strictEqual(split("xyztag"), undefined);
  });

  it("only applies to compounding languages", () => {
    assert.strictEqual(compoundLinkers("pl_en"), undefined);
  });
});
