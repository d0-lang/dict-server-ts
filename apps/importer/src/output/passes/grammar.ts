import { FormSource, GRAMMAR_SOURCE_POS } from "@dict/core/schema";
import { GRAMMAR_POS } from "../../grammar.ts";
import type { WriterContext } from "./context.ts";

/**
 * A word in the grammar file shows none of Wiktionary's grammar-word entries,
 * nor its entries with a part of speech the file gives that word (`здесь ADV`
 * replaces Wiktionary's adverb `здесь`; `всё`, listed as a pronoun and a
 * determiner, keeps its adverb "still"). `X` lines (endings like `-го`) only add.
 * A contraction of grammar words is one too (`n'` "Prevocalic form of ne.",
 * which Wiktionary files under neither a pronoun nor a particle).
 * Nor does it keep Wiktionary's form-of links to another word the file lists:
 * `des` is "plural of un" and "de + les" there, and the file's own lines for
 * `des` say both, so it shows them and not the lines for `un` and `de`. Of
 * the other word's own entries it keeps only those of the link's part of
 * speech: the article `l'` is "apocopic form of le, la", and `la` has no
 * article entry, so the link's fallback gave it `la` the note. A link that
 * spells the other word with its optional letters written plainly stays
 * (Russian `все` is also `всё` without its ё). Reads `form_of_pending`.
 */
export const replaceGrammarWords = ({
  sqlite,
  counts,
  optionalLetters,
}: WriterContext) => {
  // The other word's lemma with its optional letters written plainly.
  const plainLemma = optionalLetters.reduce(
    (sql, [letter, plain]) =>
      `replace(${sql}, '${letter.replaceAll("'", "''")}', '${plain.replaceAll("'", "''")}')`,
    "e.lemma",
  );
  counts.grammarReplaced = sqlite.run(
    `DELETE FROM forms
     WHERE form IN (
       SELECT f.form FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.source = ${FormSource.Lemma} AND e.source_pos = '${GRAMMAR_SOURCE_POS}'
     )
     AND EXISTS (
       SELECT 1 FROM entries
       WHERE id = forms.entry_id
         AND source_pos <> '${GRAMMAR_SOURCE_POS}'
         AND (
           pos IN (${[...GRAMMAR_POS].map((p) => `'${p}'`).join(", ")})
           OR source_pos = 'contraction'
           OR (pos <> 'X' AND pos IN (
             SELECT g.pos FROM forms gf JOIN entries g ON g.id = gf.entry_id
             WHERE gf.source = ${FormSource.Lemma} AND g.source_pos = '${GRAMMAR_SOURCE_POS}'
               AND gf.form = forms.form
           ))
         )
     )`,
  ).changes;
  sqlite.run(`CREATE TEMP TABLE listed AS
    SELECT DISTINCT f.form AS form FROM forms f JOIN entries e ON e.id = f.entry_id
    WHERE f.source = ${FormSource.Lemma} AND e.source_pos = '${GRAMMAR_SOURCE_POS}'`);
  counts.grammarReplaced += sqlite.run(
    `DELETE FROM forms WHERE (form, entry_id) IN (
       SELECT f.form, e.id FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.source = ${FormSource.FormOf}
         AND f.form IN (SELECT form FROM listed)
         AND (${plainLemma} = e.lemma OR ${plainLemma} <> f.form)
         AND (
           (e.source_pos = '${GRAMMAR_SOURCE_POS}'
             AND e.pos IN (${[...GRAMMAR_POS].map((p) => `'${p}'`).join(", ")}))
           OR EXISTS (
             SELECT 1 FROM listed other
             JOIN forms lf ON lf.form = other.form AND lf.entry_id = e.id
             WHERE lf.source = ${FormSource.Lemma} AND other.form <> f.form
               AND NOT EXISTS (
                 SELECT 1 FROM form_of_pending p
                 WHERE p.form = f.form AND p.lemma = other.form AND p.source_pos = e.source_pos
               )
           )
         )
     )`,
  ).changes;
  sqlite.run("DROP TABLE listed");
};

/** Entries no form reaches any more (Wiktionary's replaced grammar words). */
export const dropUnreachedEntries = ({ sqlite, counts }: WriterContext) => {
  const unreached = `NOT IN (SELECT entry_id FROM forms)`;
  counts.senses -= sqlite.run(
    `DELETE FROM senses WHERE entry_id ${unreached}`,
  ).changes;
  counts.pronunciations -= sqlite.run(
    `DELETE FROM pronunciations WHERE entry_id ${unreached}`,
  ).changes;
  counts.entries -= sqlite.run(
    `DELETE FROM entries WHERE id ${unreached}`,
  ).changes;
};
