import { assert, describe, it } from "@effect/vitest";
import { readLanguage } from "@dict/core/language";
import { importRules } from "./languages.ts";
import { rubyReading, transformEntry } from "./transform.ts";
import type { WiktextractEntry } from "../source/wiktextract.ts";

const pl = importRules(readLanguage("pl"));
const de = importRules(readLanguage("de"));
const ru = importRules(readLanguage("ru"));
const uk = importRules(readLanguage("uk"));

const entry = (patch: Partial<WiktextractEntry>): WiktextractEntry => ({
  word: "lapis",
  pos: "noun",
  lang_code: "pl",
  ...patch,
});

const glossesOf = (result: ReturnType<typeof transformEntry>) =>
  result.entry?.senses.map((s) => s.glosses);

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
    assert.deepStrictEqual(glossesOf(result), [
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

  it("takes cases from the headword line when the table lists none (`монета`)", () => {
    const forms = (
      table: ReadonlyArray<{ form: string; tags: Array<string> }>,
    ) =>
      transformEntry(
        uk,
        entry({
          word: "монета",
          pos: "noun",
          senses: [{ glosses: ["coin"] }],
          forms: [
            { form: "моне́та", tags: ["canonical", "feminine", "inanimate"] },
            { form: "моне́ти", tags: ["genitive"] },
            { form: "моне́ти", tags: ["nominative", "plural"] },
            { form: "моне́т", tags: ["genitive", "plural"] },
            { form: "моне́тка", tags: ["diminutive"] },
            {
              form: "uk-ndecl",
              tags: ["inflection-template"],
              source: "declension",
            },
            ...table.map((row) => ({ ...row, source: "declension" })),
          ],
        }),
      ).entry?.forms;
    // The table is all dashes: the headword line's cases are the forms.
    assert.deepStrictEqual(
      forms([{ form: "-", tags: ["genitive", "singular"] }]),
      ["монети", "монет"],
    );
    // With a real table, the headword line adds nothing.
    assert.deepStrictEqual(
      forms([{ form: "моне́тою", tags: ["instrumental", "singular"] }]),
      ["монетою"],
    );
  });

  it("takes nothing from the headword line of an entry without a table (`CIA`)", () => {
    const result = transformEntry(
      de,
      entry({
        word: "CIA",
        pos: "name",
        senses: [{ glosses: ["CIA"] }],
        forms: [
          { form: "das CIA", tags: ["canonical", "feminine", "neuter"] },
          { form: "der", tags: ["definite", "genitive"] },
          { form: "des CIA", tags: ["definite", "genitive"] },
        ],
      }),
    );
    assert.deepStrictEqual(result.entry?.forms, []);
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
    assert.deepStrictEqual(glossesOf(result), [["diminutive of kotek"]]);
    assert.deepStrictEqual(result.entry?.forms, ["koteczka"]);
    assert.deepStrictEqual(result.entry?.derived, [
      { gloss: "diminutive of kotek", bases: ["kotek"] },
    ]);
    assert.deepStrictEqual(result.formOf, []);
  });

  it("keeps an entry for a language's own form kinds (`ownEntryForms`)", () => {
    const passive = (rules: typeof uk) =>
      transformEntry(
        rules,
        entry({
          word: "використовуватися",
          pos: "verb",
          senses: [
            {
              glosses: ["passive of використовува́ти impf (vykorystovuváty)"],
              tags: ["form-of", "passive"],
              form_of: [{ word: "використовува́ти impf" }],
            },
          ],
        }),
      );
    // Ukrainian sets `passive`: the passive keeps its gloss and the verb's meaning.
    assert.deepStrictEqual(passive(uk).entry?.derived, [
      {
        gloss: "passive of використовува́ти impf (vykorystovuváty)",
        bases: ["використовувати"],
      },
    ]);
    assert.deepStrictEqual(passive(uk).formOf, []);
    // Without the setting it is a link to the verb, as before.
    assert.strictEqual(passive(ru).entry, undefined);
    assert.deepStrictEqual(
      passive(ru).formOf.map((link) => link.lemma),
      ["використовувати"],
    );
    // An adverbial participle is a verb form: still a link.
    const adverbial = transformEntry(
      uk,
      entry({
        word: "роблячи",
        pos: "verb",
        senses: [
          {
            glosses: ["present adverbial participle of роби́ти impf (robýty)"],
            tags: ["form-of", "participle"],
            form_of: [{ word: "роби́ти impf" }],
          },
        ],
      }),
    );
    assert.strictEqual(adverbial.entry, undefined);
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
      assert.deepStrictEqual(glossesOf(result), [[gloss]]);
      assert.deepStrictEqual(result.entry?.derived, []);
    }
  });

  it("keeps a form-of sense that names no target as a gloss", () => {
    const result = transformEntry(
      ru,
      entry({
        word: "продолжение",
        lang_code: "ru",
        senses: [
          {
            glosses: ["continuation (act or state of continuing)"],
            tags: ["form-of", "noun-from-verb"],
          },
        ],
      }),
    );
    assert.deepStrictEqual(glossesOf(result), [
      ["continuation (act or state of continuing)"],
    ]);
    assert.deepStrictEqual(result.formOf, []);
  });

  it("still links a form-of sense with a target", () => {
    const result = transformEntry(
      ru,
      entry({
        word: "собаки",
        lang_code: "ru",
        senses: [
          {
            glosses: ["genitive singular of соба́ка (sobáka)"],
            tags: ["form-of", "genitive", "singular"],
            form_of: [{ word: "соба́ка" }],
          },
        ],
      }),
    );
    assert.strictEqual(result.entry, undefined);
    assert.deepStrictEqual(
      result.formOf.map((link) => link.lemma),
      ["собака"],
    );
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
    // Bases are lookup keys, which drop Cyrillic stress marks.
    assert.deepStrictEqual(result.entry?.derived[0]?.bases, ["палка"]);
  });

  it("hands the table of a word with no entry to its target", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "taniego",
        pos: "adj",
        senses: [
          {
            glosses: ["genitive masculine singular of tani"],
            tags: ["form-of", "genitive", "masculine", "singular"],
            form_of: [{ word: "tani" }],
          },
        ],
        forms: [{ form: "taniemu", source: "declension" }],
      }),
    );
    assert.strictEqual(result.entry, undefined);
    assert.deepStrictEqual(result.formOf, [
      { form: "taniego", lemma: "tani", sourcePos: "adj" },
      { form: "taniemu", lemma: "tani", sourcePos: "adj" },
    ]);
  });

  it("gives comparatives and superlatives an entry of their own", () => {
    // A bare one gets its base word's meaning copied in, like a diminutive.
    const better = transformEntry(
      ru,
      entry({
        word: "лучше",
        lang_code: "ru",
        pos: "adv",
        senses: [
          {
            glosses: ["comparative degree of хоро́ший (xoróšij)"],
            tags: ["comparative", "form-of"],
            form_of: [{ word: "хоро́ший" }],
          },
        ],
      }),
    );
    assert.deepStrictEqual(glossesOf(better), [
      ["comparative degree of хоро́ший (xoróšij)"],
    ]);
    assert.deepStrictEqual(better.entry?.derived[0]?.bases, ["хороший"]);
    assert.deepStrictEqual(better.formOf, []);

    // One that already says what it means keeps that, and copies nothing.
    const later = transformEntry(
      ru,
      entry({
        word: "позже",
        lang_code: "ru",
        pos: "adv",
        senses: [
          {
            glosses: [
              "comparative degree of по́здний (pózdnij): later, afterwards",
            ],
            tags: ["comparative", "form-of"],
            form_of: [{ word: "по́здний" }],
          },
        ],
      }),
    );
    assert.deepStrictEqual(glossesOf(later), [
      ["comparative degree of по́здний (pózdnij): later, afterwards"],
    ]);
    assert.deepStrictEqual(later.entry?.derived, []);
  });

  it("keeps a causative's meaning instead of linking it to its base", () => {
    const lay = transformEntry(
      de,
      entry({
        word: "legen",
        lang_code: "de",
        pos: "verb",
        senses: [
          {
            glosses: ["causative of liegen: to lay; to put, place"],
            tags: ["causative", "form-of", "transitive"],
            form_of: [{ word: "liegen" }],
          },
          { glosses: ["to castrate"] },
        ],
      }),
    );
    assert.deepStrictEqual(glossesOf(lay), [
      ["causative of liegen: to lay; to put, place"],
      ["to castrate"],
    ]);
    assert.deepStrictEqual(lay.formOf, []);
  });

  it("still links an inflected form of a comparative to it", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "tańszego",
        pos: "adj",
        senses: [
          {
            glosses: ["genitive masculine singular of tańszy"],
            tags: ["form-of", "genitive", "masculine", "singular"],
            form_of: [{ word: "tańszy" }],
          },
        ],
      }),
    );
    assert.strictEqual(result.entry, undefined);
    assert.deepStrictEqual(
      result.formOf.map((link) => link.lemma),
      ["tańszy"],
    );
  });

  it("offers historical senses only as a last-resort entry", () => {
    const result = transformEntry(
      pl,
      entry({ senses: [{ glosses: ["prince"], tags: ["Middle", "Polish"] }] }),
    );
    assert.strictEqual(result.entry, undefined);
    assert.deepStrictEqual(
      result.historicalEntry?.senses.map((s) => s.glosses),
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
    assert.deepStrictEqual(glossesOf(result), [
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
    assert.deepStrictEqual(glossesOf(result), [["alive"]]);
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
    assert.deepStrictEqual(glossesOf(result), [["queen ant"], ["character"]]);
    assert.strictEqual(result.skippedSenses.placeholder, 1);
    assert.deepStrictEqual(result.parentGlosses, []);

    const only = transformEntry(
      pl,
      entry({ senses: [{ glosses: [placeholder] }] }),
    );
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
    assert.deepStrictEqual(glossesOf(result), [[greeting]]);
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
    assert.deepStrictEqual(glossesOf(result), [["oneself"], ["each other"]]);
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
      assert.deepStrictEqual(glossesOf(result), [glosses]);
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

  it("cleans the aspect off form-of targets (`розташува́ти pf`)", () => {
    // Under rules without `ownEntryForms`, so the participle is a link.
    const result = transformEntry(
      ru,
      entry({
        word: "розташований",
        pos: "verb",
        senses: [
          {
            glosses: ["adjectival past passive participle of розташува́ти pf"],
            tags: ["adjectival", "form-of", "participle", "passive", "past"],
            form_of: [{ word: "розташува́ти pf" }],
            links: [["розташува́ти", "розташувати#Ukrainian"]],
          },
          {
            glosses: ["inflection of узурпува́ти impf or pf"],
            tags: ["form-of"],
            form_of: [{ word: "узурпува́ти impf or pf" }],
          },
        ],
      }),
    );
    assert.strictEqual(result.entry, undefined);
    assert.deepStrictEqual(
      result.formOf.map((link) => link.lemma),
      ["розташувати", "узурпувати"],
    );
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
      { glosses: ["synonym of strunnik"], see: ["strunnik"] },
      { glosses: ["dog"], see: [] },
    ]);
  });

  it("does not index the perfect auxiliary as a form of the verb", () => {
    const result = transformEntry(
      de,
      entry({
        word: "fallen",
        pos: "verb",
        lang_code: "de",
        senses: [{ glosses: ["to fall"] }],
        forms: [
          { form: "fiel", tags: ["preterite"], source: "conjugation" },
          { form: "sein", tags: ["auxiliary"], source: "conjugation" },
        ],
      }),
    );
    assert.deepStrictEqual(result.entry?.forms, ["fiel"]);
  });

  it("reads a noun's or verb's grammar wherever the language puts it", () => {
    const features = (patch: Partial<WiktextractEntry>, rules = pl) =>
      transformEntry(rules, entry(patch)).entry?.features;
    // German and Polish: on every sense
    assert.strictEqual(
      features(
        {
          word: "See",
          lang_code: "de",
          senses: [
            { glosses: ["sea, ocean"], tags: ["feminine", "singular-only"] },
            { glosses: ["swell"], tags: ["feminine"] },
          ],
        },
        de,
      ),
      "Gender=Fem",
    );
    // Russian: on the canonical form
    assert.strictEqual(
      features(
        {
          word: "сделать",
          pos: "verb",
          lang_code: "ru",
          forms: [{ form: "сде́лать", tags: ["canonical", "perfective"] }],
          senses: [{ glosses: ["to do"] }],
        },
        ru,
      ),
      "Aspect=Perf",
    );
    // a tag on only some senses describes them, not the word
    assert.isUndefined(
      features({
        word: "jabłko",
        senses: [
          { glosses: ["apple"] },
          { glosses: ["apples"], tags: ["plural-only"] },
        ],
      }),
    );
    // names get no grammar
    assert.isUndefined(
      features({
        word: "Czech",
        pos: "name",
        senses: [{ glosses: ["a surname"], tags: ["masculine"] }],
      }),
    );
  });

  it("gives a verb's reflexive senses an entry of their own (`bawić się`)", () => {
    const bawic = transformEntry(
      pl,
      entry({
        word: "bawić",
        pos: "verb",
        forms: [
          { form: "bawię", tags: ["first-person", "singular", "present"] },
        ],
        senses: [
          {
            glosses: ["to amuse"],
            raw_glosses: ["(transitive) to amuse"],
            tags: ["transitive"],
          },
          {
            glosses: ["to play"],
            raw_glosses: ["(reflexive with się) to play"],
            tags: ["reflexive"],
          },
          {
            glosses: ["to imagine"],
            raw_glosses: ["(reflexive with sobie) to imagine"],
            tags: ["reflexive"],
          },
          // a bare tag doesn't say which particle, so the sense stays with the verb
          {
            glosses: ["to ask"],
            raw_glosses: ["(transitive) to ask"],
            tags: ["reflexive"],
          },
        ],
      }),
    );
    assert.deepStrictEqual(glossesOf(bawic), [["to amuse"], ["to ask"]]);
    assert.deepStrictEqual(
      bawic.reflexiveEntries?.map((e) => [
        e.lemma,
        e.senses.map((s) => s.glosses),
      ]),
      [
        ["bawić się", [["to play"]]],
        ["bawić sobie", [["to imagine"]]],
      ],
    );
    // found by the verb's forms, the verb itself included
    assert.deepStrictEqual(bawic.reflexiveEntries?.[0]?.forms, [
      "bawić",
      ...bawic.entry!.forms,
    ]);
  });

  it("makes a verb that is only reflexive one entry with its particle (`bać się`)", () => {
    const bac = transformEntry(
      pl,
      entry({
        word: "bać",
        pos: "verb",
        senses: [
          {
            glosses: ["to fear"],
            raw_glosses: ["(reflexive with się) to fear"],
            tags: ["reflexive"],
          },
        ],
      }),
    );
    assert.isUndefined(bac.entry);
    assert.deepStrictEqual(
      bac.reflexiveEntries?.map((e) => e.lemma),
      ["bać się"],
    );
  });

  it("leaves reflexive senses with the verb in a language without the setting", () => {
    const result = transformEntry(
      de,
      entry({
        word: "freuen",
        pos: "verb",
        lang_code: "de",
        senses: [
          {
            glosses: ["to be glad"],
            raw_glosses: ["(reflexive with sich) to be glad"],
            tags: ["reflexive"],
          },
        ],
      }),
    );
    assert.deepStrictEqual(glossesOf(result), [["to be glad"]]);
    assert.isUndefined(result.reflexiveEntries);
  });

  it("declines the adjectival participles a verb's table lists in the nominative", () => {
    const result = transformEntry(
      pl,
      entry({
        word: "wymagać",
        pos: "verb",
        forms: [
          {
            form: "wymagany",
            tags: [
              "adjectival",
              "masculine",
              "participle",
              "passive",
              "singular",
            ],
            source: "conjugation",
          },
          // only the masculine singular is declined from
          {
            form: "wymagana",
            tags: [
              "adjectival",
              "feminine",
              "participle",
              "passive",
              "singular",
            ],
            source: "conjugation",
          },
        ],
        senses: [{ glosses: ["to require"] }],
      }),
    );
    assert.includeMembers(
      [...(result.entry?.forms ?? [])],
      ["wymagany", "wymagana", "wymaganego", "wymaganej", "wymaganą"],
    );
    assert.notInclude([...(result.entry?.forms ?? [])], "wymaganaego");
  });

  it("declines German participles, which tables list undeclined", () => {
    const result = transformEntry(
      de,
      entry({
        word: "auslegen",
        lang_code: "de",
        pos: "verb",
        forms: [
          {
            form: "ausgelegt",
            tags: ["participle", "past"],
            source: "conjugation",
          },
          {
            form: "auslegend",
            tags: ["participle", "present"],
            source: "conjugation",
          },
          {
            form: "legte aus",
            tags: ["first-person", "preterite", "singular"],
            source: "conjugation",
          },
        ],
        senses: [{ glosses: ["to lay out"] }],
      }),
    );
    const forms = [...(result.entry?.participleForms ?? [])];
    assert.includeMembers(forms, [
      "ausgelegte",
      "ausgelegten",
      "ausgelegtem",
      "ausgelegter",
      "ausgelegtes",
      "auslegende",
    ]);
    assert.notInclude(forms, "legte ause");
  });
});

describe("rubyReading", () => {
  it("rebuilds the kana reading from the canonical form's ruby", () => {
    const ruby = (form: string, pairs: Array<[string, string]>) => ({
      form,
      tags: ["canonical"],
      ruby: pairs,
    });
    assert.strictEqual(
      rubyReading("食べる", [ruby("食べる", [["食", "た"]])]),
      "たべる",
    );
    assert.strictEqual(
      rubyReading("日本語", [
        ruby("日本語", [
          ["日", "に"],
          ["本", "ほん"],
          ["語", "ご"],
        ]),
      ]),
      "にほんご",
    );
    // a する-verb's canonical form adds する; the reading is the word's
    assert.strictEqual(
      rubyReading("勉強", [
        ruby("勉強する", [
          ["勉", "べん"],
          ["強", "きょう"],
        ]),
      ]),
      "べんきょう",
    );
  });

  it("reads a small ヶ, which ruby leaves bare, by the romanization", () => {
    const ruby = (form: string, pairs: Array<[string, string]>) => ({
      form,
      tags: ["canonical"],
      ruby: pairs,
    });
    const roman = (form: string) => ({ form, tags: ["romanization"] });
    const reading = (
      word: string,
      pairs: Array<[string, string]>,
      romanization?: string,
    ) =>
      rubyReading(word, [
        ruby(word, pairs),
        ...(romanization === undefined ? [] : [roman(romanization)]),
      ]);
    // か in a counter: the only g is げ's
    assert.strictEqual(
      reading(
        "三ヶ月",
        [
          ["三", "さん"],
          ["月", "げつ"],
        ],
        "sankagetsu",
      ),
      "さんかげつ",
    );
    // が in a name
    assert.strictEqual(
      reading(
        "茅ヶ崎",
        [
          ["茅", "ち"],
          ["崎", "さき"],
        ],
        "Chigasaki",
      ),
      "ちがさき",
    );
    // a name read か, with a g of its own (ご)
    assert.strictEqual(
      reading(
        "五ヶ瀬",
        [
          ["五", "ご"],
          ["瀬", "せ"],
        ],
        "Gokase",
      ),
      "ごかせ",
    );
    // か without a romanization
    assert.strictEqual(reading("ヶ所", [["所", "しょ"]]), "かしょ");
  });

  it("gives none without ruby, or when the ruby doesn't spell the word", () => {
    assert.isUndefined(
      rubyReading("コンピューター", [
        { form: "コンピューター", tags: ["canonical"] },
      ]),
    );
    assert.isUndefined(
      rubyReading("食べる", [
        { form: "食べる", tags: ["canonical"], ruby: [["飲", "の"]] },
      ]),
    );
  });
});
