import { assert, beforeAll, describe, it } from "@effect/vitest";
import { loadAnalyzer } from "../../common/analyzer.ts";
import { lookupWord } from "../../lookup.ts";
import { languageOf } from "../../testing/dictionary.ts";
import { korean } from "../../testing/korean.ts";

const lookup = (word: string, context: string) =>
  lookupWord(korean, languageOf("ko_en"), word, context, 1);

const first = (word: string, context: string) =>
  lookup(word, context).entries[0]?.lemma;

/** The parts as `text: lemma, lemma`, for reading at a glance. */
const parts = (word: string, context: string) => {
  const { entries, segments } = lookup(word, context);
  return segments?.map(
    (segment) =>
      `${segment.text}: ${(segment.entries ?? []).map((i) => entries[i]!.lemma).join(", ")}`,
  );
};

// Kiwi's WebAssembly and model load asynchronously, once.
beforeAll(() => loadAnalyzer(languageOf("ko_en")), 60_000);

describe("Korean endings shown as parts", () => {
  it("reads the copula Kiwi gives no letters of with the ending after it", () => {
    // Kiwi: 냄새 + 이 (length 0) + 야, so 야 is the copula, not "hey".
    assert.deepStrictEqual(parts("냄새야", "이게 뭔 냄새야?"), [
      "냄새: 냄새",
      "야: -이다, -야",
    ]);
  });

  it("shows each ending of a word in a longer click (spacedWords)", () => {
    // 처음 + 이니까 are two words; 이니까 is a form of the copula, but -니까
    // "because" is what the reader needs.
    assert.deepStrictEqual(parts("처음이니까", "이 삶이 처음이니까."), [
      "처음: 처음",
      "이: -이다",
      "니까: -으니",
    ]);
  });

  it("shows each ending fused into one syllable", () => {
    // 신 is -시- (a form of -으시-) + -ㄴ.
    assert.deepStrictEqual(parts("오신", "선생님이 오신 날."), [
      "오: 오다",
      "신: -으시-, -ㄴ",
    ]);
  });

  it("shows what an ending adds to the copula fused into it", () => {
    // 라는 is the copula with no letters + -라는 "called" (a form of
    // -이라는): the grammar line first, then "to be".
    assert.deepStrictEqual(parts("수도라는", "한국의 수도라는 서울."), [
      "수도: 수도",
      "라는: -이라는, -이다",
    ]);
  });

  it("shows what a fused ending adds when it is clicked alone", () => {
    // After a quote the segmenter gives 라는 alone.
    assert.strictEqual(first("라는", "'벵골리' 라는 호랑이."), "-이라는");
  });
});
