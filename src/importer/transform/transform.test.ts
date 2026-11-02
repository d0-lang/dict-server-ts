import { assert, describe, it } from "@effect/vitest";
import { LANGUAGES } from "./languages.ts";
import { transformEntry } from "./transform.ts";
import type { WiktextractEntry } from "../source/wiktextract.ts";

const pl = LANGUAGES.pl!;

const entry = (patch: Partial<WiktextractEntry>): WiktextractEntry => ({
  word: "lapis",
  pos: "noun",
  lang_code: "pl",
  ...patch,
});

const translations = (result: ReturnType<typeof transformEntry>) =>
  result.entry?.senses.map((s) => s.translations);

describe("transformEntry", () => {
  it("keeps real senses, groups nested ones, and skips archaic and Middle Polish ones", () => {
    const result = transformEntry(
      pl,
      entry({
        senses: [
          { glosses: ["silver nitrate"], tags: ["inanimate"] },
          { glosses: ["light grey colour"], tags: ["archaic"] },
          { glosses: ["stone"], tags: ["Middle", "Polish"] },
          { glosses: ["colour", "light lilac colour"] },
          { glosses: ["silver nitrate"] },
        ],
      }),
    );
    assert.deepStrictEqual(translations(result), [
      ["silver nitrate"],
      ["colour", "light lilac colour"],
    ]);
    assert.deepStrictEqual(result.skippedSenses, {
      archaic: 1,
      "historical-stage": 1,
      "no-gloss": 0,
      placeholder: 0,
    });
  });

  it("maps unknown parts of speech to X", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "-ek",
        pos: "suffix",
        senses: [{ glosses: ["diminutive suffix"] }],
      }),
    );
    assert.strictEqual(result.entry?.pos, "X");
    assert.strictEqual(result.entry?.sourcePos, "suffix");
  });

  it("filters junk and related words out of forms", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "dobry",
        pos: "adj",
        senses: [{ glosses: ["good"] }],
        forms: [
          { form: "no-table-tags", tags: ["table-tags"], source: "declension" },
          {
            form: "pl-decl-adj",
            tags: ["inflection-template"],
            source: "declension",
          },
          { form: "dobry", tags: ["canonical"] },
          { form: "lepszy", tags: ["comparative"] },
          { form: "dobrze", tags: ["adverb"] },
          { form: "dobroć", tags: ["derived", "noun"] },
          { form: "Dobrego", tags: ["genitive"], source: "declension" },
          { form: "będzie dobry", tags: ["future"], source: "declension" },
          { form: "-", tags: ["vocative"], source: "declension" },
          {
            form: "dobrzenie",
            tags: ["noun-from-verb"],
            source: "conjugation",
          },
          { form: "dobrzy", tags: ["Middle", "Polish"], source: "declension" },
        ],
      }),
    );
    assert.deepStrictEqual(result.entry?.forms, ["lepszy", "dobrego"]);
    assert.strictEqual(result.droppedForms, 9);
  });

  it("turns form-of and alt-of senses into fallback links, not entries", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "Domu",
        senses: [
          {
            glosses: ["genitive singular of dom"],
            tags: ["form-of", "genitive"],
            form_of: [{ word: "dom" }],
          },
          {
            glosses: ["old spelling of dom"],
            tags: ["alt-of", "Middle", "Polish"],
            alt_of: [{ word: "dóm" }],
          },
        ],
      }),
    );
    assert.strictEqual(result.entry, undefined);
    assert.deepStrictEqual(result.formOf, [
      { form: "domu", lemma: "dom", sourcePos: "noun" },
    ]);
  });

  it("gives derived words an entry instead of a link", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "koteczek",
        senses: [
          {
            glosses: ["diminutive of kotek"],
            tags: ["form-of", "diminutive"],
            form_of: [{ word: "kotek" }],
          },
        ],
        forms: [{ form: "koteczka", source: "declension" }],
      }),
    );
    assert.deepStrictEqual(translations(result), [["diminutive of kotek"]]);
    assert.deepStrictEqual(result.entry?.forms, ["koteczka"]);
    assert.deepStrictEqual(result.entry?.derived, [
      { gloss: "diminutive of kotek", bases: ["kotek"] },
    ]);
    assert.deepStrictEqual(result.formOf, []);
  });

  it("copies nothing when the derived gloss already has a meaning", () => {
    for (const gloss of [
      "diminutive of dziewczyna; little girl",
      "female equivalent of nauczyciel (“teacher”) (person who teaches)",
      "initialism of Foo Bar: a country",
    ]) {
      const result = transformEntry(
        pl,
        entry({
          senses: [
            {
              glosses: [gloss],
              tags: ["form-of"],
              form_of: [{ word: gloss.includes("Foo") ? "Foo Bar" : "x" }],
            },
          ],
        }),
      );
      assert.deepStrictEqual(translations(result), [[gloss]]);
      assert.deepStrictEqual(result.entry?.derived, []);
    }
  });

  it("treats a romanization as part of a bare derived gloss", () => {
    const result = transformEntry(
      pl,
      entry({
        senses: [
          {
            glosses: ["diminutive of па́лка (pálka)"],
            tags: ["form-of"],
            form_of: [{ word: "па́лка" }],
          },
        ],
      }),
    );
    assert.deepStrictEqual(result.entry?.derived[0]?.bases, ["па́лка"]);
  });

  it("hands the table of a word with no entry to its target", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "tańszy",
        pos: "adj",
        senses: [
          {
            glosses: ["comparative degree of tani"],
            tags: ["form-of", "comparative"],
            form_of: [{ word: "tani" }],
          },
        ],
        forms: [{ form: "tańsi", source: "declension" }],
      }),
    );
    assert.strictEqual(result.entry, undefined);
    assert.deepStrictEqual(result.formOf, [
      { form: "tańszy", lemma: "tani", sourcePos: "adj" },
      { form: "tańsi", lemma: "tani", sourcePos: "adj" },
    ]);
  });

  it("offers historical senses only as a last-resort entry", () => {
    const result = transformEntry(
      pl,
      entry({ senses: [{ glosses: ["prince"], tags: ["Middle", "Polish"] }] }),
    );
    assert.strictEqual(result.entry, undefined);
    assert.deepStrictEqual(
      result.historicalEntry?.senses.map((s) => s.translations),
      [["prince"]],
    );
  });

  it("prefers standard IPA and keeps https audio, deduplicated", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "dom",
        senses: [{ glosses: ["house"] }],
        sounds: [
          { ipa: "/ˈdɔm/" },
          { ipa: "/ˈdɔm/", note: "normal speech" },
          { ipa: "/ˈdum/", note: "Masovia" },
          { ipa: "/ˈdɔːm/", tags: ["Middle", "Polish"] },
          {
            ogg_url: "https://upload.wikimedia.org/a/Pl-dom.ogg",
            mp3_url: "https://upload.wikimedia.org/a/Pl-dom.mp3",
          },
          { ogg_url: "https://upload.wikimedia.org/a/Pl-dom.ogg" },
        ],
      }),
    );
    assert.deepStrictEqual(result.entry?.pronunciations, [
      { kind: "ipa", value: "/ˈdɔm/" },
      { kind: "audio", value: "https://upload.wikimedia.org/a/Pl-dom.ogg" },
      { kind: "audio", value: "https://upload.wikimedia.org/a/Pl-dom.mp3" },
    ]);
  });

  it("falls back to regional IPA when there is nothing standard", () => {
    const result = transformEntry(
      pl,
      entry({
        senses: [{ glosses: ["x"] }],
        sounds: [{ ipa: "/a/", note: "Masovia" }],
      }),
    );
    assert.deepStrictEqual(result.entry?.pronunciations, [
      { kind: "ipa", value: "/a/" },
    ]);
  });

  it("accepts string etymology numbers", () => {
    const result = transformEntry(
      pl,
      entry({ etymology_number: "2", senses: [{ glosses: ["x"] }] }),
    );
    assert.strictEqual(result.entry?.etymology, 2);
  });

  it("merges children under their parent and drops its separate copy", () => {
    const king = "king (male monarch)";
    const result = transformEntry(
      pl,
      entry({
        word: "król",
        senses: [
          { glosses: [king, "synonym of państwo"] },
          { glosses: ["chess king"] },
          { glosses: [king, "king and queen"] },
          { glosses: [king] },
          { glosses: ["a:", "b:", "c"] },
          { glosses: ["a:", "b:", "d"] },
          { glosses: ["Several places in Canada:", "Ontario"] },
        ],
      }),
    );
    assert.deepStrictEqual(translations(result), [
      [king, "synonym of państwo", "king and queen"],
      ["chess king"],
      ["a", "b", "c", "d"],
      ["Several places in Canada", "Ontario"],
    ]);
    assert.deepStrictEqual(result.parentGlosses, [
      king,
      "a",
      "b",
      "Several places in Canada",
    ]);
  });

  it("keeps the parent of a skipped child unless the parent has the label", () => {
    const result = transformEntry(
      pl,
      entry({
        senses: [
          {
            glosses: ["alive", "dead child"],
            raw_glosses: ["alive", "(archaic) dead child"],
            tags: ["archaic"],
          },
          {
            glosses: ["old parent", "child"],
            raw_glosses: ["(obsolete) old parent", "child"],
            tags: ["archaic"],
          },
          {
            glosses: ["stage parent", "child"],
            raw_glosses: ["(Middle Polish, music) stage parent", "child"],
            tags: ["Middle", "Polish"],
          },
        ],
      }),
    );
    assert.deepStrictEqual(translations(result), [["alive"]]);
  });

  it("drops placeholders at every level and keeps what they hold", () => {
    const placeholder = "The meaning of this term is uncertain.";
    const result = transformEntry(
      pl,
      entry({
        senses: [
          { glosses: [`${placeholder} Possibilities include:`, "queen ant"] },
          { glosses: ["character:", placeholder] },
          { glosses: [placeholder] },
        ],
      }),
    );
    assert.deepStrictEqual(translations(result), [["queen ant"], ["character"]]);
    assert.strictEqual(result.skippedSenses.placeholder, 1);
    assert.deepStrictEqual(result.parentGlosses, []);

    const only = transformEntry(pl, entry({ senses: [{ glosses: [placeholder] }] }));
    assert.strictEqual(only.entry, undefined);
  });

  it("keeps a gloss that only looks like a form-of link", () => {
    const greeting = "Form of greeting; hi; hello";
    const result = transformEntry(
      pl,
      entry({
        word: "cześć",
        senses: [
          {
            glosses: [greeting],
            tags: ["form-of"],
            form_of: [{ word: "greeting" }],
          },
        ],
      }),
    );
    assert.deepStrictEqual(translations(result), [[greeting]]);
    assert.deepStrictEqual(result.formOf, []);
  });

  it("turns untagged grammar pointers into links", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "sensie",
        senses: [
          {
            glosses: ["vocative/locative singular of sens"],
            links: [["sens", "sens#Polish"]],
          },
          {
            glosses: ["old dative of prosty"],
            links: [["prosty", "prosty#Polish"]],
          },
        ],
      }),
    );
    assert.strictEqual(result.entry, undefined);
    assert.deepStrictEqual(
      result.formOf.map((l) => l.lemma),
      ["sens", "prosty"],
    );
  });

  it("drops a grammar parent, keeps its children and links to its target", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "sobie",
        pos: "pron",
        senses: [
          {
            glosses: ["dative/locative singular of się:", "oneself"],
            links: [["się", "się#Polish"]],
          },
          {
            glosses: ["dative/locative singular of się:", "each other"],
            links: [["się", "się#Polish"]],
          },
        ],
      }),
    );
    assert.deepStrictEqual(translations(result), [["oneself"], ["each other"]]);
    assert.deepStrictEqual(result.parentGlosses, []);
    assert.deepStrictEqual(result.formOf, [
      { form: "sobie", lemma: "się", sourcePos: "pron", pointer: true },
    ]);
  });

  it("does not read ordinary glosses as grammar pointers", () => {
    for (const glosses of [
      ["forms genitive singular of neuter nouns"],
      ["locative of something unlinked"],
    ]) {
      const result = transformEntry(pl, entry({ senses: [{ glosses }] }));
      assert.deepStrictEqual(translations(result), [glosses]);
    }
  });

  it("cleans headings off form-of targets", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "sensie",
        senses: [
          {
            glosses: ["locative of sens"],
            tags: ["form-of"],
            form_of: [{ word: "sens==Polish==" }],
          },
        ],
      }),
    );
    assert.strictEqual(result.formOf[0]?.lemma, "sens");
  });

  it("takes synonym targets from links, ignoring labels and other languages", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "pies",
        senses: [
          {
            glosses: ["synonym of strunnik"],
            links: [
              ["music", "music"],
              ["strunnik", "strunnik#Polish"],
              ["strunnik", "strunnik#Czech"],
            ],
          },
          { glosses: ["dog"], links: [["dog", "dog"]] },
        ],
      }),
    );
    assert.deepStrictEqual(result.entry?.senses, [
      { translations: ["synonym of strunnik"], see: ["strunnik"] },
      { translations: ["dog"], see: [] },
    ]);
  });
});
