import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";

/**
 * A language's settings, from `languages/<code>/language.toml`: what the
 * importer and the server do differently for it. Every key but `code`,
 * `name` and `target` may be left out; the default is what a language that
 * doesn't need the setting gets. `spec/language.schema.json` is generated
 * from this schema (`bun run spec`).
 */

const strings = Schema.Array(Schema.String);
const doc = <S extends Schema.Top>(schema: S, description: string): S =>
  schema.annotate({ description }) as S;
/** A key that may be left out, decoding to `value` when it is. */
const orDefault = <S extends Schema.Top>(schema: S, value: S["Encoded"]) =>
  Schema.withDecodingDefaultKey<S>(Effect.succeed(value))(schema);

const LetterPair = doc(
  Schema.Tuple([Schema.String, Schema.String]),
  "[letter, plain]: running text may write `letter` as `plain` (`ё` as `е`).",
);

const Import = doc(
  Schema.Struct({
    historicalStages: orDefault(
      doc(
        Schema.Array(strings),
        'Historical stages of the language. A sense, form or pronunciation is dropped when its tags contain every tag of a stage. Each stage is a list because wiktextract splits "Middle Polish" into the tags "Middle" and "Polish".',
      ),
      [],
    ),
    standardPronNotes: orDefault(
      doc(
        strings,
        "`note` values on `sounds` that still mean the standard pronunciation; other notes are regional variants, kept only when nothing else exists.",
      ),
      [],
    ),
    untrustedFormTags: orDefault(
      doc(
        strings,
        "Form tags that mark a misparsed table in this language's data; such rows are dropped.",
      ),
      [],
    ),
    reflexive: Schema.optionalKey(
      doc(
        Schema.Literals(["before", "after"]),
        "Senses Wiktionary labels `reflexive with <particle>` become an entry of their own, with the particle before or after the lemma (`after`: Polish `bawić się`, `wyobrażać sobie`). Learners learn these as words of their own.",
      ),
    ),
    participleDeclension: Schema.optionalKey(
      doc(
        Schema.Struct({
          tags: orDefault(
            doc(
              strings,
              "The tags a table's participle row has, all of them (Polish: the masculine singular adjectival participle; German: any participle).",
            ),
            ["adjectival", "participle", "masculine", "singular"],
          ),
          ending: Schema.String,
          endings: strings,
          onlyNew: orDefault(
            doc(
              Schema.Boolean,
              'Add a declined form only where no other entry has it, so a participle Wiktionary lists as an adjective keeps its forms (German `bestehende` stays `bestehend`\'s). Off where those adjectives carry only figurative senses and the verb is needed (Polish `zniszczony` "beat-up" for `zniszczonych` "destroyed").',
            ),
            false,
          ),
        }),
        "Adjectival participles decline like adjectives, but verb tables list only one form (`wymagany`, `ausgelegt`). A participle row with all of `tags` that ends in `ending` also gets its stem with each of `endings` as forms of the verb (`wymaganego`, `wymaganej`; `ausgelegte`, `ausgelegten`).",
      ),
    ),
    ownEntryForms: orDefault(
      doc(
        strings,
        'Form glosses that describe a word a reader meets on its own, so the word keeps an entry with its base\'s meaning ("passive of використовувати: to use") instead of only linking to the base. Each item is a set of words, all of which must open the gloss before its "of": `passive` matches "passive of" and "adjectival past passive participle of", `active participle` matches "past active participle of". Ukrainian sets them because its participles are also adjectives (`поширений` "widespread"), which a link to the verb would rank behind it.',
      ),
      [],
    ),
    stressedLemmas: orDefault(
      doc(
        Schema.Boolean,
        "Show the lemma with its stress marks: the headword's `canonical` form, when it spells the same word. Lookups still match unstressed text.",
      ),
      false,
    ),
  }),
  "How the importer reads this language's wiktextract data.",
);

