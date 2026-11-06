import { assert, describe, it } from "@effect/vitest";
import { readLanguage } from "@dict/core/language";
import { compoundRules, splitCompound } from "./compounds.ts";

const linkers = compoundRules(readLanguage("de"))!.linkers;

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
const pieces = (word: string) =>
  splitCompound(word, (part) => (words.has(part) ? 2 : 0), linkers);
const split = (word: string) =>
  pieces(word)
    ?.filter((piece) => piece.part)
    .map((piece) => piece.text);

describe("splitCompound", () => {
  it("splits into known parts, removing linking elements", () => {
    assert.deepStrictEqual(split("gemüsefonds"), ["gemüse", "fonds"]);
    assert.deepStrictEqual(split("schifffahrtsgeschichte"), [
      "schifffahrt",
      "geschichte",
    ]);
    assert.deepStrictEqual(split("hansetag"), ["hanse", "tag"]);
  });

  it("keeps linking elements as pieces without meaning", () => {
    assert.deepStrictEqual(pieces("gemüsefonds"), [
      { text: "gemüse", part: true },
      { text: "fonds", part: true },
    ]);
    assert.deepStrictEqual(pieces("schifffahrtsgeschichte"), [
      { text: "schifffahrt", part: true },
      { text: "s", part: false },
      { text: "geschichte", part: true },
    ]);
  });

  it("splits a modifier that is itself a compound", () => {
    assert.deepStrictEqual(split("militärpatrouillenlauf"), [
      "militär",
      "patrouillen",
      "lauf",
    ]);
  });

  it("prefers the modifier its linked form belongs to", () => {
    // `spitzen` is a form of `Spitze`; `wander` is no form of `Wand`.
    const scores: Record<string, Record<string, number>> = {
      spitzen: { "": 1 },
      spitze: { n: 3 },
      gastronomie: { "": 2 },
      wander: { "": 1 },
      wand: { er: 1 },
      routen: { "": 1 },
      tage: { s: 2 },
      tag: { es: 3 },
      sätzen: { "": 1 },
    };
    const scored = (word: string) =>
      splitCompound(
        word,
        (stem, linker) => scores[stem]?.[linker] ?? (scores[stem] ? 1 : 0),
        linkers,
      );
    assert.deepStrictEqual(scored("spitzengastronomie"), [
      { text: "spitze", part: true },
      { text: "n", part: false },
      { text: "gastronomie", part: true },
    ]);
    assert.deepStrictEqual(scored("wanderrouten"), [
      { text: "wander", part: true },
      { text: "routen", part: true },
    ]);
    assert.deepStrictEqual(scored("tagessätzen"), [
      { text: "tag", part: true },
      { text: "es", part: false },
      { text: "sätzen", part: true },
    ]);
  });

  it("gives up rather than leave an unknown part", () => {
    assert.strictEqual(split("stromatolithen"), undefined);
    assert.strictEqual(split("xyztag"), undefined);
  });

  it("only applies to compounding languages", () => {
    assert.strictEqual(compoundRules(readLanguage("pl")), undefined);
  });
});
