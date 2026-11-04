import { assert, describe, it } from "@effect/vitest";
import { tokenize } from "./context.ts";
import { createDictionaryFile, type DictionaryDb } from "./DictionaryDb.ts";
import { lookupWord } from "./lookup.ts";
import { caseClass, lookupKey } from "./lookupKey.ts";
import { surfaceSlices } from "./queries.ts";
import { FormSource, type UdPos } from "./schema.ts";

type Word = readonly [
  lemma: string,
  pos: UdPos,
  forms?: ReadonlyArray<string>,
  senses?: ReadonlyArray<string>,
];

/** A dictionary; each sense is one gloss, by default the lemma in brackets. */
const dictionary = (words: ReadonlyArray<Word>): DictionaryDb => {
  const db = createDictionaryFile(":memory:");
  words.forEach(([lemma, pos, forms = [], glosses = [`[${lemma}]`]], i) => {
    const id = i + 1;
    db.$client.run("INSERT INTO entries VALUES (?, ?, ?, '', 0, ?)", [
      id,
      lemma,
      pos,
      caseClass(lemma),
    ]);
    glosses.forEach((gloss, idx) =>
      db.$client.run("INSERT INTO senses VALUES (?, ?, ?, NULL)", [
        id,
        idx,
        JSON.stringify([gloss]),
      ]),
    );
    for (const [form, source] of [
      [lemma, FormSource.Lemma],
      ...forms.map((form) => [form, FormSource.Inflection] as const),
    ] as const) {
      db.$client.run("INSERT OR IGNORE INTO forms VALUES (?, ?, ?)", [
        lookupKey(form),
        id,
        source,
      ]);
    }
  });
  return db;
};

const german = dictionary([
  ["finden", "VERB", ["fand", "findet"]],
  ["stattfinden", "VERB", ["stattfand", "stattfindet", "fand statt"]],
  ["statt", "ADP"],
  ["gehen", "VERB", ["geht"]],
  ["mitgehen", "VERB", ["mitgeht"]],
  ["mit", "ADP"],
  ["vor", "ADP"],
  ["allem", "PRON"],
  ["vor allem", "ADV"],
  ["treten", "VERB", ["tritt", "trat", "getreten"]],
  ["Kraft", "NOUN"],
  ["in", "ADP"],
  ["in Kraft treten", "VERB", ["trat in Kraft"]],
  ["sein", "VERB", ["ist"]],
  ["an", "ADP"],
  ["an sein", "VERB", ["ist an"]],
  ["haben", "VERB", ["hat"]],
  ["Schwein", "NOUN"],
  ["Schwein haben", "VERB"],
  ["Gemüse", "NOUN"],
  ["Fonds", "NOUN"],
  ["Dort", "NOUN"],
  ["Mund", "NOUN"],
  ["Dortmund", "PROPN"],
  ["sondern", "VERB", ["sonder"]],
  ["sonder-", "X"],
  ["Ausstellung", "NOUN", ["ausstellungen"]],
]);

const polish = dictionary([
  ["mieć", "VERB", ["miało", "ma"]],
  ["miejsce", "NOUN"],
  ["mieć miejsce", "VERB"],
  ["nic", "PRON", ["niczego"]],
  ["to", "PRON"],
  ["to nic", "INTJ"],
  ["po prostu", "PART"],
  ["prosty", "ADJ", ["prostu"]],
  ["być", "VERB", ["jest"]],
  ["w", "ADP"],
  ["dupa", "NOUN", ["dupie"]],
  ["być w dupie", "VERB"],
  [
    "w tym",
    "ADP",
    [],
    ["Used other than figuratively or idiomatically: see w, ten.", "including"],
  ],
  ["ten", "DET", ["tym"]],
  ["móc", "VERB", ["może"]],
  ["może być", "INTJ"],
  ["gorzki", "ADJ"],
]);

const lemmas = (
  db: DictionaryDb,
  pair: string,
  word: string,
  context?: string,
) => lookupWord(db, pair, word, context).entries.map((entry) => entry.lemma);

describe("tokenize", () => {
  it("normalizes words and splits clauses at punctuation", () => {
    const tokens = tokenize("Er ruft an, weil es eilt.", "de");
    assert.deepStrictEqual(
      tokens.map((token) => [token.key, token.clause]),
      [
        ["er", 0],
        ["ruft", 0],
        ["an", 0],
        ["weil", 1],
        ["es", 1],
        ["eilt", 1],
      ],
    );
  });
});

