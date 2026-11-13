import { assert, describe, it } from "@effect/vitest";
import { hasKanji, hiragana, isKana } from "./kana.ts";

describe("kana", () => {
  it("tells a word written in kana alone", () => {
    assert.isTrue(isKana("ところ"));
    assert.isTrue(isKana("コーヒー"));
    assert.isFalse(isKana("食べる"));
    assert.isFalse(isKana("JR"));
    assert.isFalse(isKana(""));
  });

  it("tells a word with a kanji in it", () => {
    assert.isTrue(hasKanji("食べる"));
    assert.isFalse(hasKanji("たべる"));
  });

  it("writes katakana as hiragana and leaves the rest", () => {
    assert.strictEqual(hiragana("サン"), "さん");
    assert.strictEqual(hiragana("コーヒー"), "こーひー");
    assert.strictEqual(hiragana("食べル"), "食べる");
  });
});
