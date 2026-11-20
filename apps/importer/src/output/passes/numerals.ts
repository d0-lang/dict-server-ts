import { FormSource, NUMERAL_SOURCE_POS } from "@dict/core/schema";
import type { WriterContext } from "./context.ts";

/**
 * A word in the numerals file reaches none of Wiktionary's numerals, nouns
 * or kanji entries of it (`九` NUM, NOUN and the character `九`), nor any
 * other numeral (the kana `この`, whose page lists `九`). Its names and
 * affixes stay (`一` as a prefix, `千` the name). Entries nothing reaches any
 * more go with `dropUnreachedEntries`.
 */
export const replaceNumerals = ({ sqlite }: WriterContext) =>
  sqlite.run(
    `DELETE FROM forms WHERE (form, entry_id) IN (
       SELECT f.form, e.id FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE e.source_pos <> '${NUMERAL_SOURCE_POS}'
         AND f.form IN (
           SELECT nf.form FROM forms nf JOIN entries n ON n.id = nf.entry_id
           WHERE nf.source = ${FormSource.Lemma} AND n.source_pos = '${NUMERAL_SOURCE_POS}'
         )
         AND (e.pos = 'NUM'
           OR (e.lemma = f.form AND (e.pos = 'NOUN' OR e.source_pos = 'character')))
     )`,
  );
