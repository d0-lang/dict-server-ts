/** In-memory dictionaries for the lookup tests, and the helpers they use. */
import {
  createDictionaryFile,
  type DictionaryDb,
} from "@dict/core/DictionaryDb";
import { type Language, readPairLanguage } from "@dict/core/language";
import { caseClass, lookupKey } from "@dict/core/lookupKey";
import { FormSource, type UdPos } from "@dict/core/schema";
import { lookupWord } from "../lookup.ts";

/** The pair's language record, read once, as the server does at startup. */
const languages = new Map<string, Language>();

export const languageOf = (pair: string): Language => {
  let language = languages.get(pair);
  if (language === undefined) {
    language = readPairLanguage(pair);
    languages.set(pair, language);
  }
  return language;
};

export type Word = readonly [
  lemma: string,
  pos: UdPos,
  forms?: ReadonlyArray<string>,
  senses?: ReadonlyArray<string>,
  sourcePos?: string,
  /** The headword's grammar as a UD feature string, such as `Gender=Masc`. */
  features?: string,
  /** Its reading (`pron.reading`), such as kana for Japanese. */
  reading?: string,
];

/** A dictionary; each sense is one gloss, by default the lemma in brackets. */
export const dictionary = (words: ReadonlyArray<Word>): DictionaryDb => {
  const db = createDictionaryFile(":memory:");
  words.forEach(
    (
      [
        lemma,
        pos,
        forms = [],
        glosses = [`[${lemma}]`],
        sourcePos = "",
        features,
        reading,
      ],
      i,
    ) => {
      const id = i + 1;
      db.$client.run("INSERT INTO entries VALUES (?, ?, ?, ?, 0, ?, ?)", [
        id,
        lemma,
        pos,
        sourcePos,
        caseClass(lemma),
        features ?? null,
      ]);
      if (reading !== undefined) {
        db.$client.run(
          "INSERT INTO pronunciations VALUES (?, 0, 'reading', ?)",
          [id, reading],
        );
      }
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

export const lemmas = (
  db: DictionaryDb,
  pair: string,
  word: string,
  context?: string,
  at?: number,
) =>
  lookupWord(db, languageOf(pair), word, context, at).entries.map(
    (entry) => entry.lemma,
  );