const Context = doc(
  Schema.Struct({
    verbBracket: orDefault(
      doc(
        Schema.Boolean,
        "The rest of a verb phrase goes to the end of the clause (German `tritt morgen in Kraft`).",
      ),
      false,
    ),
    hyphenWords: orDefault(
      doc(
        Schema.Boolean,
        "Some words are hyphen-joined parts (`что-нибудь`), which the segmenter splits; with context the parts are joined back into one word.",
      ),
      false,
    ),
    reflexives: orDefault(
      doc(strings, "Reflexive pronouns a phrase's `sich` stands for."),
      [],
    ),
    negation: Schema.optionalKey(
      doc(
        Schema.String,
        "The particle that negates a verb, where negation changes the case of the verb's object (`не имеет значения` for `иметь значение`).",
      ),
    ),
    maxGap: orDefault(
      doc(
        Schema.Int,
        "Words allowed between a verb and the rest of its phrase.",
      ),
      1,
    ),
    separableVerbs: orDefault(
      doc(
        Schema.Boolean,
        "Separable verbs: the finite verb with its particle at the end of the clause (`fand ... statt` -> `stattfinden`).",
      ),
      false,
    ),
    clauseConjunctions: orDefault(
      doc(
        strings,
        "Conjunctions that end a clause without punctuation, where the verb bracket and separable verbs look for the clause's end.",
      ),
      [],
    ),
    reflexiveParticles: orDefault(
      doc(
        strings,
        "Words that make a verb reflexive (`się` in `bawić się`). In a verb phrase they may stand on either side of the verb, apart from it, though they are no content word (`Dobrze się bawię`).",
      ),
      [],
    ),
    capitalNouns: orDefault(
      doc(
        Schema.Boolean,
        "Nouns are written with a capital letter (German), so a capitalised word of two or more letters inside a sentence ranks entries with a capitalised lemma first (`In wenigen Tagen`: `der Tag` before `tagen`).",
      ),
      false,
    ),
    nominalizers: orDefault(
      doc(
        strings,
        "With `capitalNouns`: words after which a capitalised infinitive is likely the verb used as a noun (`zum Binden`, `das Tragen`), so the verb keeps its place among the capitalised lemmas.",
      ),
      [],
    ),
    abbreviationLeads: orDefault(
      doc(
        strings,
        "Words that may stand before an abbreviation as part of it (`и` in `и т. д.`).",
      ),
      [],
    ),
    analyzer: Schema.optionalKey(
      doc(
        Schema.Struct({
          dictionary: doc(
            Schema.Literals(["unidic", "ipadic", "ko-dic", "cc-cedict"]),
            "The morphological analyzer's dictionary (Lindera): `unidic` or `ipadic` for Japanese, `ko-dic` for Korean, `cc-cedict` for Chinese.",
          ),
          baseFields: doc(
            Schema.Array(Schema.Int),
            "Which of the dictionary's detail fields hold a morpheme's base forms, looked up in this order (UniDic: 10, the written base form `いる`; 7, the lemma `要る`).",
          ),
          join: orDefault(
            doc(
              Schema.Array(
                Schema.Struct({
                  pos: doc(
                    strings,
                    "Parts of speech of the morpheme, as the dictionary tags them, each a prefix of its tags joined with `-` (`助動詞`, `動詞-非自立可能`).",
                  ),
                  surface: Schema.optionalKey(
                    doc(strings, "Only these spellings of it (`て`, `で`)."),
                  ),
                  base: Schema.optionalKey(
                    doc(strings, "Only these base forms of it (`する`)."),
                  ),
                  after: Schema.optionalKey(
                    doc(
                      strings,
                      "Parts of speech of the morpheme before it, as in `pos`; left out, any morpheme with letters.",
                    ),
                  ),
                  afterSurface: Schema.optionalKey(
                    doc(strings, "Only after these spellings (`て`)."),
                  ),
                }),
              ),
              "Rules that join a morpheme to the word before it: a word is a morpheme and what the rules join to it (`食べ` + `まし` + `た`).",
            ),
            [],
          ),
          prefixes: orDefault(
            doc(
              strings,
              "Parts of speech of morphemes that join the word after them (`接頭辞`: `お` + `茶`).",
            ),
            [],
          ),
          upos: orDefault(
            doc(
              Schema.Record(Schema.String, strings),
              "The dictionary's parts of speech (a prefix of its tags, as in `pos`) as Universal Dependencies tags (`名詞`: `NOUN`), to tell which entries fit the analyzer's reading of a word.",
            ),
            {},
          ),
        }),
        "A morphological analyzer finds the word around the clicked piece, for a script without spaces whose segmenter cuts words short (`食|べ|ま|した`). With context, the word is returned as `match` and its morphemes as `segments`, each looked up by its base form. Leave the table out for no analyzer.",
      ),
    ),
  }),
  "What the sentence around a word (`context`) adds to its lookup.",
);

const FeatureName = Schema.Literals(["Gender", "Animacy", "Aspect", "Number"]);

const Headword = doc(
  Schema.Struct({
    labels: orDefault(
      doc(
        Schema.Array(FeatureName),
        "Grammar features shown as labels next to the headword (`f`, `anim`, `pf`), in this order. Features an article already shows are left out.",
      ),
      ["Gender", "Animacy", "Aspect", "Number"],
    ),
    articles: Schema.optionalKey(
      doc(
        Schema.Struct({
          Masc: Schema.optionalKey(Schema.String),
          Fem: Schema.optionalKey(Schema.String),
          Neut: Schema.optionalKey(Schema.String),
          Com: Schema.optionalKey(Schema.String),
          Ptan: Schema.optionalKey(Schema.String),
        }),
        "The article a noun's lemma starts with, by gender (`Ptan`: plural-only nouns), for languages whose learners learn nouns with it (German `der Hund`). Several genders give `der/das Bonbon`. The gender is then not a label.",
      ),
    ),
  }),
  "How the headword shows its grammar.",
);

