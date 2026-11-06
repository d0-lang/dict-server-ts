import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import { CaseClass } from "@dict/core/schema";
import { contextRules, NO_CONJUNCTIONS } from "../../common/contextRules.ts";
import { type TokenInfo, tokenInfos } from "../../common/forms.ts";
import {
  endsClause,
  positionsOf,
  type Token,
  tokenize,
  type ContextHit,
  uniqueHits,
} from "../../common/tokenize.ts";
import { type Phrase, phraseIndex } from "./phraseIndex.ts";

type Matcher = {
  readonly tokens: ReadonlyArray<Token>;
  readonly info: (key: string, wordClass?: CaseClass) => TokenInfo;
  readonly reflexives: ReadonlySet<string> | undefined;
  /** Words allowed between a verb and the rest of its phrase (`context.maxGap`). */
  readonly maxGap: number;
  /** This language's verb negation (`context.negation`). */
  readonly negation: string | undefined;
  /**
   * Trying the phrase with a negated verb (`matchPhrase`): its other words
   * may stand in any of their forms, not only the phrase's own (`не даю слова`).
   */
  readonly negated: boolean;
  /**
   * The verb of a phrase that comes before the rest leaves the rest at the
   * end of the clause, as in German (`tritt morgen in Kraft`). Without this,
   * the `ist an` row of `an sein` matches `Er ist an der Uni`.
   */
  readonly bracket: boolean;
  /** Hyphen-joined parts are one word (`context.hyphenWords`). */
  readonly hyphenWords: boolean;
  /** Conjunctions that end a clause (`context.clauseConjunctions`). */
  readonly conjunctions: ReadonlySet<string>;
  /** Every context word and its lemmas: a phrase with a word outside it can't match. */
  readonly available: ReadonlySet<string>;
};

/**
 * The word `word` of `phrase` can stand for the context word at `at`: as
 * written, as a reflexive, or inflected if it is the verb of a verb phrase
 * (`miało miejsce` for `mieć miejsce`), or any word of a negated one
 * (`не имеет значения`). Other words only match the phrase's own forms, so
 * `niczego` doesn't make the interjection `to nic`.
 */
const wordMatches = (
  m: Matcher,
  phrase: Phrase,
  word: string,
  at: number,
): boolean => {
  const token = m.tokens[at];
  if (token === undefined) return false;
  if (token.key === word) return true;
  if (
    m.reflexives !== undefined &&
    word === "sich" &&
    m.reflexives.has(token.key)
  ) {
    return true;
  }
  if (!phrase.verb || !m.info(token.key).lemmas.has(word)) return false;
  return m.negated || m.info(word).verbLemma;
};

/**
 * The verb at context word `i` is negated: right after the negation (`не
 * имеет`), or after it and one helper verb (`не будет иметь`, `не могу дать`),
 * which also puts the object in the genitive.
 */
const negatedAt = (m: Matcher, i: number): boolean => {
  const before = (j: number) =>
    j > 0 && !m.tokens[j]!.breakBefore ? m.tokens[j - 1] : undefined;
  const prev = before(i);
  if (prev === undefined) return false;
  if (prev.key === m.negation) return true;
  return m.info(prev.key).verb && before(i - 1)?.key === m.negation;
};

/**
 * The phrase words `positions` sit at context words `start`, `start + 1`, ...
 * in that order, in one clause, with a clause break only where the phrase has
 * one (`z. B.`). Where hyphens join words, the run starts and ends at whole
 * words, so `то есть` doesn't match `кто-то есть`; inside it, a hyphen may
 * stand for a space (`треш-стримеров` for `треш стример`).
 */
const runMatches = (
  m: Matcher,
  phrase: Phrase,
  positions: ReadonlyArray<number>,
  start: number,
): boolean =>
  !(m.hyphenWords && m.tokens[start]?.joinedBefore === true) &&
  !(
    m.hyphenWords && m.tokens[start + positions.length]?.joinedBefore === true
  ) &&
  positions.every((p, offset) => {
    const at = start + offset;
    const token = m.tokens[at];
    if (token === undefined || !wordMatches(m, phrase, phrase.tokens[p]!, at)) {
      return false;
    }
    return (
      offset === 0 ||
      !token.breakBefore ||
      phrase.breaks[p] === true ||
      splitConjunction(m, phrase, p, token)
    );
  });

/** Fewest words of a phrase a comma may split before its last word. */
const MIN_SPLIT_PHRASE_WORDS = 3;

