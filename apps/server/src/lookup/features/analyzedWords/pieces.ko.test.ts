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

describe("Korean nouns written together", () => {
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
});