describe("lookup with context", () => {
  it("leaves the lookup as it is without context", () => {
    assert.deepStrictEqual(lemmas(german, "de_en", "fand"), ["finden"]);
  });

  it("puts a phrase the word is part of first", () => {
    const context = "Vor allem die Kinder.";
    assert.deepStrictEqual(lemmas(german, "de_en", "Vor", context), [
      "vor allem",
      "vor",
    ]);
    assert.deepStrictEqual(lemmas(german, "de_en", "allem", context), [
      "vor allem",
      "allem",
    ]);
  });

  it("finds a separable verb from either half", () => {
    const context = "Die Sitzung fand gestern in Berlin statt.";
    assert.deepStrictEqual(lemmas(german, "de_en", "fand", context), [
      "stattfinden",
      "finden",
    ]);
    assert.deepStrictEqual(lemmas(german, "de_en", "statt", context), [
      "stattfinden",
      "statt",
    ]);
  });

  it("only takes a particle at the end of its clause", () => {
    assert.deepStrictEqual(
      lemmas(german, "de_en", "geht", "Er geht mit ihr ins Kino."),
      ["gehen"],
    );
    assert.deepStrictEqual(
      lemmas(german, "de_en", "fand", "Er fand statt Geld nur Steine."),
      ["finden"],
    );
  });

  it("finds a verb phrase whose verb comes first", () => {
    const context = "Das Gesetz tritt morgen in Kraft.";
    assert.deepStrictEqual(lemmas(german, "de_en", "tritt", context), [
      "in Kraft treten",
      "treten",
    ]);
    assert.deepStrictEqual(lemmas(german, "de_en", "Kraft", context), [
      "in Kraft treten",
      "Kraft",
    ]);
  });

  it("keeps a German verb phrase together at the end of its clause", () => {
    assert.deepStrictEqual(
      lemmas(german, "de_en", "ist", "Er ist an der Uni."),
      ["sein"],
    );
    assert.deepStrictEqual(
      lemmas(german, "de_en", "ist", "Das Licht ist an."),
      ["an sein", "sein"],
    );
    assert.deepStrictEqual(
      lemmas(
        german,
        "de_en",
        "haben",
        "Es ist ein Schwein und möchte einen hellen Fonds haben.",
      ),
      ["haben"],
    );
  });

  it("inflects only the verb of a phrase", () => {
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "miało", "To miało miejsce wczoraj."),
      ["mieć miejsce", "mieć"],
    );
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "niczego", "To niczego nie brakuje."),
      ["nic"],
    );
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "prostu", "To jest po prostu sensacja."),
      ["po prostu", "prosty"],
    );
  });

  it("allows one word between a verb and the rest of its phrase outside German", () => {
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "miało", "Niż miało to miejsce."),
      ["mieć miejsce", "mieć"],
    );
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "w", "Że jest to się w dupie poprzewracało."),
      ["w"],
    );
  });

  it("takes an interjection only as a clause of its own", () => {
    assert.deepStrictEqual(lemmas(polish, "pl_en", "być", "No, może być."), [
      "może być",
      "być",
    ]);
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "być", "On nie może być gorzki."),
      ["być"],
    );
  });

  it("leaves out a phrase's pointer to its literal reading", () => {
    const [phrase] = lookupWord(
      polish,
      "pl_en",
      "tym",
      "Jesteś w tym fachowiec.",
    ).entries;
    assert.deepStrictEqual(phrase, {
      lemma: "w tym",
      pos: "ADP",
      senses: [{ translations: ["including"] }],
    });
  });

  it("ignores a word that isn't in the context", () => {
    assert.deepStrictEqual(lemmas(german, "de_en", "fand", "Es regnet."), [
      "finden",
    ]);
  });
});

describe("segments", () => {
  it("splits a compound into parts as written", () => {
    assert.deepStrictEqual(lookupWord(german, "de_en", "Gemüsefonds"), {
      entries: [
        {
          lemma: "Gemüse",
          pos: "NOUN",
          senses: [{ translations: ["[Gemüse]"] }],
        },
        {
          lemma: "Fonds",
          pos: "NOUN",
          senses: [{ translations: ["[Fonds]"] }],
        },
      ],
      segments: [
        { text: "Gemüse", entries: [0] },
        { text: "fonds", entries: [1] },
      ],
    });
  });

  it("reads a modifier as a noun with a linker before a verb", () => {
    const db = dictionary([
      ["spitzen", "VERB"],
      ["Spitze", "NOUN", ["spitzen"]],
      ["Gastronomie", "NOUN"],
    ]);
    assert.deepStrictEqual(
      lookupWord(db, "de_en", "Spitzengastronomie").segments,
      [
        { text: "Spitze", entries: [0] },
        { text: "n" },
        { text: "gastronomie", entries: [1] },
      ],
    );
    assert.deepStrictEqual(lemmas(db, "de_en", "Spitzengastronomie"), [
      "Spitze",
      "Gastronomie",
    ]);
  });

  it("explains a modifier by its prefix entry when it has one", () => {
    assert.deepStrictEqual(lemmas(german, "de_en", "Sonderausstellungen"), [
      "sonder-",
      "Ausstellung",
    ]);
  });

  it("reads a name's genitive as the name, not a compound", () => {
    assert.deepStrictEqual(lemmas(german, "de_en", "Dortmunds"), ["Dortmund"]);
    assert.strictEqual(
      lookupWord(german, "de_en", "Dortmunds").segments,
      undefined,
    );
  });

  it("re-indexes segments behind entries the context adds", () => {
    const db = dictionary([
      ["Gemüse", "NOUN"],
      ["Fonds", "NOUN"],
      ["Gemüsefonds kochen", "VERB"],
      ["kochen", "VERB"],
    ]);
    const result = lookupWord(
      db,
      "de_en",
      "Gemüsefonds",
      "Wir Gemüsefonds kochen.",
    );
    assert.deepStrictEqual(
      result.entries.map((entry) => entry.lemma),
      ["Gemüsefonds kochen", "Gemüse", "Fonds"],
    );
    assert.deepStrictEqual(result.segments, [
      { text: "Gemüse", entries: [1] },
      { text: "fonds", entries: [2] },
    ]);
  });

  it("slices the word as sent, or gives up when normalizing changed it", () => {
    assert.deepStrictEqual(
      surfaceSlices("Schifffahrtsgeschichte", [
        "schifffahrt",
        "s",
        "geschichte",
      ]),
      ["Schifffahrt", "s", "geschichte"],
    );
    assert.strictEqual(
      surfaceSlices("Gemüsefonds", ["gemüse", "fonds"]),
      undefined,
    );
    assert.strictEqual(
      surfaceSlices(" Gemüsefonds", ["gemüse", "fonds"]),
      undefined,
    );
  });
});
