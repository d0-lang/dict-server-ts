import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "./lookup.ts";
import { dictionary, languageOf } from "./testing/dictionary.ts";

const japanese = dictionary([
  ["人前", "NOUN", [], ["the public"], "noun", undefined, "ひとまえ"],
  ["人前", "NOUN", [], ["portion of food"], "noun", undefined, "にんまえ"],
  ["割", "X", [], ["proportion"], "character"],
  ["割", "X", [], ["cut, division"], "affix", undefined, "かつ"],
  ["割", "X", [], ["divide"], "affix", undefined, "かつ"],
  ["三", "NUM", [], ["three, 3"], "num", undefined, "さん"],
  ["三", "NUM", [], ["three"], "num", undefined, "サン"],
  ["三", "NUM", [], ["three"], "num", undefined, "み"],
]);

const lookup = (word: string) =>
  lookupWord(japanese, languageOf("ja_en"), word).entries.map(
    (entry) =>
      `${entry.lemma} ${entry.pron?.reading ?? "-"}: ${entry.senses.map((sense) => sense.translations[0]).join(", ")}`,
  );

describe("Japanese headwords", () => {
  it("keeps entries that differ only in reading apart", () => {
    assert.deepStrictEqual(lookup("人前"), [
      "人前 ひとまえ: the public",
      "人前 にんまえ: portion of food",
    ]);
  });

  it("merges an entry without a reading into the first with its headword", () => {
    assert.deepStrictEqual(lookup("割"), [
      // a character entry ranks last, and joins the first
      "割 かつ: cut, division, divide, proportion",
    ]);
  });

  it("takes a reading in katakana and in hiragana as one", () => {
    assert.deepStrictEqual(lookup("三"), [
      "三 さん: three, 3, three",
      "三 み: three",
    ]);
  });
});
