import type { DictionaryDb } from "../dictionary/DictionaryDb.ts";
import { FormSource, formKey } from "../dictionary/schema.ts";
import type { FormOfLink, ImportEntry } from "./transform.ts";

export type WriterCounts = {
  entries: number;
  /** wiktextract lines merged into an earlier entry with the same word + etymology + pos */
  mergedLines: number;
  senses: number;
  pronunciations: number;
  /** distinct form-of / alt-of links staged for the fallback */
  formOfLinks: number;
};

export type FormOfResult = {
  /** fallback rows actually added to `forms` (not already covered by an inflection table) */
  readonly added: number;
  /** links whose target lemma has no entry in this file */
  readonly unresolved: number;
};

type EntryState = {
  readonly id: number;
  readonly glosses: Set<string>;
  readonly prons: Set<string>;
};

/**
 * Batched writer over prepared statements on the raw bun:sqlite client (the
 * hot path; Drizzle's query builder is used for reads). Call `writeBatch` once
 * per batch: each call is one transaction.
 *
 * Forms are deduplicated by the `forms` primary key with `INSERT OR IGNORE`,
 * not in memory. The only in-memory state is one small record per entry, to
 * merge wiktextract lines that share word + etymology + pos.
 */
export const makeWriter = (db: DictionaryDb) => {
  const sqlite = db.$client;
  sqlite.run(`CREATE TEMP TABLE form_of_pending (
    form       TEXT NOT NULL,
    lemma      TEXT NOT NULL,
    source_pos TEXT NOT NULL,
    PRIMARY KEY (form, lemma, source_pos)
  ) WITHOUT ROWID`);

  const insertEntry = sqlite.prepare(
    "INSERT INTO entries (id, lemma, pos, source_pos, etymology) VALUES (?, ?, ?, ?, ?)",
  );
  const insertSense = sqlite.prepare(
    "INSERT INTO senses (entry_id, idx, translations) VALUES (?, ?, ?)",
  );
  const insertPron = sqlite.prepare(
    "INSERT INTO pronunciations (entry_id, idx, kind, value) VALUES (?, ?, ?, ?)",
  );
  const insertForm = sqlite.prepare(
    "INSERT OR IGNORE INTO forms (form, entry_id, source) VALUES (?, ?, ?)",
  );
  const insertPending = sqlite.prepare(
    "INSERT OR IGNORE INTO form_of_pending (form, lemma, source_pos) VALUES (?, ?, ?)",
  );

  const counts: WriterCounts = {
    entries: 0,
    mergedLines: 0,
    senses: 0,
    pronunciations: 0,
    formOfLinks: 0,
  };
  const byKey = new Map<string, EntryState>();

  const writeEntry = (entry: ImportEntry) => {
    const key = `${entry.lemma}\u0000${entry.sourcePos}\u0000${entry.etymology}`;
    let state = byKey.get(key);
    if (state === undefined) {
      state = { id: ++counts.entries, glosses: new Set(), prons: new Set() };
      byKey.set(key, state);
      insertEntry.run(
        state.id,
        entry.lemma,
        entry.pos,
        entry.sourcePos,
        entry.etymology,
      );
      insertForm.run(formKey(entry.lemma), state.id, FormSource.Lemma);
    } else {
      counts.mergedLines++;
    }
    for (const translations of entry.senses) {
      const k = translations.join("\u0000");
      if (state.glosses.has(k)) continue;
      insertSense.run(
        state.id,
        state.glosses.size,
        JSON.stringify(translations),
      );
      state.glosses.add(k);
      counts.senses++;
    }
    for (const pron of entry.pronunciations) {
      const k = `${pron.kind}\u0000${pron.value}`;
      if (state.prons.has(k)) continue;
      insertPron.run(state.id, state.prons.size, pron.kind, pron.value);
      state.prons.add(k);
      counts.pronunciations++;
    }
    for (const form of entry.forms) {
      insertForm.run(form, state.id, FormSource.Inflection);
    }
  };

  const writeLinks = (links: ReadonlyArray<FormOfLink>) => {
    for (const link of links) {
      counts.formOfLinks += insertPending.run(
        link.form,
        link.lemma,
        link.sourcePos,
      ).changes;
    }
  };

  const writeBatch = sqlite.transaction(
    (
      items: ReadonlyArray<{
        readonly entry: ImportEntry | undefined;
        readonly formOf: ReadonlyArray<FormOfLink>;
      }>,
    ) => {
      for (const item of items) {
        if (item.entry !== undefined) writeEntry(item.entry);
        writeLinks(item.formOf);
      }
    },
  );

  /**
   * Turn staged form-of links into `forms` rows. A link resolves to the
   * entries whose lemma matches and whose source pos is the link's pos; if
   * the lemma has no entry with that pos, to all its entries. Rows already
   * present (the usual case: the form is in the lemma's table) are ignored by
   * the primary key, so `changes` is exactly the number of rows the fallback
   * added.
   */
  const resolveFormOf = (enabled: boolean): FormOfResult => {
    const unresolved =
      sqlite
        .query<{ n: number }, []>(
          `SELECT count(*) AS n FROM form_of_pending p
           WHERE NOT EXISTS (SELECT 1 FROM forms f WHERE f.form = p.lemma AND f.source = ${FormSource.Lemma})`,
        )
        .get()?.n ?? 0;
    let added = 0;
    if (enabled) {
      added = sqlite.run(
        `INSERT OR IGNORE INTO forms (form, entry_id, source)
         SELECT p.form, f.entry_id, ${FormSource.FormOf}
         FROM form_of_pending p
         JOIN forms f ON f.form = p.lemma AND f.source = ${FormSource.Lemma}
         JOIN entries e ON e.id = f.entry_id
         WHERE e.source_pos = p.source_pos
            OR NOT EXISTS (
              SELECT 1 FROM forms f2 JOIN entries e2 ON e2.id = f2.entry_id
              WHERE f2.form = p.lemma AND f2.source = ${FormSource.Lemma}
                AND e2.source_pos = p.source_pos
            )`,
      ).changes;
    }
    sqlite.run("DROP TABLE form_of_pending");
    return { added, unresolved };
  };

  return { counts, writeBatch, resolveFormOf };
};

export type Writer = ReturnType<typeof makeWriter>;
