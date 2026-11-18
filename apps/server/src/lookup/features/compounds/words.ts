import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { caseClass, cleanWord, lookupKey } from "@dict/core/lookupKey";
import { CaseClass, FormSource } from "@dict/core/schema";
import { findEntriesByForm } from "../../common/entries.ts";
import { type CompoundSplit, distinctEntries } from "./parts.ts";
import {
  type CompoundRules,
  CONTENT_POS,
  type PartScore,
  splitCompound,
} from "./split.ts";

/** German-style compounds: every part is a word form (`Gemüse|fonds`). */
export const wordCompound = (
  db: DictionaryDb,
  word: string,
  { linkers, nounLinkers }: CompoundRules,
): CompoundSplit | undefined => {
  const capital = caseClass(cleanWord(word)) !== CaseClass.Lower;
  const key = lookupKey(word);
  const content = [...CONTENT_POS].map((p) => `'${p}'`).join(", ");
  const formScore = db.$client.query<{ score: number | null }, [string]>(
    `SELECT max(CASE WHEN f.source = ${FormSource.Lemma} AND e.pos <> 'VERB' THEN 2 ELSE 1 END) AS score
     FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source <> ${FormSource.Abbreviation} AND e.pos IN (${content})`,
  );
  // `left` is a form of a noun whose lemma is `stem` (`tages` of `Tag`).
  const nounForm = db.$client.query<{ n: number }, [string, string]>(
    `SELECT count(*) AS n FROM forms f JOIN entries e ON e.id = f.entry_id
     JOIN forms l ON l.entry_id = e.id AND l.source = ${FormSource.Lemma} AND l.form = ?2
     WHERE f.form = ?1 AND f.source <> ${FormSource.Abbreviation} AND e.pos IN ('NOUN', 'PROPN')`,
  );
  // `stem` is itself a noun, adverb or number (`Mais`, `Eisen`, `links`).
  const plainLemma = db.$client.query<{ n: number }, [string]>(
    `SELECT count(*) AS n FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source = ${FormSource.Lemma} AND e.pos IN ('NOUN', 'ADV', 'NUM')`,
  );
  /** See `PartScore`: `nounLinkers` link any noun, other linkers mostly a plural. */
  const partScore: PartScore = (stem, linker) => {
    const score = formScore.get(stem)!.score ?? 0;
    if (score === 0) return 0;
    if (linker === "" && plainLemma.get(stem)!.n > 0) return 4;
    if (linker !== "" && nounForm.get(stem + linker, stem)!.n > 0) return 3;
    return score === 2 && (linker === "" || nounLinkers.includes(linker))
      ? 2
      : 1;
  };
  const pieces = splitCompound(key, partScore, linkers);
  if (pieces === undefined) return undefined;
  const parts = pieces.filter((piece) => piece.part);
  // A modifier followed by a linker is a noun (`Spitze` + `n`), not `spitze` "great".
  const linked = pieces.flatMap((piece, i) =>
    piece.part ? [pieces[i + 1]?.part === false] : [],
  );
  const perPart = parts.map((piece, i) => {
    const part = piece.text;
    const surface = capital ? part[0]!.toUpperCase() + part.slice(1) : part;
    const found = findEntriesByForm(db, surface, {
      abbreviations: false,
    }).filter((entry) => CONTENT_POS.has(entry.pos));
    // A capitalised compound is a noun, and so is its head (`Tag`, not
    // `tagen`). A modifier is usually a stem as it stands (`Stahl`, not
    // `stehlen`), unless it only exists as a verb stem (`Förder-`).
    const isHead = i === parts.length - 1;
    // Wiktionary's prefix entry (`sonder-` "special") explains a modifier
    // better than the verb it is also a form of (`sondern` "to separate").
    const prefix = isHead
      ? []
      : findEntriesByForm(db, `${part}-`, { abbreviations: false });
    const preferred = isHead
      ? capital
        ? found.filter((entry) => entry.pos === "NOUN")
        : []
      : found.filter(
          (entry) =>
            lookupKey(entry.lemma) === part &&
            (!linked[i] || entry.pos === "NOUN" || entry.pos === "PROPN"),
        );
    if (prefix.length > 0 && preferred.length === 0) return prefix;
    return distinctEntries(preferred.length > 0 ? preferred : found);
  });
  return { pieces, perPart };
};
