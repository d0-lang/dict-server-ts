import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * One SQLite file per language pair (`pl_en` is Polish lemmas, English glosses).
 *
 * Lookup (later HTTP API) is: fold the query, hit `forms.form_key`, and return
 * those entries with senses ordered by `position`. Inflected forms and the
 * citation form share that index. `INSERT OR IGNORE` on `(form, entry_id)`
 * drops duplicate surface forms.
 *
 * An entry is one word + etymology + UD part of speech, matching the protocol.
 */
export const entries = sqliteTable(
  "entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lemma: text("lemma").notNull(),
    lemmaKey: text("lemma_key").notNull(),
    pos: text("pos").notNull(),
    etymologyNumber: text("etymology_number").notNull().default(""),
    ipaJson: text("ipa_json"),
    audioJson: text("audio_json"),
    reading: text("reading"),
  },
  (table) => [
    index("entries_lemma_pos").on(table.lemma, table.pos),
    index("entries_lemma_key_pos").on(table.lemmaKey, table.pos),
  ],
);

export const senses = sqliteTable(
  "senses",
  {
    entryId: integer("entry_id")
      .notNull()
      .references(() => entries.id),
    position: integer("position").notNull(),
    translationsJson: text("translations_json").notNull(),
  },
  (table) => [primaryKey({ columns: [table.entryId, table.position] })],
);

export const forms = sqliteTable(
  "forms",
  {
    form: text("form").notNull(),
    formKey: text("form_key").notNull(),
    entryId: integer("entry_id")
      .notNull()
      .references(() => entries.id),
  },
  (table) => [
    primaryKey({ columns: [table.form, table.entryId] }),
    index("forms_form_key").on(table.formKey),
  ],
);

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const dictionarySchema = { entries, senses, forms, meta };

/**
 * Tables are created by hand so a bulk import does not need drizzle-kit.
 * Secondary indexes are created after the load (see DictionaryStore.finalize).
 * The forms primary key exists from the start so `INSERT OR IGNORE` can drop
 * duplicate `(form, entry_id)` pairs.
 */
export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lemma TEXT NOT NULL,
  lemma_key TEXT NOT NULL,
  pos TEXT NOT NULL,
  etymology_number TEXT NOT NULL DEFAULT '',
  ipa_json TEXT,
  audio_json TEXT,
  reading TEXT
);

CREATE TABLE IF NOT EXISTS senses (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  position INTEGER NOT NULL,
  translations_json TEXT NOT NULL,
  PRIMARY KEY (entry_id, position)
);

CREATE TABLE IF NOT EXISTS forms (
  form TEXT NOT NULL,
  form_key TEXT NOT NULL,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  PRIMARY KEY (form, entry_id)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TEMP TABLE IF NOT EXISTS fallbacks (
  form TEXT NOT NULL,
  form_key TEXT NOT NULL,
  lemma TEXT NOT NULL,
  lemma_key TEXT NOT NULL,
  pos TEXT NOT NULL
);
`;

export const CREATE_ENTRY_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS entries_lemma_pos ON entries(lemma, pos);
CREATE INDEX IF NOT EXISTS entries_lemma_key_pos ON entries(lemma_key, pos);
`;

export const CREATE_FORM_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS forms_form_key ON forms(form_key);
`;
