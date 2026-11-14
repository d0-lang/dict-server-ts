import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES_DIR } from "@dict/core/language";
import { cleanWord } from "@dict/core/lookupKey";
import { UD_POS, type UdPos } from "@dict/core/schema";

/**
 * Hand-written entries for a language's grammar words (articles, pronouns,
 * contractions), in `languages/<lang>/grammar.tsv` at the repo root. Wiktionary describes these poorly
 * for a reader: `des` only redirects to `der`, defined as "nominative masculine
 * singular definite article", and Polish `mi` to `ja` "I". Here each form says
 * what it means.
 *
 * One line per word as written and part of speech, tab-separated:
 *
 *     des	DET	of the (masculine or neuter, genitive)
 *
 * Senses are separated by ` | `. `#` starts a comment line. Case matters:
 * `Sie` and `sie` are different lines. A sense may end with `→` and words the
 * file lists, which it points at as `see` (`なかった`, "past of ない" → `ない`).
 * A word may have other spellings after a `/`, which find its line
 * (`ようとする/うとする`: `行こうとする` has no `よう`).
 */

export type GrammarEntry = {
  readonly lemma: string;
  readonly pos: UdPos;
  readonly senses: ReadonlyArray<string>;
  /** Other spellings that find the line (`うとする` for `ようとする`). */
  readonly forms?: ReadonlyArray<string>;
  /** Each sense's `see` words, by the sense's index, when any has some. */
  readonly see?: ReadonlyArray<ReadonlyArray<string>>;
};

/**
 * Parts of speech the file owns for the words it lists: Wiktionary's entries
 * with these are dropped for those words, so `ihr` no longer reaches `sein`
 * through the possessive table. Nouns, verbs and other content words stay
 * (`sein` the verb, `je` "eats"), unless the file lists the word with that
 * part of speech too: then its line replaces Wiktionary's (`здесь ADV`, for a
 * sense Wiktionary lacks). `X` lines, such as endings, only add.
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
  const entries = text.split("\n").flatMap((raw, i) => {
    const line = raw.trimEnd();
    if (line.trim() === "" || line.trimStart().startsWith("#")) return [];
    const where = `${file}:${i + 1}`;
    const columns = line.split("\t");
    if (columns.length !== 3) {
      throw new Error(`${where}: expected 3 tab-separated columns`);
    }
    const [word, pos, meanings] = columns as [string, string, string];
    const [lemma = "", ...forms] = word.split("/").map(cleanWord);
    if (lemma === "" || forms.includes("")) {
      throw new Error(`${where}: empty word`);
    }
    if (!POS.has(pos))
      throw new Error(`${where}: unknown part of speech ${pos}`);
    const key = `${lemma}\u0000${pos}`;
    if (seen.has(key))
      throw new Error(`${where}: ${lemma} ${pos} is listed twice`);
    seen.add(key);
    const parts = meanings.split(" | ").map((s) => {
      const [sense = "", targets] = s.split("→");
      return {
        sense: sense.trim(),
        see:
          targets === undefined
            ? []
            : targets.split(",").map((target) => cleanWord(target)),
      };
    });
    if (parts.some(({ sense, see }) => sense === "" || see.includes(""))) {
      throw new Error(`${where}: empty sense`);
    }
    const senses = parts.map(({ sense }) => sense);
    const see = parts.map(({ see }) => see);
    return [
      {
        where,
        lemma,
        pos: pos as UdPos,
        senses,
        ...(forms.length > 0 ? { forms } : {}),
        ...(see.some((words) => words.length > 0) ? { see } : {}),
      },
    ];
  });
  // `see` names words of this file, so each has an entry.
  const lemmas = new Set(entries.map((entry) => entry.lemma));
  for (const { where, see } of entries) {
    const missing = see?.flat().find((target) => !lemmas.has(target));
    if (missing !== undefined) {
      throw new Error(`${where}: → ${missing}, which the file does not list`);
    }
  }
  return entries.map(({ where: _, ...entry }) => entry);
};

/** The grammar entries of a language; none when it has no file. */
export const loadGrammar = (
  lang: string,
  dir = LANGUAGES_DIR,
): ReadonlyArray<GrammarEntry> => {
  const file = join(dir, lang, "grammar.tsv");
  return existsSync(file)
    ? parseGrammarFile(
        readFileSync(file, "utf8"),
        `languages/${lang}/grammar.tsv`,
      )
    : [];
};
