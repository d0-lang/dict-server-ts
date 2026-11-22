import { assert, describe, it } from "@effect/vitest";
import { chinese } from "./testing/chinese.ts";
import { lemmas } from "./testing/dictionary.ts";

const shown = (word: string, context?: string) =>
  lemmas(chinese, "zh_en", word, context);

describe("Chinese headwords in both scripts", () => {
  it("shows the spelling the text uses first, the other in brackets", () => {
    // Its letters follow as its parts.
    assert.strictEqual(shown("学习", "我们一起学习。")[0], "学习 (學習)");
    assert.strictEqual(shown("學習", "我們一起學習。")[0], "學習 (学习)");
    assert.deepStrictEqual(shown("学习"), ["学习 (學習)"]);
  });

  it("shows a word written alike in both scripts as it is", () => {
    assert.deepStrictEqual(shown("很"), ["很"]);
  });

  it("opens a simplified letter on the word it mostly stands for, in simplified text", () => {
    assert.deepStrictEqual(shown("后", "三年后他来了。"), ["后 (後)", "后"]);
  });

  it("opens on the word as written in traditional text", () => {
    assert.deepStrictEqual(shown("后", "三年後與王后。"), ["后", "后 (後)"]);
  });

  it("keeps a letter's own word first where it is mostly itself", () => {
    // 面 "face" is not mostly 麵 "noodles", though it spells it too.
    assert.deepStrictEqual(shown("面", "他的面很红。"), ["面", "面 (麵)"]);
  });
});
