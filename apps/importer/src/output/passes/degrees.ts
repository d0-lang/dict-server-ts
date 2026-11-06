import { lookupKey } from "@dict/core/lookupKey";
import { FormSource, GRAMMAR_SOURCE_POS } from "@dict/core/schema";
import { degreeBase, degreeOf, isDegreeGloss } from "../../transform/rules.ts";
import type { WriterContext } from "./context.ts";

/**
 * Entries that are only a comparative or superlative (`лучше` "comparative
 * degree of хороший", `neuer` "comparative degree of neu"):
 * - spelled like a plain form of their base (`neuer` is also `neu`'s strong
 *   masculine), they go back to being forms of the base: `ein neuer Film`
 *   is "new" far more often than "newer";
 * - otherwise, when the word has another entry with the same part of speech
 *   (`лучше` "rather", `короче` "in other words"), their senses go after
 *   that entry's, so a word's own meanings come first.
 * Their forms go with them. The emptied entries are dropped with the others
 * no form reaches.
 */
export const settleDegreeEntries = ({
  sqlite,
  counts,
  insertSense,
  degreeFormsByEntry,
}: WriterContext) => {
  const sensesOf = sqlite.query<
    { translations: string; see: string | null },
    [number]
  >("SELECT translations, see FROM senses WHERE entry_id = ? ORDER BY idx");
  const headOf = sqlite.query<{ lemma: string; pos: string }, [number]>(
    "SELECT lemma, pos FROM entries WHERE id = ?",
  );
  const lemmaEntries = sqlite.query<{ id: number; pos: string }, [string]>(
    `SELECT e.id, e.pos FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source = ${FormSource.Lemma} AND e.source_pos <> '${GRAMMAR_SOURCE_POS}' ORDER BY e.id`,
  );
  const hasInflection = sqlite.query<{ n: number }, [string, number]>(
    `SELECT count(*) AS n FROM forms WHERE form = ? AND entry_id = ? AND source = ${FormSource.Inflection}`,
  );
  const moveForms = sqlite.prepare(
    `UPDATE OR IGNORE forms SET entry_id = ?1, source = ${FormSource.Inflection} WHERE entry_id = ?2`,
  );
  const dropForms = sqlite.prepare("DELETE FROM forms WHERE entry_id = ?");
  const nextIdx = sqlite.query<{ n: number }, [number]>(
    "SELECT count(*) AS n FROM senses WHERE entry_id = ?",
  );
  const isDegreeOnly = (id: number) => {
    const senses = sensesOf.all(id);
    return (
      senses.length > 0 &&
      senses.every((row) =>
        isDegreeGloss((JSON.parse(row.translations) as Array<string>)[0]!),
      )
    );
  };

  const candidates = sqlite
    .query<{ id: number }, []>(
      `SELECT DISTINCT entry_id AS id FROM senses
       WHERE translations LIKE '%comparative%of%' OR translations LIKE '%superlative%of%' ORDER BY entry_id`,
    )
    .all()
    .map((row) => row.id);
  const deleteSenses = sqlite.prepare("DELETE FROM senses WHERE entry_id = ?");
  sqlite.transaction(() => {
    for (const id of candidates) {
      if (!isDegreeOnly(id)) {
        // A word with its own senses too (`дальше` "furthermore", `eher` "rather"): those first.
        const rows = sensesOf.all(id);
        const degree = (row: (typeof rows)[number]) =>
          isDegreeGloss((JSON.parse(row.translations) as Array<string>)[0]!);
        const ordered = [
          ...rows.filter((row) => !degree(row)),
          ...rows.filter(degree),
        ];
        if (ordered.some((row, i) => row !== rows[i])) {
          deleteSenses.run(id);
          ordered.forEach((row, idx) =>
            insertSense.run(id, idx, row.translations, row.see),
          );
        }
        continue;
      }
      const head = headOf.get(id)!;
      const key = lookupKey(head.lemma);
      const senses = sensesOf.all(id);
      const bases = [
        ...new Set(
          senses.flatMap((row) => {
            const base = degreeBase(
              (JSON.parse(row.translations) as Array<string>)[0]!,
            );
            return base === undefined ? [] : [lookupKey(base)];
          }),
        ),
      ];
      const plainFormOf = bases
        .flatMap((base) => lemmaEntries.all(base))
        .find(
          (base) =>
            hasInflection.get(key, base.id)!.n > 0 &&
            !(degreeFormsByEntry.get(base.id)?.has(key) ?? false),
        );
      if (plainFormOf !== undefined) {
        moveForms.run(plainFormOf.id, id);
        dropForms.run(id);
        counts.degreeDropped++;
        continue;
      }
      const other = lemmaEntries
        .all(key)
        .find(
          (entry) =>
            entry.id !== id &&
            entry.pos === head.pos &&
            !isDegreeOnly(entry.id),
        );
      if (other === undefined) continue;
      let idx = nextIdx.get(other.id)!.n;
      for (const row of senses) {
        insertSense.run(other.id, idx++, row.translations, row.see);
        counts.senses++;
      }
      moveForms.run(other.id, id);
      dropForms.run(id);
      counts.degreeMerged++;
    }
  })();
};

