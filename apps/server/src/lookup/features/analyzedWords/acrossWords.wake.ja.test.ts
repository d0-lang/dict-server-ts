import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../../lookup.ts";
import { dictionary, languageOf } from "../../testing/dictionary.ts";

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
