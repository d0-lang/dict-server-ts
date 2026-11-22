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
    // 研究|生命, not 研究生|命.
    assert.deepStrictEqual(shown("研", "研究生命"), [
      "研究",
      "研: 研",
      "究: 究",
    ]);
    assert.deepStrictEqual(shown("命", "研究生命"), [
      "生命",
      "生: 生",
      "命: 命",
    ]);
  });

  it("answers a piece the dictionary lacks by the words in it", () => {
    // The browser's segmenter sends 都很 as one piece.
    assert.deepStrictEqual(shown("都很", "研究生都很忙。"), [
      "都",
      "都: 都",
      "很: 很",
    ]);
  });

  it("shows the word around a clicked letter, then its letters", () => {
    assert.deepStrictEqual(shown("还", "他还没来。"), [
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
