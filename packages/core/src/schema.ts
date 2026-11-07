import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * One SQLite file per language pair (e.g. `data/pl_en.sqlite`), all with this
 * exact schema. The server opens one connection + Drizzle instance per file.
 *
 * Bump `SCHEMA_VERSION` whenever the DDL (`spec/dictionary/schema.sql`) or what
 * the rows mean changes; files are rebuilt by the importer, not migrated. It
 * is stored as `PRAGMA user_version`. The constants here are mirrored in
 * `spec/dictionary/format.json` (checked by `format.test.ts`).
 */
export const SCHEMA_VERSION = 5;

/** Universal Dependencies part-of-speech tags (https://universaldependencies.org/u/pos/). */
export const UD_POS = [
  "ADJ",
  "ADP",
  "ADV",
  "AUX",
  "CCONJ",
  "DET",
  "INTJ",
  "NOUN",
  "NUM",
  "PART",
  "PRON",
  "PROPN",
  "PUNCT",
  "SCONJ",
  "SYM",
  "VERB",
  "X",
] as const;
export type UdPos = (typeof UD_POS)[number];

export const PRON_KINDS = ["ipa", "audio", "reading"] as const;
export type PronKind = (typeof PRON_KINDS)[number];

/**
 * How a word is capitalised, for ranking: a lowercase word shows lowercase
 * lemmas first (`oder` "or" before the river `Oder`), and acronyms go last
 * unless the word is all caps. See `caseClass` in `lookupKey.ts`.
 */
export const CaseClass = {
  Lower: 0,
  Capitalised: 1,
  AllCaps: 2,
} as const;
export type CaseClass = (typeof CaseClass)[keyof typeof CaseClass];

/** Key/value info about the import (pair, source, date, counts). */
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * One row per word + etymology + part of speech, in source order (the `id`
 * order is the order lookups should return). wiktextract sometimes splits one
 * such entry over several lines; the importer merges them.
 */
export const entries = sqliteTable("entries", {
  id: integer("id").primaryKey(),
  lemma: text("lemma").notNull(),
  /** Universal Dependencies tag, `X` when unmapped. */
  pos: text("pos").$type<UdPos>().notNull(),
  /** Raw wiktextract `pos` (noun, name, verb, ...); also used to match form-of targets. */
  sourcePos: text("source_pos").notNull(),
  /** wiktextract `etymology_number`, 0 when the word has a single etymology. */
  etymology: integer("etymology").notNull(),
  /** `CaseClass` of the lemma, which lookups rank by. */
  caseClass: integer("case_class").$type<CaseClass>().notNull(),
  /**
   * Grammar for the headword as a UD feature string (`Gender=Masc`, see
   * `features.ts`), or null. Entries that differ in it are different words.
   */
  features: text("features"),
});

/**
 * Ordered senses; `translations` is a JSON array of strings (never empty) and
 * `see` a JSON array of words with an entry, or null.
 */
export const senses = sqliteTable(
  "senses",
  {
    entryId: integer("entry_id").notNull(),
    idx: integer("idx").notNull(),
    translations: text("translations", { mode: "json" })
      .$type<ReadonlyArray<string>>()
      .notNull(),
    see: text("see", { mode: "json" }).$type<ReadonlyArray<string>>(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.idx] })],
);

/**
 * Ordered, deduplicated pronunciation data. `ipa` and `audio` rows become the
 * protocol's `pron.ipa[]` / `pron.audio[]`; at most one `reading` per entry.
 */
export const pronunciations = sqliteTable(
  "pronunciations",
  {
    entryId: integer("entry_id").notNull(),
    idx: integer("idx").notNull(),
    kind: text("kind").$type<PronKind>().notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.idx] })],
);

/** `entries.source_pos` of entries from a language's grammar file. */
export const GRAMMAR_SOURCE_POS = "grammar";

/** Where a `forms` row came from. The first writer wins (INSERT OR IGNORE). */
export const FormSource = {
  /** the entry's own headword */
  Lemma: 0,
  /** listed in the lemma's `forms` array (inflection table, head forms) */
  Inflection: 1,
  /** fallback: a separate "X is a form of Y" entry pointing at the lemma */
  FormOf: 2,
  /**
   * an abbreviation without its period (`bzw` -> `bzw.`), which tokenizers
   * drop; only for spellings that reach nothing else
   */
  Abbreviation: 3,
  /**
   * a form spelled another common way, ranked after the forms really spelled
   * so: an optional letter written plainly (`все` for `всё`, see
   * `optionalLetters`), or an abbreviation without its spaces (`z.B.`)
   */
  LetterVariant: 4,
  /**
   * a declined comparative or superlative that isn't its base plus an ending
   * (`größte`, `beste`, `jüngeren`), on the entry for that degree; it stays a
   * form of the base too, which comes first
   */
  Degree: 5,
} as const;
export type FormSource = (typeof FormSource)[keyof typeof FormSource];

/**
 * Deinflection index: normalized surface form -> entry. The lemma itself is a
 * row too, so a lookup is a single primary-key prefix scan on `lookupKey(word)`.
 * The composite primary key makes duplicates impossible; writers use
 * `INSERT OR IGNORE` and let SQLite drop them.
 */
export const forms = sqliteTable(
  "forms",
  {
    form: text("form").notNull(),
    entryId: integer("entry_id").notNull(),
    source: integer("source").$type<FormSource>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.form, t.entryId] })],
);

/**
 * The DDL, kept by hand in `spec/dictionary/schema.sql` so that it is data any
 * implementation can read. `schema.test.ts` checks it matches the Drizzle
 * tables above. Read on demand: only the importer creates files.
 */
export const SCHEMA_SQL = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "spec",
  "dictionary",
  "schema.sql",
);
export const readDDL = (): string => readFileSync(SCHEMA_SQL, "utf8");

export const schema = { meta, entries, senses, pronunciations, forms };
