import { FormSource, GRAMMAR_SOURCE_POS } from "@dict/core/schema";
import { GRAMMAR_POS } from "../../grammar.ts";
import type { WriterContext } from "./context.ts";
import { MAX_CHAIN_STEPS } from "./context.ts";

/**
 * `e` is a grammar-file line of a content word (`pris VERB`, the past
 * participle's line), not of a grammar word or an ending (`X`).
 */
const contentGrammarLine = `(e.source_pos = '${GRAMMAR_SOURCE_POS}' AND e.pos NOT IN (${[...GRAMMAR_POS, "X"].map((p) => `'${p}'`).join(", ")}))`;

/**
 * `tańsi -> tańszy` and `tańszy -> tani` also give `tańsi -> tani`. A chain
 * stops at a word with an entry. With `verbChainsThroughEntries`, a verb's
 * goes on through a word with no verb entry, by that word's verb links (off
 * elsewhere, as the verb then ranks with the adjective a participle also is:
 * German `naheliegende`, Russian `удаленный`). The verb form `partie` is
 * "feminine singular of parti", whose own entries are an adjective and a
 * noun, and whose verb line says "past participle of partir", so `partie`
 * also reaches `partir`. (`resolveFormOf` still gives it those entries of
 * `parti`, for want of a verb.) Only verbs, whose participles decline: the
 * noun `Spielens` is the genitive of `Spielen` "playing", which is spelled
 * like a dative plural of `Spiel` and has only the verb's entry. A word the
 * grammar file lists is an entry of every part of speech (`нее` is `неё`,
 * not also `она`, `он` and `они`, which `неё` is a form of), unless its line
 * is a content word's: `prise` "feminine of pris" goes on to `prendre`
 * through the line for `pris`, the past participle.
 */
export const followLinkChains = ({
  sqlite,
  verbChainsThroughEntries,
}: WriterContext) => {
  const entryOf = (pos: string) =>
    `SELECT 1 FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = p.lemma AND f.source = ${FormSource.Lemma}${pos}`;
  const goesOn = verbChainsThroughEntries
    ? `NOT EXISTS (${entryOf(` AND (e.source_pos = p.source_pos OR (e.source_pos = '${GRAMMAR_SOURCE_POS}' AND NOT ${contentGrammarLine}))`)})
         AND (
           (p.source_pos = 'verb' AND q.source_pos = 'verb')
           OR NOT EXISTS (${entryOf("")})
         )`
    : `NOT EXISTS (${entryOf("")})`;
  for (let step = 1; step < MAX_CHAIN_STEPS; step++) {
    const added = sqlite.run(
      `INSERT OR IGNORE INTO form_of_pending (form, lemma, source_pos, pointer, marked)
       SELECT p.form, q.lemma, p.source_pos, max(p.pointer, q.pointer), max(p.marked, q.marked)
       FROM form_of_pending p
       JOIN form_of_pending q ON q.form = p.lemma
       WHERE q.lemma <> p.form AND ${goesOn}`,
    ).changes;
    if (added === 0) break;
  }
};

/** Words with a link, directly or through a chain, to no entry in this file. */
export const countUnresolvedLinks = ({ sqlite }: WriterContext): number =>
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

/**
 * Turn staged links into `forms` rows; returns how many were added. A link
 * resolves to the entries whose lemma matches and whose source pos is the
 * link's pos; if the lemma has no entry with that pos, to all its entries.
 * Rows already present (the usual case: the form is in the lemma's table)
 * are ignored by the primary key, so `changes` is exactly the number of rows
 * the fallback added. Pointer links only take the same pos, and skip a form
 * that already reaches the lemma, so `prostu` doesn't add `prosty` the noun
 * next to the adjective. Marked links (obsolete or dialect spellings)
 * resolve last, and only for forms that reached no entry any other way.
 */
export const resolveFormOf = ({
  sqlite,
  insertForm,
  hasEntry,
  verbalNouns,
}: WriterContext): number => {
  sqlite.transaction(() => {
    for (const { form, entryId } of verbalNouns) {
      if (!hasEntry(form)) insertForm.run(form, entryId, FormSource.FormOf);
    }
  })();
  const resolveLinks = (where: string) =>
    sqlite.run(
      `INSERT OR IGNORE INTO forms (form, entry_id, source)
       SELECT p.form, f.entry_id, ${FormSource.FormOf}
       FROM form_of_pending p
       JOIN forms f ON f.form = p.lemma AND f.source = ${FormSource.Lemma}
       JOIN entries e ON e.id = f.entry_id
       WHERE ${where} AND ((p.pointer = 0 AND (
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
         )))`,
    ).changes;
  let added = resolveLinks("p.marked = 0");
  // Decided before any marked row is added, so a word with two marked
  // spellings gets both targets.
  sqlite.run(`CREATE TEMP TABLE unreached AS
    SELECT DISTINCT form FROM form_of_pending p
    WHERE p.marked = 1 AND NOT EXISTS (SELECT 1 FROM forms f WHERE f.form = p.form)`);
  added += resolveLinks(
    "p.marked = 1 AND p.form IN (SELECT form FROM unreached)",
  );
  sqlite.run("DROP TABLE unreached");
  return added;
};