/**
 * A comma before the last word of a phrase that ends in a conjunction, which
 * the dictionary writes without it: `после того, как` for `после того как`,
 * `до тех пор, пока`. Only in phrases of three words or more: a comma inside
 * a two-word one usually makes two words of it (`так, как` is "the way that",
 * not `так как` "because"; `так, что` isn't `так что`). Not for
 * interjections, which stand as a clause of their own, nor for a verb phrase
 * whose verb stands apart, which must keep the rest in one clause.
 */
const splitConjunction = (
  m: Matcher,
  phrase: Phrase,
  p: number,
  token: Token,
): boolean =>
  token.commaBefore &&
  !phrase.interjection &&
  p === phrase.tokens.length - 1 &&
  phrase.tokens.length >= MIN_SPLIT_PHRASE_WORDS &&
  m.info(phrase.tokens[p]!).conjunction;

/** The context word at `i` is part of a hyphen-joined word. */
const inHyphenWord = (m: Matcher, i: number): boolean =>
  m.hyphenWords &&
  (m.tokens[i]!.joinedBefore || m.tokens[i + 1]?.joinedBefore === true);

type PhraseMatch = {
  readonly phrase: Phrase;
  /** All words in place, not a verb moved away from the rest. */
  readonly contiguous: boolean;
  /** Words written exactly as in the phrase. */
  readonly exact: number;
  /** The context word each phrase word stands for. */
  readonly placed: ReadonlyArray<number>;
};

const exactCount = (
  m: Matcher,
  phrase: Phrase,
  at: ReadonlyArray<number>,
): number =>
  at.filter((position, p) => m.tokens[position]!.key === phrase.tokens[p])
    .length;

/**
 * How `phrase` covers the context word `clicked`, if it does. All its words in
 * a row, or for a verb phrase, the rest in a row and the verb elsewhere in the
 * same clause (`tritt morgen in Kraft` for `in Kraft treten`); in German only
 * before the rest, which then ends the clause, elsewhere at most a word away. The rest has to hold a content
 * word, or `an sein` would match any `an` near `ist`.
 */
const placePhrase = (
  m: Matcher,
  phrase: Phrase,
  clicked: number,
): PhraseMatch | undefined => {
  const n = phrase.tokens.length;
  if (
    !phrase.tokens.every(
      (word) =>
        m.available.has(word) ||
        (word === "sich" && m.reflexives !== undefined),
    )
  ) {
    return undefined;
  }
  const all = phrase.tokens.map((_, p) => p);
  for (let p = 0; p < n; p++) {
    const start = clicked - p;
    if (start < 0 || !runMatches(m, phrase, all, start)) continue;
    const at = all.map((offset) => start + offset);
    // `Może być.` is "OK, that will do"; `nie może być gorzki` is literal.
    if (
      phrase.interjection &&
      ((start > 0 && !m.tokens[start]!.breakBefore) ||
        !endsClause(m.tokens, start + n - 1, NO_CONJUNCTIONS))
    ) {
      continue;
    }
    const last = phrase.tokens[n - 1]!;
    if (
      m.bracket &&
      phrase.verbEntry &&
      !m.info(last).verbLemma &&
      !endsClause(m.tokens, start + n - 1, m.conjunctions)
    ) {
      continue;
    }
    return {
      phrase,
      contiguous: true,
      exact: exactCount(m, phrase, at),
      placed: at,
    };
  }
  // In German an untyped phrase keeps its own order (`sprechen Sie Englisch`).
  if (!phrase.verb || (m.bracket && !phrase.verbEntry)) return undefined;
  const clause = m.tokens[clicked]!.clause;
  const inClause = m.tokens.flatMap((token, i) =>
    token.clause === clause ? [i] : [],
  );
  for (const verb of n > 1 ? [n - 1, 0] : []) {
    if (!m.info(phrase.tokens[verb]!).verbLemma) continue;
    const rest = all.filter((p) => p !== verb);
    for (const start of inClause) {
      const at = rest.map((_, offset) => start + offset);
      if (at.some((i) => m.tokens[i]?.clause !== clause)) continue;
      if (!runMatches(m, phrase, rest, start)) continue;
      if (
        !at.some((i) => {
          const token = m.tokens[i]!;
          return m.info(token.key, token.caseClass).content;
        })
      ) {
        continue;
      }
      const verbAt = inClause.filter(
        (i) =>
          !at.includes(i) &&
          !inHyphenWord(m, i) &&
          wordMatches(m, phrase, phrase.tokens[verb]!, i),
      );
      const covers = at.includes(clicked) || verbAt.includes(clicked);
      if (!covers || verbAt.length === 0) continue;
      // Words between the verb at `i` and the rest. The negation belongs to
      // the verb (`слова никому не давал`), so it doesn't count.
      const gapAt = (i: number): number => {
        const negationBetween =
          i > at.at(-1)! + 1 && m.tokens[i - 1]!.key === m.negation;
        return (
          (i < at[0]! ? at[0]! - i - 1 : i - at.at(-1)! - 1) -
          (negationBetween ? 1 : 0)
        );
      };
      // The clicked verb, or else in German the first (it comes before the
      // rest) and elsewhere the nearest (`дал ему и дал тебе слово`).
      const verbPlace = verbAt.includes(clicked)
        ? clicked
        : m.bracket
          ? verbAt[0]!
          : verbAt.reduce((best, i) => (gapAt(i) < gapAt(best) ? i : best));
      // A verb after the rest stands next to it (`ums Leben kam`), which
      // the contiguous match covers. One far after it is another verb's.
      if (
        m.bracket &&
        (verbPlace > at[0]! ||
          !endsClause(m.tokens, at.at(-1)!, m.conjunctions))
      ) {
        continue;
      }
      // Elsewhere only a few words come between (`miało to miejsce`,
      // `context.maxGap`), so `jest to się w dupie` isn't `być w dupie`.
      const gap = gapAt(verbPlace);
      if (!m.bracket && gap > m.maxGap) continue;
      const placed = all.map((p) =>
        p === verb ? verbPlace : at[rest.indexOf(p)]!,
      );
      return {
        phrase,
        contiguous: false,
        exact: exactCount(m, phrase, placed),
        placed,
      };
    }
  }
  return undefined;
};

