import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import { lookupKey } from "@dict/core/lookupKey";
import { CaseClass } from "@dict/core/schema";
import type { LookupEntry, LookupResult } from "../common/entries.ts";
import { formRows } from "../common/forms.ts";
import type { Token } from "../common/tokenize.ts";

/** How the neighbouring words reorder the clicked word's entries. */
type Hint =
  /** A past participle after an auxiliary: `elle est partie`. */
  | "participle"
  /** A verb after a subject or before a joined pronoun: `je passe`, `dit-il`. */
  | "verb"
  /** No verb after a determiner: `des mesures`. */
  | "noVerb";

/** Adverbs allowed between an auxiliary and its participle (`n'a pas dit`, `a toujours fait`). */
const MAX_ADVERBS = 2;

/**
 * The entry is a one-word `pos`. An entry of several words the word is a form
 * of keeps its place (`s'en faire` for `fait`): lookups rank it after the
 * one-word entries, and the sentence finds it as a phrase when it has it.
 */
const oneWord = (entry: LookupEntry, pos: LookupEntry["pos"]): boolean =>
  entry.pos === pos && !/\s/u.test(entry.lemma);

const keys = (words: ReadonlyArray<string>): ReadonlySet<string> =>
  new Set(words.map(lookupKey));

/** The word a token ends in: the host of an elided word (`il` of `qu'il`, `ai` of `j'ai`), else the token. */
const lastWord = (key: string, elision: boolean): string => {
  if (!elision) return key;
  const host = key.slice(key.indexOf("'") + 1);
  return /\p{L}/u.test(host) ? host : key;
};

const canBe = (
  db: DictionaryDb,
  key: string,
  pos: LookupEntry["pos"],
): boolean => formRows(db, key, CaseClass.Lower).some((row) => row.pos === pos);

/** `key` is a form of the verb `lemma`. */
const formOf = (db: DictionaryDb, key: string, lemma: string): boolean =>
  formRows(db, key, CaseClass.Lower).some(
    (row) => row.pos === "VERB" && row.lemma === lemma,
  );

/**
 * `key` is shaped like a past participle of the verb `lemma`: with a
 * participle's declension ending or nothing taken off, it ends in one of
 * `endings` and is still a form of that verb. `partie` is `parti` + `e`, a
 * form of `partir`; `envie` is no participle of `envier`, since `envi` is no
 * form of it.
 */
const participleOf = (
  db: DictionaryDb,
  key: string,
  lemma: string,
  endings: ReadonlyArray<string>,
  declension: ReadonlyArray<string>,
): boolean =>
  ["", ...declension].some((ending) => {
    if (!key.endsWith(ending)) return false;
    const base = key.slice(0, key.length - ending.length);
    return (
      endings.some((end) => base.length > end.length && base.endsWith(end)) &&
      formOf(db, base, lemma)
    );
  });

/**
 * `entries` in a new order: `entries[order[k]]` comes k-th. Only the
 * positions in `subject` move, among themselves, so segments that list them
 * stay right.
 */
const permute = (
  entries: ReadonlyArray<LookupEntry>,
  subject: ReadonlyArray<number>,
  order: ReadonlyArray<number>,
): ReadonlyArray<LookupEntry> => {
  const result = [...entries];
  subject.forEach((position, k) => {
    result[position] = entries[order[k]!]!;
  });
  return result;
};

/**
 * A word's entries ordered by its neighbours, for languages that set the
 * `[context]` hints `verbAfter`, `verbBeforeJoined`, `noVerbAfter` and
 * `participleEndings` (French). Without them a word's entries take no notice
 * of the sentence, and the rare noun whose lemma the word is beats the common
 * verb whose form it is: `passe` "pass" before `passer`.
 *
 * - After an auxiliary (a word with an `AUX` entry), with at most two
 *   adverbs between, a verb the word is a past participle of
 *   (`participleOf`) moves to just before the word's first noun: `elle est
 *   partie` opens on `partir`, `il a dit` on `dire`. It passes no adjective,
 *   adverb or grammar word: `je suis désolé` keeps "sorry" first.
 * - After one of `verbAfter` (`je passe`, `n'oublie`), or before one of
 *   `verbBeforeJoined` with only a hyphen between (`dit-il`, `donne-moi`),
 *   the verb and auxiliary entries come first. Among them, a verb whose
 *   lemma is the word itself follows the verbs it is a form of: such a verb is
 *   an infinitive or a participle used alone (`dit` "called"), while here the
 *   word is a verb's finite form (`dire`).
 * - After one of `noVerbAfter` (`des mesures`), the verb entries come last.
 *   Only verbs move, so `un petit chien` keeps the adjective first.
 *
 * The participle comes first because it reads the most (an auxiliary, the
 * word's shape and its verb); then a verb pronoun, then a determiner. In
 * practice they hardly meet, since the lists hold pronouns and determiners,
 * which are no auxiliaries, and only the joined pronoun looks the other way.
 *
 * A clause break between the words cancels a hint. An elided word and its
 * host (`n'oublie`) are two words: the host comes after the elided one, and
 * only the host's entries move. After an elided token, the word before is its
 * host (`qu'il passe`, `j'ai fait`). Every occurrence of the word must agree,
 * when the click is ambiguous.
 */
