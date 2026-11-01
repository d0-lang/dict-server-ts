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

describe("transformEntry", () => {
  it("keeps real senses, last gloss, and skips archaic and Middle Polish ones", () => {
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
    assert.deepStrictEqual(result.entry?.senses, [
      ["silver nitrate"],
      ["light lilac colour"],
    ]);
    assert.deepStrictEqual(result.skippedSenses, {
      archaic: 1,
      "historical-stage": 1,
      "no-gloss": 0,
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
    assert.deepStrictEqual(result.entry?.senses, [["diminutive of kotek"]]);
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
      assert.deepStrictEqual(result.entry?.senses, [[gloss]]);
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
    assert.deepStrictEqual(result.historicalEntry?.senses, [["prince"]]);
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
});
