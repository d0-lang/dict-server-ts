import type { DictionaryDb } from "./DictionaryDb.ts";
import { caseClass, lookupKey } from "./lookupKey.ts";
import { CaseClass, FormSource, type UdPos } from "./schema.ts";

/**
 * What the sentence around a word adds to its lookup: the multi-word entries
 * (phrases, idioms) the word is part of here, and for German the separable
 * verb it belongs to (`fand ... statt` -> `stattfinden`). Only used when the
 * client sends `context`.
 */

/** A word of the context, with what separates it from the word before. */
export type Token = {
  readonly key: string;
  /** How the word is capitalised in the context. */
  readonly caseClass: CaseClass;
  /** Clauses are split at punctuation, so a match can't reach across one. */
  readonly clause: number;
  /** The text between this word and the one before ends a clause. */
  readonly breakBefore: boolean;
};

/** Punctuation that ends a clause. A period also ends abbreviations, which only costs a missed match. */
const CLAUSE_BREAK = /[.!?;:,()[\]{}"„“”«»‹›–—]/u;

const segmenters = new Map<string, Intl.Segmenter>();
const segmenterFor = (locale: string): Intl.Segmenter => {
  let segmenter = segmenters.get(locale);
  if (segmenter === undefined) {
    segmenter = new Intl.Segmenter(locale, { granularity: "word" });
    segmenters.set(locale, segmenter);
  }
  return segmenter;
};

/** The words of `text`, normalized with `lookupKey`. */
export const tokenize = (
  text: string,
  locale: string,
): ReadonlyArray<Token> => {
  const tokens: Array<Token> = [];
  let clause = 0;
  let between = "";
  for (const { segment, isWordLike } of segmenterFor(locale).segment(text)) {
    if (!isWordLike) {
      between += segment;
      continue;
    }
    const breakBefore = tokens.length > 0 && CLAUSE_BREAK.test(between);
    if (breakBefore) clause++;
    tokens.push({
      key: lookupKey(segment),
      caseClass: caseClass(segment),
      clause,
      breakBefore,
    });
    between = "";
  }
  return tokens;
};

/** Parts of speech that make a word worth anchoring a phrase on. */
const CONTENT_POS: ReadonlySet<UdPos> = new Set([
  "NOUN",
  "PROPN",
  "ADJ",
  "NUM",
  "VERB",
]);

/** What the dictionary knows about a word of the context. */
type TokenInfo = {
  /** `lookupKey` of every lemma this form belongs to. */
  readonly lemmas: ReadonlySet<string>;
  /** The form's best reading, ranked as lookups rank, is a content word. */
  readonly content: boolean;
  /** The form is itself the lemma of a verb, so it can be a phrase's verb. */
  readonly verbLemma: boolean;
};

type FormRow = { id: number; lemma: string; pos: UdPos };

/**
 * Entries a normalized form belongs to, without the abbreviation fallback,
 * ranked like `rankedIds` in `queries.ts` for a word written as `wordClass`.
 */
const formRows = (
  db: DictionaryDb,
  key: string,
  wordClass: CaseClass = CaseClass.Capitalised,
): ReadonlyArray<FormRow> =>
  db.$client
    .query<FormRow, [string, number]>(
      `SELECT e.id AS id, e.lemma AS lemma, e.pos AS pos FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ?1 AND f.source <> ${FormSource.Abbreviation}
       ORDER BY
         CASE
           WHEN ?2 = ${CaseClass.AllCaps} THEN e.case_class <> ${CaseClass.AllCaps}
           WHEN e.case_class = ${CaseClass.AllCaps} THEN 2
           WHEN ?2 = ${CaseClass.Lower} THEN e.case_class <> ${CaseClass.Lower}
           ELSE 0
         END,
         f.source <> ${FormSource.Lemma},
         e.id`,
    )
    .all(key, wordClass);

/** `TokenInfo` per word and capitalisation, cached for one lookup. */
const tokenInfos = (db: DictionaryDb) => {
  const cache = new Map<string, TokenInfo>();
  return (
    key: string,
    wordClass: CaseClass = CaseClass.Capitalised,
  ): TokenInfo => {
    const cacheKey = `${wordClass}${key}`;
    let info = cache.get(cacheKey);
    if (info === undefined) {
      const rows = formRows(db, key, wordClass);
      info = {
        lemmas: new Set(rows.map((row) => lookupKey(row.lemma))),
        content: rows[0] !== undefined && CONTENT_POS.has(rows[0].pos),
        verbLemma: rows.some(
          (row) =>
            (row.pos === "VERB" || row.pos === "AUX") &&
            lookupKey(row.lemma) === key,
        ),
      };
      cache.set(cacheKey, info);
    }
    return info;
  };
};

/** A multi-word form of a multi-word entry, as words. */
type Phrase = {
  readonly tokens: ReadonlyArray<string>;
  readonly breaks: ReadonlyArray<boolean>;
  readonly entryIds: ReadonlyArray<number>;
  readonly verb: boolean;
  /** Every entry is an interjection, which only means that as a clause of its own. */
  readonly interjection: boolean;
};

/** Phrases by each of their words. */
type PhraseIndex = ReadonlyMap<string, ReadonlyArray<Phrase>>;

const indexes = new WeakMap<DictionaryDb, PhraseIndex>();

/**
 * Every multi-word form of a multi-word entry (`in Kraft treten`, `vor allem`,
 * and inflected rows like `Vereinigten Staaten`), indexed by its words. Built
 * once per file, on first use.
 */
export const phraseIndex = (db: DictionaryDb, locale: string): PhraseIndex => {
  const cached = indexes.get(db);
  if (cached !== undefined) return cached;
  const rows = db.$client
    .query<{ form: string; id: number; pos: UdPos }, []>(
      `SELECT f.form AS form, e.id AS id, e.pos AS pos FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE instr(f.form, ' ') > 0 AND instr(e.lemma, ' ') > 0 AND f.source <> ${FormSource.Abbreviation}
       ORDER BY f.form, e.id`,
    )
    .all();
  const byForm = new Map<
    string,
    { ids: Array<number>; verb: boolean; interjection: boolean }
  >();
  for (const row of rows) {
    const phrase = byForm.get(row.form) ?? {
      ids: [],
      verb: false,
      interjection: true,
    };
    phrase.ids.push(row.id);
    phrase.verb ||= row.pos === "VERB";
    phrase.interjection &&= row.pos === "INTJ";
    byForm.set(row.form, phrase);
  }
  const index = new Map<string, Array<Phrase>>();
  for (const [form, { ids, verb, interjection }] of byForm) {
    const tokens = tokenize(form, locale);
    if (tokens.length < 2) continue;
    const phrase: Phrase = {
      tokens: tokens.map((token) => token.key),
      breaks: tokens.map((token) => token.breakBefore),
      entryIds: ids,
      verb,
      interjection,
    };
    for (const key of new Set(phrase.tokens)) {
      const list = index.get(key);
      if (list === undefined) index.set(key, [phrase]);
      else list.push(phrase);
    }
  }
  indexes.set(db, index);
  return index;
};

/** Languages that put the rest of a verb phrase at the end of the clause. */
const BRACKET: ReadonlySet<string> = new Set(["de"]);

/** Reflexive pronouns a phrase's `sich` stands for. */
const REFLEXIVES: Readonly<Record<string, ReadonlySet<string>>> = {
  de: new Set(["sich", "mich", "dich", "uns", "euch", "mir", "dir"]),
};

type Matcher = {
  readonly tokens: ReadonlyArray<Token>;
  readonly info: (key: string, wordClass?: CaseClass) => TokenInfo;
  readonly reflexives: ReadonlySet<string> | undefined;
  /**
   * The verb of a phrase that comes before the rest leaves the rest at the
   * end of the clause, as in German (`tritt morgen in Kraft`). Without this,
   * the `ist an` row of `an sein` matches `Er ist an der Uni`.
   */
  readonly bracket: boolean;
  /** Every context word and its lemmas: a phrase with a word outside it can't match. */
  readonly available: ReadonlySet<string>;
};

/**
 * The word `word` of `phrase` can stand for the context word at `at`: as
 * written, as a reflexive, or inflected if it is the verb of a verb phrase
 * (`miało miejsce` for `mieć miejsce`). Other words only match the phrase's
 * own forms, so `niczego` doesn't make the interjection `to nic`.
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
  return (
    phrase.verb && m.info(token.key).lemmas.has(word) && m.info(word).verbLemma
  );
};

/**
 * The phrase words `positions` sit at context words `start`, `start + 1`, ...
 * in that order, in one clause, with a clause break only where the phrase has
 * one (`z. B.`).
 */
const runMatches = (
  m: Matcher,
  phrase: Phrase,
  positions: ReadonlyArray<number>,
  start: number,
): boolean =>
  positions.every((p, offset) => {
    const at = start + offset;
    const token = m.tokens[at];
    if (token === undefined || !wordMatches(m, phrase, phrase.tokens[p]!, at)) {
      return false;
    }
    return offset === 0 || !token.breakBefore || phrase.breaks[p] === true;
  });

type PhraseMatch = {
  readonly phrase: Phrase;
  /** All words in place, not a verb moved away from the rest. */
  readonly contiguous: boolean;
  /** Words written exactly as in the phrase. */
  readonly exact: number;
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
const matchPhrase = (
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
        !endsClause(m.tokens, start + n - 1, false))
    ) {
      continue;
    }
    const last = phrase.tokens[n - 1]!;
    if (
      m.bracket &&
      phrase.verb &&
      !m.info(last).verbLemma &&
      !endsClause(m.tokens, start + n - 1)
    ) {
      continue;
    }
    return { phrase, contiguous: true, exact: exactCount(m, phrase, at) };
  }
  if (!phrase.verb) return undefined;
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
          !at.includes(i) && wordMatches(m, phrase, phrase.tokens[verb]!, i),
      );
      const covers = at.includes(clicked) || verbAt.includes(clicked);
      if (!covers || verbAt.length === 0) continue;
      const verbPlace = verbAt.includes(clicked) ? clicked : verbAt[0]!;
      // A verb after the rest stands next to it (`ums Leben kam`), which
      // the contiguous match covers. One far after it is another verb's.
      if (
        m.bracket &&
        (verbPlace > at[0]! || !endsClause(m.tokens, at.at(-1)!))
      ) {
        continue;
      }
      // Elsewhere at most one word comes between (`miało to miejsce`), so
      // `jest to się w dupie` isn't `być w dupie`.
      const gap =
        verbPlace < at[0]!
          ? at[0]! - verbPlace - 1
          : verbPlace - at.at(-1)! - 1;
      if (!m.bracket && gap > MAX_GAP) continue;
      const placed = all.map((p) =>
        p === verb ? verbPlace : at[rest.indexOf(p)]!,
      );
      return {
        phrase,
        contiguous: false,
        exact: exactCount(m, phrase, placed),
      };
    }
  }
  return undefined;
};

