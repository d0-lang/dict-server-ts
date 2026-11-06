import { FormSource } from "@dict/core/schema";
import type { WriterContext } from "./context.ts";

/**
 * `z.B.` -> `z. B.`, `ж.д.` -> `ж. д.`: texts often write an abbreviation
 * without the spaces after its periods, and then the segmenter keeps it as
 * one word. Lemma rows only, like `addAbbreviations`, so no table cell gets
 * one. Before `addAbbreviations`, so `ж.д` (the period dropped) reaches it
 * too.
 */
export const addUnspacedAbbreviations = ({ sqlite, counts }: WriterContext) => {
  counts.unspacedAbbreviations = sqlite.run(
    `INSERT OR IGNORE INTO forms (form, entry_id, source)
     SELECT replace(form, '. ', '.'), entry_id, ${FormSource.LetterVariant} FROM forms
     WHERE source = ${FormSource.Lemma} AND instr(form, '. ') > 0 AND form LIKE '%_.'`,
  ).changes;
};

/**
 * `bzw` -> `bzw.`: tokenizers drop the period that belongs to an
 * abbreviation. Only for spellings with no other row, decided before any is
 * added, so `c` reaches every lemma `c.` when it reaches nothing else.
 */
export const addAbbreviations = ({ sqlite, counts }: WriterContext) => {
  sqlite.run(`CREATE TEMP TABLE abbreviations AS
    SELECT substr(form, 1, length(form) - 1) AS bare, entry_id FROM forms
    WHERE source IN (${FormSource.Lemma}, ${FormSource.LetterVariant}) AND form LIKE '%_.'
      AND instr(form, ' ') = 0
      AND NOT EXISTS (
        SELECT 1 FROM forms other WHERE other.form = substr(forms.form, 1, length(forms.form) - 1)
      )`);
  counts.abbreviations = sqlite.run(
    `INSERT OR IGNORE INTO forms (form, entry_id, source)
     SELECT bare, entry_id, ${FormSource.Abbreviation} FROM abbreviations`,
  ).changes;
  sqlite.run("DROP TABLE abbreviations");
};

/**
 * `все` -> `всё`: texts often write an optional letter plainly. Runs last,
 * so every form, phrase and abbreviation row gets its variant; the primary
 * key keeps a form already spelled that way.
 */
export const addLetterVariants = ({
  sqlite,
  counts,
  optionalLetters,
}: WriterContext) => {
  for (const [letter, plain] of optionalLetters) {
    counts.letterVariants += sqlite.run(
      `INSERT OR IGNORE INTO forms (form, entry_id, source)
       SELECT replace(form, ?1, ?2), entry_id, ${FormSource.LetterVariant} FROM forms
       WHERE instr(form, ?1) > 0`,
      [letter, plain],
    ).changes;
  }
};
