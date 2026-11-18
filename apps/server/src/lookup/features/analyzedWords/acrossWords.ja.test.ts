import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../../lookup.ts";
import { dictionary, languageOf } from "../../testing/dictionary.ts";

/**
 * A piece the analyzer cuts at a particle (`なる|ほど`, `と|も`) that the
 * dictionary has as a word of its own.
 */
describe("a piece cut at a particle that is a word of its own", () => {
  const words = dictionary([
    ["成程", "INTJ", ["なるほど"], ["I see!"]],
    ["成る", "VERB", ["なる", "なれ"], ["to become"]],
    ["ほど", "PART", [], ["as much as"]],
    ["なんて", "PART", [], ["things like"]],
    ["何", "PRON", ["なん"], ["what"]],
    ["とも", "PART", [], ["of course"]],
    ["とも", "NOUN", [], ["friend"]],
    ["と", "PART", [], ["and, with"]],
    ["も", "PART", [], ["also"]],
  ]);
  const language = languageOf("ja_en");
  const shown = (word: string, context: string) => {
    const { entries, segments } = lookupWord(words, language, word, context, 1);
    return {
      entries: entries.map((entry) => `${entry.lemma} ${entry.pos}`),
      segments: segments?.map((segment) => segment.text),
    };
  };

  it("puts its own entries first where it starts a clause or ends a sentence", () => {
    assert.deepStrictEqual(shown("なるほど", "結構ありますなるほど。"), {
      entries: ["成程 INTJ", "成る VERB", "ほど PART"],
      segments: ["なる", "ほど"],
    });
    assert.deepStrictEqual(
      shown("なんて", "うん、なんて言うんですか").entries.slice(0, 2),
      ["なんて PART", "何 PRON"],
    );
  });

  it("shows only its parts inside a clause", () => {
    assert.deepStrictEqual(
      shown("なるほど", "大きくなればなるほど高い。").entries,
      ["成る VERB", "ほど PART"],
    );
    assert.deepStrictEqual(shown("とも", "博物館とも呼ばれている。").entries, [
      "と PART",
      "も PART",
    ]);
  });

  it("never takes a noun as such a word", () => {
    // ends a sentence: とも "of course", not とも "friend"
    assert.deepStrictEqual(shown("とも", "行くとも。").entries, [
      "とも PART",
      "と PART",
      "も PART",
    ]);
  });
});

/** A piece cut across words keeps each word's parts; constructions after them. */
describe("a piece across words, and わけ / な", () => {
  const words = dictionary([
    ["わけだ", "AUX", ["わけです"], ["that's why"], "grammar"],
    ["な", "X", [], ["だ before a noun"], "grammar"],
    ["て", "PART", [], ["and"], "grammar"],
    ["てしまう", "AUX", [], ["end up"], "grammar"],
    ["た", "AUX", [], ["past"], "grammar"],
    ["接続する", "VERB", ["接続"], ["to connect"]],
    ["する", "VERB", ["し"], ["to do"]],
    ["わけ", "NOUN", [], ["reason"]],
    ["静か", "ADJ", [], ["quiet"]],
    ["部屋", "NOUN", [], ["room"]],
    ["な", "PART", [], ["don't"]],
    ["行く", "VERB", [], ["to go"]],
  ]);
  const language = languageOf("ja_en");
  const parts = (word: string, context: string) => {
    const { entries, segments } = lookupWord(words, language, word, context, 1);
    return segments?.map(
      (segment) =>
        `${segment.text}: ${(segment.entries ?? []).map((i) => entries[i]!.lemma).join(", ")}`,
    );
  };

  it("keeps the verb's segments when the piece runs into the next word, with わけだ", () => {
    // A browser segmenter sends たわけ ("fool"), cut across 接続してしまった|わけ.
    assert.deepStrictEqual(parts("たわけ", "接続してしまったわけですが。"), [
      "接続: 接続する",
      "して: する, て",
      "しまった: てしまう, た",
      "わけ: わけだ, わけ",
    ]);
  });

  it("joins な to a な-adjective, by its own line; な alone keeps the particle first", () => {
    assert.deepStrictEqual(parts("な", "静かな部屋。"), ["静か: ", "な: な"]);
    const alone = lookupWord(words, language, "な", "行くな。", 1);
    assert.deepStrictEqual(
      alone.entries.map((entry) => `${entry.lemma} ${entry.pos}`),
      ["な PART", "な X"],
    );
  });
});