/** Words allowed between a verb and the rest of its phrase, outside German. */
const MAX_GAP = 1;

/** Phrases kept per lookup, longest first. */
const MAX_PHRASES = 3;

/** Context words equal to `word`; a word the client sent with spaces is not looked for. */
const positionsOf = (
  tokens: ReadonlyArray<Token>,
  word: string,
  locale: string,
): ReadonlyArray<number> => {
  const own = tokenize(word, locale);
  if (own.length !== 1) return [];
  return tokens.flatMap((token, i) => (token.key === own[0]!.key ? [i] : []));
};

/**
 * Entry ids of the phrases `word` is part of in `context`, best first: more
 * words, then all in place, then more words written as in the phrase.
 */
export const phraseEntryIds = (
  db: DictionaryDb,
  word: string,
  context: string,
  locale: string,
): ReadonlyArray<number> => {
  const tokens = tokenize(context, locale);
  const positions = positionsOf(tokens, word, locale);
  if (positions.length === 0) return [];
  const index = phraseIndex(db, locale);
  const info = tokenInfos(db);
  const available = new Set<string>();
  for (const token of tokens) {
    available.add(token.key);
    for (const lemma of info(token.key).lemmas) available.add(lemma);
  }
  const m: Matcher = {
    tokens,
    info,
    reflexives: REFLEXIVES[locale],
    bracket: BRACKET.has(locale),
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
  const ids = [...matches.values()]
    .sort(rank)
    .slice(0, MAX_PHRASES)
    .flatMap((match) => match.phrase.entryIds);
  return [...new Set(ids)];
};

const rank = (a: PhraseMatch, b: PhraseMatch): number =>
  b.phrase.tokens.length - a.phrase.tokens.length ||
  Number(b.contiguous) - Number(a.contiguous) ||
  b.exact - a.exact;

/** Words that may follow a clause-final separable particle without punctuation. */
const CONJUNCTIONS: ReadonlySet<string> = new Set([
  "und",
  "oder",
  "aber",
  "sondern",
  "denn",
  "sowie",
  "bzw",
]);

/**
 * The word at `i` ends its clause, where a separated particle stands. A
 * conjunction counts as a clause break unless `conjunctions` is false.
 */
const endsClause = (
  tokens: ReadonlyArray<Token>,
  i: number,
  conjunctions = true,
): boolean => {
  const next = tokens[i + 1];
  return (
    next === undefined ||
    next.breakBefore ||
    (conjunctions && CONJUNCTIONS.has(next.key))
  );
};

/** Verb entries of `particle` + `verb`, joined (`statt` + `fand`) or as a two-word form (`rief an`). */
const separableIds = (
  db: DictionaryDb,
  verb: string,
  particle: string,
): ReadonlyArray<number> =>
  [`${particle}${verb}`, `${verb} ${particle}`].flatMap((form) =>
    formRows(db, form)
      .filter((row) => {
        const lemma = lookupKey(row.lemma);
        return (
          row.pos === "VERB" &&
          !lemma.includes(" ") &&
          lemma.startsWith(particle) &&
          lemma !== particle
        );
      })
      .map((row) => row.id),
  );

/**
 * Entry ids of the separable verb `word` belongs to in `context`, for German:
 * the finite verb with its particle at the end of the clause (`Er fand gestern
 * statt`), whichever of the two was clicked. Only a particle-verb pair that is
 * a form in the dictionary counts, so `mit` in `geht mit ihr` is no particle.
 */
export const separableEntryIds = (
  db: DictionaryDb,
  word: string,
  context: string,
  locale: string,
): ReadonlyArray<number> => {
  const tokens = tokenize(context, locale);
  const ids: Array<number> = [];
  for (const clicked of positionsOf(tokens, word, locale)) {
    const { key, clause } = tokens[clicked]!;
    // The clicked word is the verb: its particle ends the clause.
    for (let j = clicked + 1; j < tokens.length; j++) {
      if (tokens[j]!.clause !== clause) break;
      if (endsClause(tokens, j)) {
        ids.push(...separableIds(db, key, tokens[j]!.key));
        break;
      }
    }
    // The clicked word is the particle: the nearest verb before it that forms one.
    if (endsClause(tokens, clicked)) {
      for (let j = clicked - 1; j >= 0; j--) {
        if (tokens[j]!.clause !== clause) break;
        const found = separableIds(db, tokens[j]!.key, key);
        if (found.length > 0) {
          ids.push(...found);
          break;
        }
      }
    }
  }
  return [...new Set(ids)];
};
