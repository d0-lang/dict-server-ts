import { hiragana, isKana } from "@dict/core/kana";
import { lookupKey } from "@dict/core/lookupKey";
import { FormSource } from "@dict/core/schema";
import type { WriterContext } from "./context.ts";

/**
 * `つまり` -> `詰まり`: Japanese Wiktionary keeps a word written in kana on
 * a page that only points at its lemmas in kanji (a soft redirect), and texts
 * write many words in kana. The spelling becomes a form of each lemma's
 * entries:
 * - of a word with no entry of its own: `は`, the particle, also points at
 *   `葉`, `歯`, `刃` and six more nouns;
 * - for a kana spelling of a kanji lemma, only of entries read that way:
 *   `ただし` points at `但し` "however", read `ただし`, and also at `正` and
 *   `直`, which have that reading only as names. Names are left out: running
 *   text writes them in kanji.
 * The same word in the other kana script is always a form (`ワクワク` ->
 * `わくわく`, though `パラパラ` has an entry of its own, a dance), and a
 * spelling in kanji needs no reading (`国々` -> `国国`).
 */
export const addRedirects = ({
  sqlite,
  counts,
  redirects,
  hasEntry,
  insertForm,
}: WriterContext) => {
  const readAs = sqlite.query<{ id: number }, [string, number, string]>(
    `SELECT DISTINCT f.entry_id AS id FROM forms f
     JOIN pronunciations p ON p.entry_id = f.entry_id AND p.kind = 'reading' AND p.value = ?3
     JOIN entries e ON e.id = f.entry_id AND e.pos <> 'PROPN'
     WHERE f.form = ?1 AND f.source = ?2`,
  );
  const lemmaOf = sqlite.query<{ id: number }, [string, number]>(
    `SELECT DISTINCT f.entry_id AS id FROM forms f
     JOIN entries e ON e.id = f.entry_id AND e.pos <> 'PROPN'
     WHERE f.form = ?1 AND f.source = ?2`,
  );
  sqlite.transaction(() => {
    for (const { form, targets } of redirects) {
      const own = hasEntry(form);
      for (const target of targets) {
        const key = lookupKey(target);
        const kanaVariant =
          isKana(form) && isKana(key) && hiragana(form) === hiragana(key);
        if (own && !kanaVariant) continue;
        const ids =
          isKana(form) && !isKana(key)
            ? readAs.all(key, FormSource.Lemma, form)
            : lemmaOf.all(key, FormSource.Lemma);
        for (const { id } of ids) {
          counts.redirectForms += insertForm.run(
            form,
            id,
            FormSource.Redirect,
          ).changes;
        }
      }
    }
  })();
};
