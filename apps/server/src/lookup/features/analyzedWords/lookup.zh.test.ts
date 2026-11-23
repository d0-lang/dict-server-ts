import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../../lookup.ts";
import { chinese } from "../../testing/chinese.ts";
import { languageOf } from "../../testing/dictionary.ts";

const lookup = (word: string, context: string) =>
  lookupWord(chinese, languageOf("zh_en"), word, context, 1);

/** The first entry's lemma, and the parts as `text: lemma, lemma`. */
const shown = (word: string, context: string) => {
  const { entries, segments } = lookup(word, context);
  return [
    entries[0]?.lemma,
    ...(segments ?? []).map(
      (segment) =>
        `${segment.text}: ${(segment.entries ?? []).map((i) => entries[i]!.lemma).join(", ")}`,
    ),
  ];
};

describe("Chinese words, cut by the dictionary's own words", () => {
  it("cuts a run into the fewest words, the longer last word on a tie", () => {
    // 研究|生命, not 研究生|命: no graduate student around either piece.
    const lemmas = (word: string) =>
      lookup(word, "研究生命").entries.map((e) => e.lemma);
    assert.deepStrictEqual(lemmas("研究"), ["研究", "研", "究"]);
    assert.deepStrictEqual(lemmas("生命"), ["生命", "生", "命"]);
  });

  it("on a tie, leaves alone a letter that is a grammar word", () => {
    // 城市|里, not 城|市里: 里 "in" has a grammar line, 城 has none.
    assert.deepStrictEqual(
      lookup("里", "在城市里。").entries.map((e) => [e.lemma, e.match]),
      [
        ["里 (裡)", undefined],
        ["里", undefined],
      ],
    );
  });

  it("answers a piece the dictionary lacks by the words in it", () => {
    // The browser's segmenter sends 都很 as one piece.
    assert.deepStrictEqual(shown("都很", "研究生都很忙。"), [
      "都",
      "都: 都",
      "很: 很",
    ]);
  });

  it("finds a phrase only over whole words", () => {
    // 话 starts 话题: no 的话 "if" over 的|话题.
    assert.strictEqual(shown("话题", "技术的话题。")[0], "话题 (話題)");
  });

  it("shows a letter's grammar line before its other entries", () => {
    assert.deepStrictEqual(shown("都会", "他都会来。").slice(1), [
      "都: 都",
      "会: 会 (會), 会 (會)",
    ]);
  });

  it("cuts Han letters from digits and Latin letters written onto them", () => {
    assert.deepStrictEqual(shown("都很", "3研究生都很忙。"), [
      "都",
      "都: 都",
      "很: 很",
    ]);
  });

  it("shows a piece inside a longer word by its own entries, then the word", () => {
    // The browser cuts 他|都|会|来, the fewest words 他|都会|来.
    assert.deepStrictEqual(
      lookup("都", "他都会来。").entries.map((e) => [e.lemma, e.match]),
      [
        ["都", undefined],
        ["都会 (都會)", ["都会"]],
      ],
    );
  });

  it("shows the word a piece makes with its letters as parts", () => {
    assert.deepStrictEqual(shown("还没", "他还没来。"), [
      "还没 (還沒)",
      "还: 还 (還)",
      "没: 没 (沒)",
    ]);
  });

  it("finds a letter's entries in the other script among its parts", () => {
    // 机 is mostly 機 in simplified text, before its own "alder".
    assert.deepStrictEqual(shown("手机", "这个手机很好。"), [
      "手机 (手機)",
      "手: 手",
      "机: 机 (機), 机",
    ]);
  });
});
