import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanWord } from "../dictionary/lookupKey.ts";
import { UD_POS, type UdPos } from "../dictionary/schema.ts";

/**
 * Hand-written entries for a language's grammar words (articles, pronouns,
 * contractions), in `grammar/<lang>.tsv`. Wiktionary describes these poorly
 * for a reader: `des` only redirects to `der`, defined as "nominative masculine
 * singular definite article", and Polish `mi` to `ja` "I". Here each form says
 * what it means.
 *
 * One line per word as written and part of speech, tab-separated:
 *
 *     des	DET	of the (masculine or neuter, genitive)
 *
 * Senses are separated by ` | `. `#` starts a comment line. Case matters:
 * `Sie` and `sie` are different lines.
 */

export type GrammarEntry = {
  readonly lemma: string;
  readonly pos: UdPos;
  readonly senses: ReadonlyArray<string>;
};

/**
 * Parts of speech the file owns for the words it lists: Wiktionary's entries
 * with these are dropped for those words, so `ihr` no longer reaches `sein`
 * through the possessive table. Nouns, verbs and other content words stay
 * (`sein` the verb, `je` "eats").
 */
export const GRAMMAR_POS: ReadonlySet<UdPos> = new Set([
  "DET",
  "PRON",
  "ADP",
  "CCONJ",
  "SCONJ",
  "PART",
  "AUX",
]);

const POS: ReadonlySet<string> = new Set(UD_POS);

export const parseGrammarFile = (
  text: string,
  file: string,
): ReadonlyArray<GrammarEntry> => {
  const seen = new Set<string>();
  return text.split("\n").flatMap((raw, i) => {
    const line = raw.trimEnd();
    if (line.trim() === "" || line.trimStart().startsWith("#")) return [];
    const where = `${file}:${i + 1}`;
    const columns = line.split("\t");
    if (columns.length !== 3) {
      throw new Error(`${where}: expected 3 tab-separated columns`);
    }
    const [word, pos, meanings] = columns as [string, string, string];
    const lemma = cleanWord(word);
    if (lemma === "") throw new Error(`${where}: empty word`);
    if (!POS.has(pos))
      throw new Error(`${where}: unknown part of speech ${pos}`);
    const key = `${lemma}\u0000${pos}`;
    if (seen.has(key))
      throw new Error(`${where}: ${lemma} ${pos} is listed twice`);
    seen.add(key);
    const senses = meanings.split(" | ").map((s) => s.trim());
    if (senses.some((s) => s === "")) throw new Error(`${where}: empty sense`);
    return [{ lemma, pos: pos as UdPos, senses }];
  });
};

/** The grammar entries of a language; none when it has no file. */
export const loadGrammar = (
  lang: string,
  dir = join(import.meta.dirname, "grammar"),
): ReadonlyArray<GrammarEntry> => {
  const file = join(dir, `${lang}.tsv`);
  return existsSync(file)
    ? parseGrammarFile(readFileSync(file, "utf8"), `grammar/${lang}.tsv`)
    : [];
};
