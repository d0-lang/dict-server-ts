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

describe("Korean words, cut by Kiwi", () => {
  it("finds a verb by its stem with 다, and its endings with hyphens", () => {
    // Kiwi: 먹 + 었 + 습니다; Wiktionary: 먹다, -었-, -습니다.
    assert.strictEqual(first("먹었습니다", "많이 먹었습니다."), "먹다");
    assert.deepStrictEqual(parts("먹었습니다", "많이 먹었습니다."), [
      "먹: 먹다",
      "었: -었-",
      "습니다: -습니다",
    ]);
  });

  it("finds a particle by its hyphenated spelling, not a word spelled alike", () => {
    assert.deepStrictEqual(parts("학교에서", "학교에서 공부해요."), [
      "학교: 학교",
      "에서: -에서",
    ]);
  });

  it("reads a noun with 하다 as the verb (stemSuffixes)", () => {
    // Kiwi: 공부 + 했 (하 + 었) + 어요.
    assert.strictEqual(first("공부했어요", "어제 공부했어요."), "공부하다");
  });

  it("finds a verb whose stem changes", () => {
    // Kiwi reads 들 as 듣다's stem here; ko-dic read 들다.
    const lemmas = lookup("들었는데", "음악을 들었는데 좋았다.").entries.map(
      (entry) => entry.lemma,
    );
    assert.strictEqual(lemmas[0], "듣다");
  });

  it("reads 이 after a noun as a particle", () => {
    // Lindera's ko-dic, which lacks 이, read 생 + 각이.
    assert.deepStrictEqual(parts("생각이", "그런 생각이 들어요."), [
      "생각: 생각",
      "이: -이",
    ]);
    // A word that ends in 이 stays whole.
    assert.strictEqual(first("호랑이는", "호랑이는 크다."), "호랑이");
  });

  it("reads 이 at a word's start before a particle as the pronoun", () => {
    // ko-dic read 이를 as 이르다 + -ㄹ.
    const { entries } = lookup("이를", "이를 통해 알 수 있다.");
    assert.oneOf(entries[0]!.lemma, ["이"]);
    assert.notInclude(
      entries.map((entry) => entry.lemma),
      "이르다",
    );
  });

  it("takes no single verb for a phrase, with spaces (우리다 is no phrase)", () => {
    assert.strictEqual(first("우리는", "오늘날 우리는 어떤가요?"), "우리");
  });

  it("puts a headword spelled as written first, not a noun spelled alike", () => {
    // The analyzer: 하 + 지만, and 하 + 지.
    assert.strictEqual(first("하지만", "하지만 괜찮아요."), "하지만");
    assert.strictEqual(first("하지", "그 일을 하지 말라."), "하다");
    assert.strictEqual(first("다른", "다른 사람이 왔다."), "다른");
  });

  it("ranks entries by Kiwi's part of speech (ranksByPos)", () => {
    // 우리 the pronoun, before 우리 "cage".
    const { entries } = lookup("우리", "우리 집에 와요.");
    assert.strictEqual(entries[0]!.pos, "PRON");
  });

  it("reads the word after a number as a counter (numbers, counters)", () => {
    // The segmenter gives 번 alone in 3번.
    assert.strictEqual(lookup("번", "3번 갔다.").entries[0]!.pos, "X");
  });

  it("reads a particle after Latin letters as the particle", () => {
    // The segmenter gives 가 alone in TV가.
    assert.strictEqual(first("가", "그 TV가 사라졌다."), "-가");
  });

  it("reads the copula Kiwi gives no letters of with the ending after it", () => {
    // Kiwi: 냄새 + 이 (length 0) + 야, so 야 is the copula, not "hey".
    assert.deepStrictEqual(parts("냄새야", "이게 뭔 냄새야?"), [
      "냄새: 냄새",
      "야: -이다, -야",
    ]);
  });

  it("reads nouns written together as the compound (compoundPos)", () => {
    // Kiwi: 양자 + 역학.
    assert.strictEqual(first("양자역학에", "양자역학에 따르면"), "양자역학");
    // No entry for 발색단: its longest known parts.
    assert.deepStrictEqual(parts("발색단에", "광자가 발색단에 의해 흡수되면"), [
      "발색: 발색",
      "단: 단",
      "에: -에",
    ]);
  });

  it("shows a noun Kiwi doesn't know by the nouns in it", () => {
    // Kiwi reads 간송미술관 as one unknown name.
    assert.deepStrictEqual(parts("간송미술관에서", "간송미술관에서 보관중인"), [
      "간송: ",
      "미술관: 미술관",
      "에서: -에서",
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

  it("starts no construction at the ending of an adverb", () => {
    // 어떻게 "how" is a word of its own: 어떻게 한 is no -게 하다.
    assert.notStrictEqual(first("한", "아빠 어떻게 한 거야?"), "-게 하다");
    assert.strictEqual(first("하고", "환경을 좋게 하고 있다."), "-게 하다");
  });

  it("reads an auxiliary verb with the verb before it (auxiliaries)", () => {
    assert.strictEqual(
      first("전해진다고", "시간을 넘어 전해진다고."),
      "전해지다",
    );
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

  it("reads no word across a space (no multi-word dictionary)", () => {
    // Kiwi's multi-word dictionary has 백일의 낭군님, a drama's title.
    assert.strictEqual(
      first("백일의", "나 백일의 낭군님만 보거든 요즘에."),
      "백",
    );
  });
});
