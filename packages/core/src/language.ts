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
/** A key that may be left out, decoding to `value` when it is. */
const orDefault = <S extends Schema.Top>(schema: S, value: S["Encoded"]) =>
  Schema.withDecodingDefaultKey<S>(Effect.succeed(value))(schema);

/** `[letter, plain]`: running text may write `letter` as `plain` (`ё` as `е`). */
const LetterPair = Schema.Tuple([Schema.String, Schema.String]);

/** How the importer reads this language's wiktextract data. */
const Import = Schema.Struct({
  /**
   * Historical stages of the language. A sense, form or pronunciation is
   * dropped when its tags contain every tag of a stage. Each stage is a list
   * because wiktextract splits "Middle Polish" into the tags "Middle" and
   * "Polish".
   */
  historicalStages: orDefault(Schema.Array(strings), []),
  /**
   * `note` values on `sounds` that still mean the standard pronunciation
   * (other notes are regional variants, kept only when nothing else exists).
   */
  standardPronNotes: orDefault(strings, []),
  /** Form tags that mark a misparsed table in this language's data, so the row is dropped. */
  untrustedFormTags: orDefault(strings, []),
  /**
   * Show the lemma with its stress marks: the headword's `canonical` form,
   * when it spells the same word. Lookups still match unstressed text.
   */
  stressedLemmas: orDefault(Schema.Boolean, false),
});

/** Separable verbs: a particle that leaves its verb for the end of the clause. */
const Separable = Schema.Struct({
  /** Words that may follow a clause-final particle without punctuation. */
  conjunctions: orDefault(strings, []),
});

/** What the sentence around a word (`context`) adds to its lookup. */
const Context = Schema.Struct({
  /** The rest of a verb phrase goes to the end of the clause. */
  verbBracket: orDefault(Schema.Boolean, false),
  /**
   * Some words are hyphen-joined parts, which the segmenter splits; with
   * context the parts are joined back into one word.
   */
  hyphenWords: orDefault(Schema.Boolean, false),
  /** Reflexive pronouns a phrase's reflexive stands for. */
  reflexives: orDefault(strings, []),
  /**
   * The particle that negates a verb, where negation changes the case of
   * the verb's object (so the phrase's own forms no longer match).
   */
  negation: Schema.optionalKey(Schema.String),
  /** Words allowed between a verb and the rest of its phrase. */
  maxGap: orDefault(Schema.Int, 1),
  /** Present when the language has separable verbs. */
  separable: Schema.optionalKey(Separable),
});

/** Compound splitting, for words without an entry; absent means no splitting. */
const Compounds = Schema.Struct({
  /** Linking elements between a modifier and the next part, tried in order; `""` is a plain join. */
  linkers: strings,
  /** Endings a modifier drops before its linker, when modifiers are stems rather than words. */
  stemEndings: Schema.optionalKey(strings),
  /** With `stemEndings`: endings of adjective forms, which a verb form needs to be a head. */
  adjectiveEndings: Schema.optionalKey(strings),
});

export const Language = Schema.Struct({
  /** wiktextract `lang_code`, and the locale for word segmentation. */
  code: Schema.String,
  /** The language's English name, as in the `#Polish` anchors of wiktextract links. */
  name: Schema.String,
  /** Target (gloss) language; always English for the English Wiktionary dump. */
  target: Schema.String,
  optionalLetters: orDefault(Schema.Array(LetterPair), []),
  import: orDefault(Import, {}),
  context: orDefault(Context, {}),
  compounds: Schema.optionalKey(Compounds),
});
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
