import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES_DIR } from "@dict/core/language";
import { cleanWord } from "@dict/core/lookupKey";

/**
 * Hand-written numerals, in `languages/<lang>/numerals.tsv`, for a language
 * whose Wiktionary numerals are too uneven to show: Japanese `九` has a
 * numeral and a noun for each reading, a kanji entry, and Chinese readings
 * from mahjong, eight entries that all say "nine", while `五` has only nouns.
 * A word in the file shows its lines instead of Wiktionary's numerals, nouns
 * and kanji entries for it (`replaceNumerals`); its names and affixes stay.
 *
 * One line per word and reading, tab-separated, senses separated by ` | `:
 *
 *     九	く	nine (in 九月, September; 九時, nine o'clock)
 *
 * `#` starts a comment line.
 */

export type NumeralEntry = {
  readonly lemma: string;
  readonly reading: string;
  readonly senses: ReadonlyArray<string>;
};

export const parseNumeralsFile = (
  text: string,
  file: string,
): ReadonlyArray<NumeralEntry> => {
  const seen = new Set<string>();
  return text.split("\n").flatMap((raw, i) => {
    const line = raw.trimEnd();
    if (line.trim() === "" || line.trimStart().startsWith("#")) return [];
    const where = `${file}:${i + 1}`;
    const columns = line.split("\t");
    if (columns.length !== 3) {
      throw new Error(`${where}: expected 3 tab-separated columns`);
    }
    const [word, readingColumn, meanings] = columns as [string, string, string];
    const lemma = cleanWord(word);
    const reading = readingColumn.trim();
    if (lemma === "" || reading === "") {
      throw new Error(`${where}: empty word or reading`);
    }
    const key = `${lemma}\u0000${reading}`;
    if (seen.has(key)) {
      throw new Error(`${where}: ${lemma} ${reading} is listed twice`);
    }
    seen.add(key);
    const senses = meanings.split(" | ").map((sense) => sense.trim());
    if (senses.includes("")) throw new Error(`${where}: empty sense`);
    return [{ lemma, reading, senses }];
  });
};

/** The numeral entries of a language; none when it has no file. */
export const loadNumerals = (
  lang: string,
  dir = LANGUAGES_DIR,
): ReadonlyArray<NumeralEntry> => {
  const file = join(dir, lang, "numerals.tsv");
  return existsSync(file)
    ? parseNumeralsFile(
        readFileSync(file, "utf8"),
        `languages/${lang}/numerals.tsv`,
      )
    : [];
};
