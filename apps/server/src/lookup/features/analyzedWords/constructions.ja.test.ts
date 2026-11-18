import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../../lookup.ts";
import { dictionary, languageOf } from "../../testing/dictionary.ts";

/** Constructions with a word in them, and する's set phrases. */
describe("constructions", () => {
  const words = dictionary([
    ["お…する", "AUX", [], ["humble"], "grammar"],
    ["お…になる", "AUX", [], ["honorific"], "grammar"],
    ["お…ください", "AUX", [], ["please"], "grammar"],
    ["します", "AUX", ["しました"], ["polite する"], "grammar"],
    ["ます", "AUX", [], ["polite"], "grammar"],
    ["た", "AUX", [], ["past"], "grammar"],
    ["がする", "AUX", [], ["there is a sound"], "grammar"],
    ["送る", "VERB", ["送り"], ["to send"]],
    ["待つ", "VERB", ["待ち"], ["to wait"]],
    ["書く", "VERB", ["書き"], ["to write"]],
    ["案内する", "VERB", ["案内"], ["to guide"]],
    ["勉強する", "VERB", ["勉強"], ["to study"]],
    ["する", "VERB", ["し", "します"], ["to do"]],
    ["し", "PART", [], ["and (listing reasons)"]],
    ["し", "PRON", [], ["he, she"]],
    ["音", "NOUN", [], ["sound"]],
    ["が", "PART", [], ["subject marker"]],
  ]);
  const language = languageOf("ja_en");
  const lemmas = (word: string, context: string) =>
    lookupWord(words, language, word, context, 1).entries.map(
      (entry) => `${entry.lemma}${entry.match ? ` (${entry.match[0]})` : ""}`,
    );

  it("finds お + a verb's stem + する, with the stem's own entries after", () => {
    assert.deepStrictEqual(lemmas("送", "お送りします。"), [
      "お…する (お送りします)",
      "送る (お送り)",
    ]);
    assert.deepStrictEqual(
      lemmas("案内", "ご案内します。")[0],
      "お…する (ご案内します)",
    );
    assert.deepStrictEqual(
      lemmas("待", "お待ちください。")[0],
      "お…ください (お待ちください)",
    );
    // になる over the two words after the stem
    assert.deepStrictEqual(
      lemmas("書", "先生がお書きになった。")[0],
      "お…になる (お書きになった)",
    );
  });

  it("shows します as a whole, by its line, then する", () => {
    assert.deepStrictEqual(lemmas("し", "します。"), [
      "します (します)",
      "する (します)",
    ]);
    // し the verb: not the particle or the pronoun
    assert.notInclude(
      lemmas("し", "お送りします。").map((lemma) => lemma.split(" ")[0]),
      "し",
    );
    // after a する-noun, one segment
    const { segments } = lookupWord(words, language, "し", "勉強します。", 1);
    assert.deepStrictEqual(
      segments?.map((segment) => segment.text),
      ["勉強", "します"],
    );
  });

  it("finds a grammar line the analyzer reads alone as one word (がする)", () => {
    assert.deepStrictEqual(lemmas("が", "音がする。")[0], "がする (がする)");
  });
});