export const orderByNeighbours = (
  db: DictionaryDb,
  language: Language,
  word: string,
  tokens: ReadonlyArray<Token>,
  positions: ReadonlyArray<number>,
  result: LookupResult,
): LookupResult => {
  const { context, elision } = language;
  const verbAfter = keys(context.verbAfter);
  const verbBeforeJoined = keys(context.verbBeforeJoined);
  const noVerbAfter = keys(context.noVerbAfter);
  const endings = context.participleEndings;
  if (
    verbAfter.size === 0 &&
    verbBeforeJoined.size === 0 &&
    noVerbAfter.size === 0 &&
    endings.length === 0
  ) {
    return result;
  }
  if (positions.length === 0 || result.entries.length < 2) return result;

  // The word whose entries move, and the word before it inside the clicked
  // token: the host and the elided word of `n'oublie`.
  const host = result.segments?.at(-1);
  const elided = result.segments?.at(-2)?.text;
  const inside =
    elided !== undefined && elision && lookupKey(elided).endsWith("'")
      ? lookupKey(elided)
      : undefined;
  // Parts of a compound: none of them is the word the sentence speaks of.
  if (host !== undefined && inside === undefined) return result;
  const subject =
    host === undefined
      ? result.entries.map((_, i) => i)
      : [...(host.entries ?? [])].sort((a, b) => a - b);
  if (subject.length < 2) return result;
  const key = lookupKey(host?.text ?? word);
  const own = subject.map((i) => result.entries[i]!);

  // Indexes into `own` of the verbs the word is a past participle of.
  let participles: ReadonlyArray<number> | undefined;
  const participleVerbs = (): ReadonlyArray<number> =>
    (participles ??= own.flatMap((entry, k) =>
      oneWord(entry, "VERB") &&
      lookupKey(entry.lemma) !== key &&
      participleOf(
        db,
        key,
        entry.lemma,
        endings,
        language.import.participleDeclension?.endings ?? [],
      )
        ? [k]
        : [],
    ));

  const hintAt = (i: number): Hint | undefined => {
    const next = tokens[i + 1];
    const joinedNext =
      next !== undefined && next.joinedBefore && verbBeforeJoined.has(next.key);
    // The word before the one at `j`: inside the clicked token, its elided
    // word, which nothing reaches past.
    const before = (j: number): string | undefined => {
      if (inside !== undefined) return j === i ? inside : undefined;
      return j > 0 && !tokens[j]!.breakBefore
        ? lastWord(tokens[j - 1]!.key, elision)
        : undefined;
    };
    if (endings.length > 0) {
      let adverbs = 0;
      for (let j = i; ; j--) {
        const prev = before(j);
        if (prev === undefined) break;
        if (canBe(db, prev, "AUX")) {
          if (participleVerbs().length > 0) return "participle";
          break;
        }
        if (adverbs === MAX_ADVERBS || !canBe(db, prev, "ADV")) break;
        adverbs++;
      }
    }
    const prev = before(i);
    if ((prev !== undefined && verbAfter.has(prev)) || joinedNext) {
      return "verb";
    }
    if (prev !== undefined && noVerbAfter.has(prev)) return "noVerb";
    return undefined;
  };

  const hints = positions.map(hintAt);
  const hint = hints[0];
  if (hint === undefined || hints.some((other) => other !== hint)) {
    return result;
  }

  const all = own.map((_, k) => k);
  let order: ReadonlyArray<number>;
  if (hint === "participle") {
    const firstNoun = own.findIndex((entry) => entry.pos === "NOUN");
    const moving = participleVerbs().filter((k) => k > firstNoun);
    if (firstNoun < 0 || moving.length === 0) return result;
    const stay = all.filter((k) => !moving.includes(k));
    const at = stay.indexOf(firstNoun);
    order = [...stay.slice(0, at), ...moving, ...stay.slice(at)];
  } else {
    const rank = (entry: LookupEntry): number =>
      hint === "noVerb"
        ? Number(oneWord(entry, "VERB"))
        : oneWord(entry, "AUX")
          ? 0
          : !oneWord(entry, "VERB")
            ? 2
            : lookupKey(entry.lemma) === key
              ? 1
              : 0;
    order = [...all].sort((a, b) => rank(own[a]!) - rank(own[b]!) || a - b);
  }
  if (order.every((k, n) => k === n)) return result;
  return {
    ...result,
    entries: permute(
      result.entries,
      subject,
      order.map((k) => subject[k]!),
    ),
  };
};
