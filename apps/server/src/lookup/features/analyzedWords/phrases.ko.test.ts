import { assert, beforeAll, describe, it } from "@effect/vitest";
import { loadAnalyzer } from "../../common/analyzer.ts";
import { lookupWord } from "../../lookup.ts";
import { languageOf } from "../../testing/dictionary.ts";
import { korean } from "../../testing/korean.ts";

const lookup = (word: string, context: string) =>
  lookupWord(korean, languageOf("ko_en"), word, context, 1);

const first = (word: string, context: string) =>
  lookup(word, context).entries[0]?.lemma;

// Kiwi's WebAssembly and model load asynchronously, once.
beforeAll(() => loadAnalyzer(languageOf("ko_en")), 60_000);

describe("Korean constructions over words a space apart", () => {
  it("starts no construction at the ending of an adverb", () => {
    // 어떻게 "how" is a word of its own: 어떻게 한 is no -게 하다.
    assert.notStrictEqual(first("한", "아빠 어떻게 한 거야?"), "-게 하다");
    assert.strictEqual(first("하고", "환경을 좋게 하고 있다."), "-게 하다");
  });

  it("finds a construction over words a space apart, from an ending", () => {
    // 갈 is 가 + ㄹ: the construction is -ㄹ 수 있다.
    assert.strictEqual(first("수", "내일 갈 수 있다."), "-을 수 있다");
    assert.strictEqual(first("있다", "내일 갈 수 있다."), "-을 수 있다");
    // From a particle, a word of its own.
    assert.strictEqual(first("따라", "급수에 따라 다르다."), "-에 따라");
    // From a word's start.
    assert.strictEqual(first("들어", "예를 들어 사과."), "예를 들어");
  });
});
