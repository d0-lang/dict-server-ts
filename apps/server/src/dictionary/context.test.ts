import { assert, describe, it } from "@effect/vitest";
import { tokenize } from "./context.ts";
import { createDictionaryFile, type DictionaryDb } from "@dict/core/DictionaryDb";
import { lookupWord } from "./lookup.ts";
import { caseClass, lookupKey } from "@dict/core/lookupKey";
import { surfaceSlices } from "./queries.ts";
import { FormSource, type UdPos } from "@dict/core/schema";

type Word = readonly [
  lemma: string,
  pos: UdPos,
  forms?: ReadonlyArray<string>,
  senses?: ReadonlyArray<string>,
  sourcePos?: string,
];

/** A dictionary; each sense is one gloss, by default the lemma in brackets. */
const dictionary = (words: ReadonlyArray<Word>): DictionaryDb => {
  const db = createDictionaryFile(":memory:");
  words.forEach(
    ([lemma, pos, forms = [], glosses = [`[${lemma}]`], sourcePos = ""], i) => {
      const id = i + 1;
      db.$client.run("INSERT INTO entries VALUES (?, ?, ?, ?, 0, ?)", [
        id,
        lemma,
        pos,
        sourcePos,
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
    },
  );
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
  ["heißen", "VERB", ["heißt"]],
  ["wie", "ADV"],
  ["Sie", "PRON"],
  ["eigentlich", "ADV"],
  ["wie heißen Sie", "X", [], ["what is your name?"], "phrase"],
  ["z. B.", "ADV", ["z.B."], ["for example"]],
  ["Obst", "NOUN"],
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

const russian = dictionary([
  ["кто", "PRON", ["кого"]],
  ["кто-нибудь", "PRON", ["кого-нибудь"]],
  ["-нибудь", "X"],
  ["один", "NUM", ["одним"]],
  ["единственный", "ADJ", ["единственным"]],
  ["один-единственный", "ADJ"],
  ["поехать", "VERB", ["поехали"]],
  ["-ка", "PART"],
  ["ну-ка", "INTJ"],
  ["на-ка", "INTJ"],
  ["дай-ка", "INTJ"],
  ["ка", "NOUN"],
  ["-е", "X"],
  ["е", "INTJ"],
  ["кто-то", "PRON"],
  ["то", "PRON"],
  ["есть", "VERB"],
  ["то есть", "CCONJ"],
  ["после", "ADP"],
  ["того", "PRON"],
  ["как", "SCONJ"],
  ["после того как", "SCONJ"],
  ["так", "ADV"],
  ["так как", "SCONJ"],
  ["иметь", "VERB", ["имеет", "имел", "иметь"]],
  ["быть", "AUX", ["будет"]],
  ["брать", "VERB", ["брал"]],
  ["пример", "NOUN", ["примеры"]],
  ["брать пример", "VERB"],
  ["деньги", "NOUN", ["денег"]],
  ["значение", "NOUN", ["значения"]],
  ["иметь значение", "VERB", ["имеет значение"]],
  ["слово", "NOUN", ["слова"]],
  ["давать", "VERB", ["давал"]],
  ["давать слово", "VERB", ["давал слово"]],
  ["никто", "PRON", ["никому"]],
  ["дать", "VERB", ["дашь", "дал"]],
  ["дать слово", "VERB"],
  ["честный", "ADJ", ["честное"]],
  ["я", "PRON", ["мне"]],
  ["лес", "NOUN"],
  ["насаждение", "NOUN", ["насаждения"]],
  ["нефть", "NOUN"],
  ["газовый", "ADJ", ["газовая"]],
  ["кибер-", "X"],
  ["кабан", "NOUN", ["кабаны"]],
  ["при-", "X"],
  ["прийти", "VERB"],
  ["принести", "VERB"],
  ["приехать", "VERB"],
  ["приходить", "VERB"],
  ["приз", "NOUN"],
  ["стрелка", "NOUN"],
  ["стелить", "VERB", ["стелили"]],
  ["соломка", "NOUN", ["соломку"]],
  ["стелить соломку", "X", [], ["to play it safe"], "phrase"],
  ["щука", "NOUN"],
  ["знать", "VERB", ["знает", "знала"]],
  ["щука знает свою науку", "X", [], ["[proverb]"], "proverb"],
  ["свой", "DET", ["свою"]],
  ["наука", "NOUN", ["науку"]],
  ["мох", "NOUN"],
  ["вой", "NOUN"],
  ["ранг", "NOUN"],
  ["восток", "NOUN"],
  ["северо-восток", "NOUN"],
  ["го", "NOUN", [], ["go (board game)"]],
  ["-го", "X", [], ["-th (after a number)"], "grammar"],
  ["тур", "NOUN", ["тура"]],
  ["и", "CCONJ"],
  ["т", "NOUN", [], ["ton"]],
  ["д", "NOUN"],
  ["и т. д.", "X", ["и т.д."], ["etc."]],
  ["и т.д.", "X", ["и т. д."], ["etc."]],
  ["о", "INTJ"],
  ["ой", "INTJ", [], ["oh!"]],
  ["-ой", "X", [], ["-th (after a number)"], "grammar"],
  // `-ой` ends enough hyphenated forms to count as a hyphen affix
  ["ай-ой", "INTJ"],
  ["эй-ой", "INTJ"],
  ["ух-ой", "INTJ"],
]);

const lemmas = (
  db: DictionaryDb,
  pair: string,
  word: string,
  context?: string,
) => lookupWord(db, pair, word, context).entries.map((entry) => entry.lemma);

describe("tokenize", () => {
  it("splits a word at a period between letters, as browsers do", () => {
    const tokens = tokenize("груши и т.д. лежали", "ru");
    assert.deepStrictEqual(
      tokens.map((token) => [token.key, token.dottedBefore]),
      [
        ["груши", false],
        ["и", false],
        ["т", false],
        ["д", true],
        // a period and a space, as after any abbreviation: the lookup decides
        ["лежали", true],
      ],
    );
  });

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

  it("keeps a separable verb together across a word with periods inside", () => {
    assert.deepStrictEqual(lemmas(german, "de_en", "fand", "Er fand in comp.os.minix statt."), [
      "stattfinden",
      "finden",
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

  it("keeps a German untyped phrase out of the verb bracket", () => {
    // Its rest needn't end the clause, as a separable verb's must.
    assert.deepStrictEqual(
      lemmas(german, "de_en", "heißen", "Wie heißen Sie eigentlich?"),
      ["wie heißen Sie", "heißen"],
    );
  });

  it("inflects the verb of an untyped phrase, but not of a proverb", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "стелили", "Родители всегда стелили соломку."),
      ["стелить соломку", "стелить"],
    );
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "знала", "Щука знала свою науку."),
      ["знать"],
    );
  });

  it("allows two words between a verb and the rest in Russian", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "дашь", "Ты дашь мне честное слово?"),
      ["дать слово", "дать"],
    );
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "дашь", "Ты дашь мне очень честное слово?"),
      ["дать"],
    );
    // With the verb twice, the nearer one counts.
    assert.deepStrictEqual(
      lemmas(
        russian,
        "ru_en",
        "слово",
        "Он дал ему хлеб и дал мне честное слово.",
      ),
      ["дать слово", "слово"],
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

  it("joins the parts of a Russian hyphenated word, inflected or not", () => {
    const context = "Позови кого-нибудь, пусть поможет.";
    assert.deepStrictEqual(lemmas(russian, "ru_en", "кого", context), [
      "кто-нибудь",
      "кто",
    ]);
    assert.deepStrictEqual(lemmas(russian, "ru_en", "нибудь", context), [
      "кто-нибудь",
    ]);
    // No form for the inflected word: its parts as lemmas.
    assert.deepStrictEqual(
      lemmas(
        russian,
        "ru_en",
        "одним",
        "Это сделал одним-единственным ударом.",
      ),
      ["один-единственный", "один"],
    );
  });

  it("falls back to a hyphen affix only beside a word", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "ка", "Поехали-ка домой."),
      ["-ка", "ка"],
    );
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "е", "Это было в 1990-е годы."),
      ["е"],
    );
  });

  it("explains an ending after a number with the grammar file's line", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "го", "В матче 3-го тура выиграли гости."),
      ["-го", "го"],
    );
    // not without the number
    assert.deepStrictEqual(lemmas(russian, "ru_en", "го", "Они играли в го."), ["го"]);
    // nor as the hyphen affix of a word that isn't a number
    assert.deepStrictEqual(lemmas(russian, "ru_en", "ой", "О-ой, какие!"), ["ой"]);
  });

  it("joins the pieces of an abbreviation a browser splits at its periods", () => {
    for (const context of ["Яблоки, груши и т.д. лежали на столе.", "Яблоки, груши и т. д. лежали на столе."]) {
      assert.deepStrictEqual(lemmas(russian, "ru_en", "т", context), ["и т. д.", "т"]);
      assert.deepStrictEqual(lemmas(russian, "ru_en", "д", context), ["и т. д.", "д"]);
    }
    assert.deepStrictEqual(lemmas(german, "de_en", "z", "Obst, z.B. Äpfel."), ["z. B."]);
    // an initial before a name isn't an abbreviation the dictionary has
    assert.deepStrictEqual(lemmas(russian, "ru_en", "т", "Т.Голикова: добрый день!"), ["т"]);
  });

  it("leaves a word as it is when it also stands alone in the context", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "восток", "Ветер дул на северо-восток."),
      ["северо-восток", "восток"],
    );
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "восток", "Шли на восток и северо-восток."),
      ["восток"],
    );
  });

  it("lets a comma split a long conjunction before its last word", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "того", "Он ушёл после того, как стемнело."),
      ["после того как", "того"],
    );
    // In a two-word one, the comma makes two words: "the way that", not "because".
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "так", "Сделай так, как я сказал."),
      ["так"],
    );
  });

  it("takes a negated verb phrase with its object in another case", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "значения", "Это не имеет значения."),
      ["иметь значение", "значение"],
    );
    // The negation doesn't count as a word between the verb and the rest.
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "слова", "Я слова никому не давал."),
      ["давать слово", "слово"],
    );
    // A helper verb may stand between the negation and the verb.
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "значения", "Это не будет иметь значения."),
      ["иметь значение", "значение"],
    );
    // Only the verb the match uses counts as negated.
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "примеры", "Он не брал денег и брал примеры."),
      ["пример"],
    );
    // Without the negation, the object keeps the phrase's own form.
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "значения", "Он имел значения слов."),
      ["значение"],
    );
  });

  it("doesn't let a phrase take one part of a hyphenated word", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "есть", "Кто-то есть дома?"),
      ["есть"],
    );
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "есть", "Он устал, то есть хочет спать."),
      ["то есть", "есть"],
    );
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

  it("splits a Russian compound into stems and a linker", () => {
    const parts = (word: string) =>
      lookupWord(russian, "ru_en", word).segments?.map((s) => s.text);
    assert.deepStrictEqual(parts("лесонасаждения"), ["лес", "о", "насаждения"]);
    assert.deepStrictEqual(parts("нефтегазовая"), ["нефт", "е", "газовая"]);
    assert.deepStrictEqual(parts("киберкабаны"), ["кибер", "кабаны"]);
    assert.deepStrictEqual(lemmas(russian, "ru_en", "нефтегазовая"), [
      "нефть",
      "газовый",
    ]);
  });

  it("doesn't split a Russian name or a word with a three-letter head", () => {
    assert.deepStrictEqual(lemmas(russian, "ru_en", "Лесонасаждения"), []);
    // `-овой` is an adjective ending, not `о` + `вой` "howl".
    assert.deepStrictEqual(lemmas(russian, "ru_en", "ранговой"), []);
  });

  it("splits off a combining form but not a word-forming prefix", () => {
    // `кибер-` begins no verbs; `при-` begins mostly verbs, so `пристрелка`
    // isn't `при-` + `стрелка`.
    assert.deepStrictEqual(lemmas(russian, "ru_en", "киберкабаны"), [
      "кибер-",
      "кабан",
    ]);
    assert.deepStrictEqual(lemmas(russian, "ru_en", "пристрелка"), []);
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
