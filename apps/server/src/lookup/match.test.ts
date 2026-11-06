import { assert, describe, it } from "@effect/vitest";
import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { lookupWord } from "./lookup.ts";
import { languageOf } from "./testing/dictionary.ts";
import { german } from "./testing/german.ts";
import { polish } from "./testing/polish.ts";
import { russian } from "./testing/russian.ts";

/** Lemma and `match` of the entries the context adds, which come first. */
const matches = (
  db: DictionaryDb,
  pair: string,
  word: string,
  context: string,
  at?: number,
) =>
  lookupWord(db, languageOf(pair), word, context, at)
    .entries.filter((entry) => entry.match !== undefined)
    .map((entry) => [entry.lemma, entry.match]);

describe("context-match", () => {
  it("gives the parts of the sentence a context entry covers, as written", () => {
    assert.deepStrictEqual(
      matches(german, "de_en", "fand", "Die Sitzung fand gestern statt."),
      [["stattfinden", ["fand", "statt"]]],
    );
    assert.deepStrictEqual(
      matches(german, "de_en", "Kraft", "Das Gesetz tritt morgen in Kraft."),
      [["in Kraft treten", ["tritt", "in Kraft"]]],
    );
    assert.deepStrictEqual(
      matches(polish, "pl_en", "miejsce", "Miało to miejsce wczoraj."),
      [["mieć miejsce", ["Miało", "miejsce"]]],
    );
    assert.deepStrictEqual(
      matches(russian, "ru_en", "кого", "Позови кого-нибудь."),
      [["кто-нибудь", ["кого-нибудь"]]],
    );
  });

  it("covers an abbreviation's pieces, with the word that leads it", () => {
    assert.deepStrictEqual(
      matches(russian, "ru_en", "т", "груши и т.д. лежали")[0],
      ["и т. д.", ["и т.д"]],
    );
  });

  it("leaves the word's own entries without match", () => {
    const entries = lookupWord(
      german,
      languageOf("de_en"),
      "fand",
      "Die Sitzung fand gestern statt.",
    ).entries;
    assert.deepStrictEqual(
      entries.map((entry) => entry.match !== undefined),
      [true, false],
    );
  });
});
