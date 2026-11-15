import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { lookupKey } from "@dict/core/lookupKey";
import {
  findEntriesByForm,
  type LookupEntry,
  type LookupResult,
  type Segment,
} from "../common/entries.ts";

/** The apostrophes texts write after an elided word (`l'`, `l’`). */
const APOSTROPHE = /['‘’ʼ]/u;

/** A gloss that only names a contraction's parts: `que + on`, `se + est (… of être)`. */
const PARTS_GLOSS = /^[\p{L}'’-]+ \+ [\p{L}'’-]+(?: \(.*\))?$/u;

/** The entry's first sense only names the word's parts. */
const namesParts = (entry: LookupEntry): boolean => {
  const gloss = entry.senses[0]?.glosses[0];
  return gloss !== undefined && PARTS_GLOSS.test(gloss);
};

/**
 * An elided word and the word it is written onto, for languages that write
 * them as one (`elision`): `l'homme` is `homme` and `l'` (`le`), with a
 * segment each, the host word's entries first. The split is after the first
 * apostrophe, and the host is looked up by `lookupHost`, so it may be split
 * again (`qu'aujourd'hui`).
 *
 * Undefined when `whole`, the word's own lookup, has an entry for the word
 * itself (`aujourd'hui`, `d'abord`, `c'est`), or when either part has no
 * entry. Entries the word only reaches as a form of something else give way
 * to the split: `qu'il` is listed as a form of `que`, which leaves out `il`.
 * So do entries of its own that only name its parts (`qu'on` "que + on",
 * `s'est` "se + est"), which the parts' entries explain.
 *
 * A noun made from a clause (`j'aime` "a like") is split all the same when
 * the host reads as a verb, and follows the split: in running text `j'aime`
 * is "I like". Nouns whose host isn't a verb stay whole (`presqu'île`,
 * `m'sieur`).
 */
export const elidedResult = (
  db: DictionaryDb,
  word: string,
  whole: LookupResult,
  lookupHost: (host: string) => LookupResult,
): LookupResult | undefined => {
  const key = lookupKey(word);
  const own = whole.entries.filter(
    (entry) => lookupKey(entry.lemma) === key && !namesParts(entry),
  );
  const clause = own.length > 0 && own.every((entry) => entry.pos === "NOUN");
  if (own.length > 0 && !clause) return undefined;
  const at = word.search(APOSTROPHE);
  if (at < 1) return undefined;
  const elided = word.slice(0, at + 1);
  const host = word.slice(at + 1);
  if (!/\p{L}/u.test(host)) return undefined;
  const clitics = findEntriesByForm(db, elided);
  if (clitics.length === 0) return undefined;
  const found = lookupHost(host);
  if (found.entries.length === 0) return undefined;
  if (clause && found.entries[0]?.pos !== "VERB") return undefined;
  const first = found.entries.length;
  const segments: ReadonlyArray<Segment> = [
    { text: elided, entries: clitics.map((_, i) => first + i) },
    ...(found.segments ?? [
      { text: host, entries: found.entries.map((_, i) => i) },
    ]),
  ];
  return { entries: [...found.entries, ...clitics, ...own], segments };
};
