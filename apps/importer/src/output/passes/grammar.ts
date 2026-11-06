import { FormSource, GRAMMAR_SOURCE_POS } from "@dict/core/schema";
import { GRAMMAR_POS } from "../../grammar.ts";
import type { WriterContext } from "./context.ts";

/**
 * A word in the grammar file shows none of Wiktionary's grammar-word entries,
 * nor its entries with a part of speech the file gives that word (`здесь ADV`
 * replaces Wiktionary's adverb `здесь`; `всё`, listed as a pronoun and a
 * determiner, keeps its adverb "still"). `X` lines (endings like `-го`) only add.
 */
export const replaceGrammarWords = ({ sqlite, counts }: WriterContext) => {
  counts.grammarReplaced = sqlite.run(
    `DELETE FROM forms
     WHERE form IN (
       SELECT f.form FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.source = ${FormSource.Lemma} AND e.source_pos = '${GRAMMAR_SOURCE_POS}'
     )
     AND entry_id IN (
       SELECT id FROM entries
       WHERE source_pos <> '${GRAMMAR_SOURCE_POS}'
         AND (
           pos IN (${[...GRAMMAR_POS].map((p) => `'${p}'`).join(", ")})
           OR (pos <> 'X' AND pos IN (
             SELECT g.pos FROM forms gf JOIN entries g ON g.id = gf.entry_id
             WHERE gf.source = ${FormSource.Lemma} AND g.source_pos = '${GRAMMAR_SOURCE_POS}'
               AND gf.form = forms.form
           ))
         )
     )`,
  ).changes;
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