/**
 * How `phrase` covers the context word `clicked` (`placePhrase`). Failing
 * that, with a negated verb, whose object may then stand in the genitive
 * (`не имеет значения` for `иметь значение`): the phrase's other words may be
 * in any form, as long as the verb the match uses is the negated one.
 */
const matchPhrase = (
  m: Matcher,
  phrase: Phrase,
  clicked: number,
): PhraseMatch | undefined => {
  const plain = placePhrase(m, phrase, clicked);
  if (plain !== undefined || m.negation === undefined || !phrase.verb) {
    return plain;
  }
  const match = placePhrase({ ...m, negated: true }, phrase, clicked);
  if (match === undefined) return undefined;
  const verbs = phrase.tokens.flatMap((word, p) =>
    m.info(word).verbLemma ? [p] : [],
  );
  return verbs.some((p) => negatedAt(m, match.placed[p]!)) ? match : undefined;
};

/** Phrases kept per lookup, longest first. */
const MAX_PHRASES = 3;

/**
 * Entry ids of the phrases `word` is part of in `context`, best first: more
 * words, then all in place, then more words written as in the phrase.
 */
export const phraseEntryIds = (
  db: DictionaryDb,
  word: string,
  context: string,
  language: Language,
  at?: number,
): ReadonlyArray<ContextHit> => {
  const locale = language.code;
  const tokens = tokenize(context, locale);
  const positions = positionsOf(tokens, word, locale, { context, at });
  if (positions.length === 0) return [];
  const index = phraseIndex(db, language);
  const info = tokenInfos(db);
  const available = new Set<string>();
  for (const token of tokens) {
    available.add(token.key);
    for (const lemma of info(token.key).lemmas) available.add(lemma);
  }
  const m: Matcher = {
    tokens,
    info,
    ...contextRules(language),
    negated: false,
    available,
  };
  const matches = new Map<Phrase, PhraseMatch>();
  for (const clicked of positions) {
    const key = tokens[clicked]!.key;
    const candidates = new Set<Phrase>();
    for (const lemma of [key, ...m.info(key).lemmas]) {
      for (const phrase of index.get(lemma) ?? []) candidates.add(phrase);
    }
    for (const phrase of candidates) {
      const match = matchPhrase(m, phrase, clicked);
      const old = matches.get(phrase);
      if (match !== undefined && (old === undefined || rank(match, old) < 0)) {
        matches.set(phrase, match);
      }
    }
  }
  return uniqueHits(
    [...matches.values()]
      .sort(rank)
      .slice(0, MAX_PHRASES)
      .flatMap((match) =>
        match.phrase.entryIds.map((id) => ({ id, tokens: match.placed })),
      ),
  );
};

const rank = (a: PhraseMatch, b: PhraseMatch): number =>
  b.phrase.tokens.length - a.phrase.tokens.length ||
  Number(b.contiguous) - Number(a.contiguous) ||
  b.exact - a.exact;
