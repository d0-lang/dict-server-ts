import { assert, describe, it } from "@effect/vitest";
import { decodeLanguage, languageCodes, readLanguage } from "./language.ts";

describe("language records", () => {
  it("reads every language.toml", () => {
    const codes = languageCodes();
    assert.deepStrictEqual(codes, [
      "de",
      "es",
      "fr",
      "it",
      "ja",
      "pl",
      "ru",
      "uk",
    ]);
    for (const code of codes) assert.strictEqual(readLanguage(code).code, code);
  });

  it("fills in defaults for keys left out", () => {
    const language = decodeLanguage({ code: "xx", name: "X", target: "en" });
    assert.deepStrictEqual(language.optionalLetters, []);
    assert.deepStrictEqual(language.import, {
      historicalStages: [],
      standardPronNotes: [],
      untrustedFormTags: [],
      ownEntryForms: [],
      stressedLemmas: false,
      headwordGenders: false,
      unmarkedStressForms: false,
      headwordInflections: false,
      verbChainsThroughEntries: false,
    });
    assert.deepStrictEqual(language.context, {
      verbBracket: false,
      hyphenWords: false,
      reflexives: [],
      maxGap: 1,
      separableVerbs: false,
      clauseConjunctions: [],
      contractions: {},
      verbAfter: [],
      verbBeforeJoined: [],
      noVerbAfter: [],
      participleEndings: [],
      abbreviationLeads: [],
      reflexiveParticles: [],
      capitalNouns: false,
      nominalizers: [],
    });
    assert.isUndefined(language.compounds);
    assert.strictEqual(language.elision, false);
    assert.deepStrictEqual(language.headword, {
      labels: ["Gender", "Animacy", "Aspect", "Number"],
    });
  });

  it("rejects unknown keys", () => {
    assert.throws(() =>
      decodeLanguage({
        code: "xx",
        name: "X",
        target: "en",
        context: { maxgap: 2 },
      }),
    );
  });

  // `every` is true on an empty list, so an empty stage would match all data.
  it("has no empty historical stage", () => {
    for (const code of languageCodes()) {
      for (const stage of readLanguage(code).import.historicalStages) {
        assert.isAbove(stage.length, 0, code);
      }
    }
  });

  it("names the file and the known codes when a record is missing", () => {
    assert.throws(
      () => readLanguage("xx"),
      /known: de, es, fr, it, ja, pl, ru/,
    );
  });
});