/**
 * Declined comparatives and superlatives are forms in their base's table
 * only, so the reader of `größte` saw "big", never "biggest". When the form
 * isn't its base plus an ending (`größte` for `groß`, `beste` for `gut`,
 * `jüngeren` for `jung`) and the base has an entry for that degree (`größten`
 * "superlative degree of groß", `besten`, `jünger`), the form also reaches
 * that entry, after the base (`FormSource.Degree`). A regular one
 * (`schnellere`, `wichtigsten`) stays the base's alone. Only forms the table
 * tags with one degree count. Runs after the form-of links, which add forms
 * to their base too, and after `settleDegreeEntries`, so entries it gave back
 * to their base are not targets.
 */
export const addDegreeForms = ({
  sqlite,
  counts,
  degreeFormsByEntry,
}: WriterContext) => {
  const rows = sqlite
    .query<{ id: number; pos: string; translations: string }, []>(
      `SELECT s.entry_id AS id, e.pos, s.translations FROM senses s JOIN entries e ON e.id = s.entry_id
       WHERE (s.translations LIKE '%comparative%of%' OR s.translations LIKE '%superlative%of%')
         AND e.source_pos <> '${GRAMMAR_SOURCE_POS}'
         AND EXISTS (SELECT 1 FROM forms f WHERE f.entry_id = e.id)
       ORDER BY e.pos <> 'ADJ', e.id, s.idx`,
    )
    .all();
  // degree + base -> the first entry with such a sense, adjectives first
  const targets = new Map<string, number>();
  for (const row of rows) {
    const gloss = (JSON.parse(row.translations) as Array<string>)[0]!;
    const base = degreeBase(gloss);
    const degree = degreeOf(gloss);
    if (base === undefined || degree === undefined) continue;
    const key = `${degree}\u0000${lookupKey(base)}`;
    if (!targets.has(key)) targets.set(key, row.id);
  }
  const lemmaOf = sqlite.query<{ lemma: string }, [number]>(
    "SELECT lemma FROM entries WHERE id = ?",
  );
  const has = sqlite.query<{ n: number }, [string, number]>(
    "SELECT count(*) AS n FROM forms WHERE form = ? AND entry_id = ?",
  );
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO forms VALUES (?, ?, ${FormSource.Degree})`,
  );
  sqlite.transaction(() => {
    for (const [baseId, forms] of degreeFormsByEntry) {
      const lemma = lemmaOf.get(baseId)?.lemma;
      if (lemma === undefined) continue;
      const base = lookupKey(lemma);
      for (const [form, degree] of forms) {
        if (degree === undefined || form.startsWith(base)) continue;
        const target = targets.get(`${degree}\u0000${base}`);
        if (target === undefined || target === baseId) continue;
        if (has.get(form, target)!.n > 0 || has.get(form, baseId)!.n === 0) {
          continue;
        }
        insert.run(form, target);
        counts.degreeForms++;
      }
    }
  })();
};
