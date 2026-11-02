import type { DictionaryDb } from "../../dictionary/DictionaryDb.ts";
import { lookupKey } from "../../dictionary/lookupKey.ts";
import { FormSource } from "../../dictionary/schema.ts";
import { isPointerGloss } from "../transform/rules.ts";
import type {
  DerivedSense,
  FormOfLink,
  ImportEntry,
} from "../transform/transform.ts";

/** How many steps to follow from a word to the word that has an entry or meaning. */
const MAX_CHAIN_STEPS = 3;

export type WriterCounts = {
  entries: number;
  /** wiktextract lines merged into an earlier entry with the same word + etymology + pos */
  mergedLines: number;
  senses: number;
  pronunciations: number;
  /** distinct form-of / alt-of links staged for the fallback */
  formOfLinks: number;
  /** entries kept although all their senses belong to a historical stage */
  historicalEntries: number;
  /** derived senses that got the meaning of their base */
  derivedCopied: number;
  /** derived senses left as a bare gloss, because no meaning was found */
  derivedBare: number;
  /** `see` targets that have an entry */
  seeLinks: number;
};

export type FormOfResult = {
  /** fallback rows actually added to `forms` (not already covered by an inflection table) */
  readonly added: number;
  /** words with a link, directly or through a chain, to no entry in this file */
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
    pointer    INTEGER NOT NULL,
    PRIMARY KEY (form, lemma, source_pos)
  ) WITHOUT ROWID`);

  const insertEntry = sqlite.prepare(
    "INSERT INTO entries (id, lemma, pos, source_pos, etymology) VALUES (?, ?, ?, ?, ?)",
  );
  const insertSense = sqlite.prepare(
    "INSERT INTO senses (entry_id, idx, translations, see) VALUES (?, ?, ?, ?)",
  );
  const insertPron = sqlite.prepare(
    "INSERT INTO pronunciations (entry_id, idx, kind, value) VALUES (?, ?, ?, ?)",
  );
  const insertForm = sqlite.prepare(
    "INSERT OR IGNORE INTO forms (form, entry_id, source) VALUES (?, ?, ?)",
  );
  const insertPending = sqlite.prepare(
    `INSERT INTO form_of_pending (form, lemma, source_pos, pointer) VALUES (?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET pointer = 0 WHERE pointer = 1 AND excluded.pointer = 0`,
  );

  const counts: WriterCounts = {
    entries: 0,
    mergedLines: 0,
    senses: 0,
    pronunciations: 0,
    formOfLinks: 0,
    historicalEntries: 0,
    derivedCopied: 0,
    derivedBare: 0,
    seeLinks: 0,
  };
  const byKey = new Map<string, EntryState>();
  const historicalEntries: Array<ImportEntry> = [];
  const verbalNouns: Array<{ form: string; entryId: number }> = [];
  /** entry id -> gloss -> its derived sense */
  const derivedByEntry = new Map<number, Map<string, DerivedSense>>();

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
      insertForm.run(lookupKey(entry.lemma), state.id, FormSource.Lemma);
    } else {
      counts.mergedLines++;
    }
    for (const { translations, see } of entry.senses) {
      const k = translations.join("\u0000");
      if (state.glosses.has(k)) continue;
      insertSense.run(
        state.id,
        state.glosses.size,
        JSON.stringify(translations),
        see.length > 0 ? JSON.stringify(see) : null,
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
    for (const form of entry.verbalNouns) {
      verbalNouns.push({ form, entryId: state.id });
    }
    if (entry.derived.length > 0) {
      const senses = derivedByEntry.get(state.id) ?? new Map();
      for (const sense of entry.derived) senses.set(sense.gloss, sense);
      derivedByEntry.set(state.id, senses);
    }
  };

  const writeLinks = (links: ReadonlyArray<FormOfLink>) => {
    for (const link of links) {
      counts.formOfLinks += insertPending.run(
        link.form,
        link.lemma,
        link.sourcePos,
        link.pointer ? 1 : 0,
      ).changes;
    }
  };

  const writeBatch = sqlite.transaction(
    (
      items: ReadonlyArray<{
        readonly entry: ImportEntry | undefined;
        readonly historicalEntry?: ImportEntry;
        readonly formOf: ReadonlyArray<FormOfLink>;
      }>,
    ) => {
      for (const item of items) {
        if (item.entry !== undefined) writeEntry(item.entry);
        if (item.historicalEntry !== undefined) {
          historicalEntries.push(item.historicalEntry);
        }
        writeLinks(item.formOf);
      }
    },
  );

  const hasEntry = (key: string): boolean =>
    sqlite
      .query<{ n: number }, [string, number]>(
        "SELECT count(*) AS n FROM forms WHERE form = ? AND source = ?",
      )
      .get(key, FormSource.Lemma)!.n > 0;

  /** Write the historical entries of words that ended up with no other entry. */
  const restoreHistoricalEntries = sqlite.transaction(() => {
    const missing = historicalEntries.filter(
      (entry) => !hasEntry(lookupKey(entry.lemma)),
    );
    for (const entry of missing) writeEntry(entry);
    counts.historicalEntries = missing.length;
  });

  /** `tańsi -> tańszy` and `tańszy -> tani` also give `tańsi -> tani`. */
  const followLinkChains = () => {
    for (let step = 1; step < MAX_CHAIN_STEPS; step++) {
      const added = sqlite.run(
        `INSERT OR IGNORE INTO form_of_pending (form, lemma, source_pos, pointer)
         SELECT p.form, q.lemma, p.source_pos, max(p.pointer, q.pointer)
         FROM form_of_pending p
         JOIN form_of_pending q ON q.form = p.lemma
         WHERE q.lemma <> p.form
           AND NOT EXISTS (
             SELECT 1 FROM forms f
             WHERE f.form = p.lemma AND f.source = ${FormSource.Lemma}
           )`,
      ).changes;
      if (added === 0) break;
    }
  };

  /**
   * Add the base's meaning to each derived sense: same part of speech first,
   * then any, following chains (`koteczek` -> `kotek` -> `kot`). Every result
   * is worked out from the glosses as they were written, before any is
   * replaced, so processing order can't change it.
   */
  const copyDerivedMeanings = () => {
    const entriesOf = sqlite.query<
      { id: number; source_pos: string },
      [string, number]
    >(
      `SELECT e.id, e.source_pos FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ? AND f.source = ? ORDER BY e.id`,
    );
    const sensesOf = (id: number) =>
      sqlite
        .query<{ translations: string; see: string | null }, [number]>(
          "SELECT translations, see FROM senses WHERE entry_id = ? ORDER BY idx",
        )
        .all(id)
        .map((row) => ({
          translations: JSON.parse(row.translations) as Array<string>,
          see: row.see,
        }));
    const linkTargets = sqlite.query<{ lemma: string }, [string]>(
      "SELECT lemma FROM form_of_pending WHERE form = ?",
    );

    const meaningsOf = (
      word: string,
      sourcePos: string,
      seen: ReadonlySet<string>,
    ): ReadonlyArray<string> => {
      if (seen.has(word) || seen.size >= MAX_CHAIN_STEPS) return [];
      const visited = new Set(seen).add(word);
      const follow = (bases: ReadonlyArray<string>) => {
        for (const base of bases) {
          const found = meaningsOf(base, sourcePos, visited);
          if (found.length > 0) return found;
        }
        return [];
      };

      const all = entriesOf.all(word, FormSource.Lemma);
      if (all.length === 0) {
        return follow(linkTargets.all(word).map((row) => row.lemma));
      }
      const samePos = all.filter((e) => e.source_pos === sourcePos);
      const otherPos = all.filter((e) => e.source_pos !== sourcePos);
      for (const group of [samePos, otherPos]) {
        const meanings = group.flatMap((entry) =>
          sensesOf(entry.id).flatMap(({ translations }) => {
            if (derivedByEntry.get(entry.id)?.has(translations[0]!)) return [];
            const meaning = translations
              .filter((gloss) => !isPointerGloss(gloss))
              .join("; ");
            return meaning === "" ? [] : [meaning];
          }),
        );
        if (meanings.length > 0) return [...new Set(meanings)];
        const viaChain = follow(
          group.flatMap((entry) =>
            [...(derivedByEntry.get(entry.id)?.values() ?? [])].flatMap(
              (sense) => sense.bases,
            ),
          ),
        );
        if (viaChain.length > 0) return viaChain;
      }
      return [];
    };

    const sourcePosOf = sqlite.query<{ source_pos: string }, [number]>(
      "SELECT source_pos FROM entries WHERE id = ?",
    );
    const rewrites = [...derivedByEntry].map(([entryId, derived]) => {
      const sourcePos = sourcePosOf.get(entryId)!.source_pos;
      const rows = sensesOf(entryId).flatMap((row) => {
        const gloss = row.translations[0]!;
        const sense = derived.get(gloss);
        if (sense === undefined) return [row];
        const meanings = sense.bases.flatMap((base) =>
          meaningsOf(base, sourcePos, new Set()),
        );
        if (meanings.length === 0) {
          counts.derivedBare++;
          return [row];
        }
        counts.derivedCopied++;
        const prefix = gloss.replace(/[\s.,;:]+$/, "");
        return meanings.map((meaning) => ({
          translations: [`${prefix}: ${meaning}`],
          see: null,
        }));
      });
      const seen = new Set<string>();
      return {
        entryId,
        rows: rows.filter(({ translations }) => {
          const key = translations.join("\u0000");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      };
    });

    const deleteSenses = sqlite.prepare(
      "DELETE FROM senses WHERE entry_id = ?",
    );
    sqlite.transaction(() => {
      for (const { entryId, rows } of rewrites) {
        counts.senses -= deleteSenses.run(entryId).changes;
        rows.forEach(({ translations, see }, idx) => {
          insertSense.run(entryId, idx, JSON.stringify(translations), see);
          counts.senses++;
        });
      }
    })();
  };

  /** Keep only `see` targets that have an entry, now that all entries exist. */
  const resolveSee = sqlite.transaction(() => {
    const update = sqlite.prepare(
      "UPDATE senses SET see = ? WHERE entry_id = ? AND idx = ?",
    );
    const rows = sqlite
      .query<{ entry_id: number; idx: number; see: string }, []>(
        "SELECT entry_id, idx, see FROM senses WHERE see IS NOT NULL",
      )
      .all();
    for (const row of rows) {
      const see = (JSON.parse(row.see) as Array<string>).filter((word) =>
        hasEntry(lookupKey(word)),
      );
      update.run(
        see.length > 0 ? JSON.stringify(see) : null,
        row.entry_id,
        row.idx,
      );
      counts.seeLinks += see.length;
    }
  });

  /**
   * Finish the words that depend on others, which may come later in the dump,
   * then turn staged links into `forms` rows. A link resolves to the entries
   * whose lemma matches and whose source pos is the link's pos; if the lemma
   * has no entry with that pos, to all its entries. Rows already present (the
   * usual case: the form is in the lemma's table) are ignored by the primary
   * key, so `changes` is exactly the number of rows the fallback added.
   * Pointer links only take the same pos, and skip a form that already reaches
   * the lemma, so `prostu` doesn't add `prosty` the noun next to the adjective.
   */
  const resolveFormOf = (enabled: boolean): FormOfResult => {
    restoreHistoricalEntries();
    followLinkChains();
    copyDerivedMeanings();
    resolveSee();
    const unresolved =
      sqlite
        .query<{ n: number }, []>(
          `SELECT count(DISTINCT p.form) AS n FROM form_of_pending p
           WHERE NOT EXISTS (
             SELECT 1 FROM form_of_pending p2
             JOIN forms f ON f.form = p2.lemma AND f.source = ${FormSource.Lemma}
             WHERE p2.form = p.form
           )`,
        )
        .get()?.n ?? 0;
    let added = 0;
    if (enabled) {
      sqlite.transaction(() => {
        for (const { form, entryId } of verbalNouns) {
          if (!hasEntry(form)) insertForm.run(form, entryId, FormSource.FormOf);
        }
      })();
      added = sqlite.run(
        `INSERT OR IGNORE INTO forms (form, entry_id, source)
         SELECT p.form, f.entry_id, ${FormSource.FormOf}
         FROM form_of_pending p
         JOIN forms f ON f.form = p.lemma AND f.source = ${FormSource.Lemma}
         JOIN entries e ON e.id = f.entry_id
         WHERE (p.pointer = 0 AND (
             e.source_pos = p.source_pos
             OR NOT EXISTS (
               SELECT 1 FROM forms f2 JOIN entries e2 ON e2.id = f2.entry_id
               WHERE f2.form = p.lemma AND f2.source = ${FormSource.Lemma}
                 AND e2.source_pos = p.source_pos
             )
           ))
           OR (p.pointer = 1 AND e.source_pos = p.source_pos AND NOT EXISTS (
             SELECT 1 FROM forms reached
             JOIN forms target ON target.entry_id = reached.entry_id
             WHERE reached.form = p.form
               AND target.form = p.lemma AND target.source = ${FormSource.Lemma}
           ))`,
      ).changes;
    }
    sqlite.run("DROP TABLE form_of_pending");
    return { added, unresolved };
  };

  return { counts, writeBatch, resolveFormOf };
};

export type Writer = ReturnType<typeof makeWriter>;