const Compounds = doc(
  Schema.Struct({
    linkers: doc(
      strings,
      'Linking elements between a modifier and the next part, tried in order; "" is a plain join.',
    ),
    stemEndings: Schema.optionalKey(
      doc(
        strings,
        "Endings a modifier drops before its linker, when modifiers are stems rather than words.",
      ),
    ),
    adjectiveEndings: Schema.optionalKey(
      doc(
        strings,
        "With `stemEndings`: endings of adjective forms, which a verb form needs to be a compound's head.",
      ),
    ),
  }),
  "Compound splitting, for words without an entry. Leave the table out for no splitting.",
);

export const Language = doc(
  Schema.Struct({
    code: doc(
      Schema.String,
      "wiktextract `lang_code`, and the locale for word segmentation.",
    ),
    name: doc(
      Schema.String,
      "The language's English name, as in the `#Polish` anchors of wiktextract links.",
    ),
    target: doc(
      Schema.String,
      "Target (gloss) language; always `en` for the English Wiktionary dump.",
    ),
    optionalLetters: orDefault(
      doc(
        Schema.Array(LetterPair),
        "Letters running text may write as another letter. Every form with `letter` is also indexed with `plain`, and compound stems may be written without it.",
      ),
      [],
    ),
    import: orDefault(Import, {}),
    context: orDefault(Context, {}),
    compounds: Schema.optionalKey(Compounds),
    headword: orDefault(Headword, {}),
  }),
  "A language record, languages/<code>/language.toml. Every key but code, name and target may be left out.",
);
export type Language = typeof Language.Type;

export class LanguageError extends Schema.TaggedError<LanguageError>()(
  "LanguageError",
  {
    file: Schema.String,
    message: Schema.String,
  },
) {}

/** The repo's `languages/` directory: one folder per language. */
export const LANGUAGES_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "languages",
);

export const languageFile = (code: string, dir = LANGUAGES_DIR): string =>
  join(dir, code, "language.toml");

/** Codes of the languages that have a `language.toml`, sorted. */
export const languageCodes = (dir = LANGUAGES_DIR): ReadonlyArray<string> =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((code) => existsSync(languageFile(code, dir)))
        .sort()
    : [];

const decode = Schema.decodeUnknownSync(Language);

/** Decode a language record; unknown keys are an error, so a typo can't pass unnoticed. */
export const decodeLanguage = (input: unknown): Language =>
  decode(input, { onExcessProperty: "error" });

/** Read `languages/<code>/language.toml`; throws a `LanguageError` when it is missing or invalid. */
export const readLanguage = (code: string, dir = LANGUAGES_DIR): Language => {
  const file = languageFile(code, dir);
  if (!existsSync(file)) {
    throw new LanguageError({
      file,
      message: `no language record for "${code}" (known: ${languageCodes(dir).join(", ")})`,
    });
  }
  try {
    const language = decodeLanguage(Bun.TOML.parse(readFileSync(file, "utf8")));
    if (language.code !== code) {
      throw new Error(`code is "${language.code}", expected "${code}"`);
    }
    return language;
  } catch (cause) {
    throw new LanguageError({
      file,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

/** `readLanguage` as an Effect. */
export const loadLanguage = (
  code: string,
  dir = LANGUAGES_DIR,
): Effect.Effect<Language, LanguageError> =>
  Effect.try({
    try: () => readLanguage(code, dir),
    catch: (cause) =>
      cause instanceof LanguageError
        ? cause
        : new LanguageError({
            file: languageFile(code, dir),
            message: String(cause),
          }),
  });

/**
 * The source language of a pair (`ru_en` -> `ru`): its record, or every
 * default when it has none, so a server can serve a pair before anyone
 * writes its record. Throws a `LanguageError` when the record is invalid.
 */
export const readPairLanguage = (
  pair: string,
  dir = LANGUAGES_DIR,
): Language => {
  const [code = pair, target = "en"] = pair.split("_");
  return existsSync(languageFile(code, dir))
    ? readLanguage(code, dir)
    : decodeLanguage({ code, name: code, target });
};

/** `readPairLanguage` as an Effect. */
export const pairLanguage = (
  pair: string,
  dir = LANGUAGES_DIR,
): Effect.Effect<Language, LanguageError> =>
  Effect.try({
    try: () => readPairLanguage(pair, dir),
    catch: (cause) =>
      cause instanceof LanguageError
        ? cause
        : new LanguageError({ file: pair, message: String(cause) }),
  });
