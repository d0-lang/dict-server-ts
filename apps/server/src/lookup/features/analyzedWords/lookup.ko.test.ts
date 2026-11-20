import { assert, describe, it } from "@effect/vitest";
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

describe("Korean words, cut by ko-dic", () => {
  it("finds a verb by its stem with 다, and its endings with hyphens", () => {
    // ko-dic: 먹 + 었 + 습니다; Wiktionary: 먹다, -었-, -습니다.
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
    // ko-dic: 공부 + 했 (하 + 았) + 어요.
    assert.strictEqual(first("공부했어요", "어제 공부했어요."), "공부하다");
  });

  it("finds a verb whose stem changes by its table forms (stemForms)", () => {
    // ko-dic reads 들 as 들다's stem; 들어 is 듣다's form too.
    const lemmas = lookup("들었는데", "음악을 들었는데 좋았다.").entries.map(
      (entry) => entry.lemma,
    );
    assert.include(lemmas, "듣다");
  });

  it("reads 이 after a noun as a particle, though ko-dic lacks it (restore)", () => {
    // Lindera's ko-dic: 생 + 각이.
    assert.deepStrictEqual(parts("생각이", "그런 생각이 들어요."), [
      "생각: 생각",
      "이: -이",
    ]);
    // A word that ends in 이 stays whole.
    assert.strictEqual(first("호랑이는", "호랑이는 크다."), "호랑이");
  });

  it("reads 이 at a word's start before a particle as the pronoun", () => {
    // ko-dic: 이를 as 이르다 + -ㄹ.
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
    // ko-dic: 하 + 지만, and 하 + 지.
    assert.strictEqual(first("하지만", "하지만 괜찮아요."), "하지만");
    assert.strictEqual(first("하지", "그 일을 하지 말라."), "하다");
    assert.strictEqual(first("다른", "다른 사람이 왔다."), "다른");
  });

  it("ranks entries by ko-dic's part of speech (ranksByPos)", () => {
    // 우리 the pronoun, before 우리 "cage".
    const { entries } = lookup("우리", "우리 집에 와요.");
    assert.strictEqual(entries[0]!.pos, "PRON");
    // A counter before the noun spelled alike.
    assert.strictEqual(lookup("년에", "2024년에 왔다.").entries[0]!.pos, "X");
  });

  it("reads a particle after Latin letters as the particle", () => {
    // The segmenter gives 가 alone in TV가.
    assert.strictEqual(first("가", "그 TV가 사라졌다."), "-가");
  });
});
