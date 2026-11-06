import { GRAMMAR_SOURCE_POS } from "../importer/grammar.ts";
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
  /** Only a hyphen stands between this word and the one before (`что-нибудь`). */
  readonly joinedBefore: boolean;
  /** Only a period, and at most one space, stands between this word and the one before (`т.д.`, `z. B.`). */
  readonly dottedBefore: boolean;
  /** Only a comma stands between this word and the one before. */
  readonly commaBefore: boolean;
};

/** Punctuation that ends a clause. A period also ends abbreviations, which only costs a missed match. */
const CLAUSE_BREAK = /[.!?;:,()[\]{}"„“”«»‹›–—]/u;

/** A hyphen joining two words with no space, which the segmenter splits apart. */
const JOINING_HYPHEN = /^[-\u2010\u2011]$/u;

/** A period inside an abbreviation (`т.д.`, `z. B.`): with no space, or one. */
const ABBREVIATION_PERIOD = /^\. ?$/u;

/**
 * A period between letters, where browsers' word segmenters split a word and
 * the server's (Bun's) doesn't: Chromium sends `т` for a click on `т.д.`, and
 * `lenta` for `lenta.ru`. Splitting here too keeps the context's words the
 * client's words.
 */
const INNER_PERIOD = /(?<=\p{L})\.(?=\p{L})/u;

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
  // A period inside a word (`comp.os.minix`, `т.д`) splits it, but ends no clause:
  // `kündigte es in comp.os.minix an` keeps its particle.
  const segments = [...segmenterFor(locale).segment(text)].flatMap(({ segment, isWordLike }) =>
    isWordLike && INNER_PERIOD.test(segment)
      ? segment.split(INNER_PERIOD).flatMap((piece, i) => [
          ...(i > 0 ? [{ segment: ".", isWordLike: false, inner: true }] : []),
          { segment: piece, isWordLike: true, inner: false },
        ])
      : [{ segment, isWordLike: isWordLike === true, inner: false }],
  );
  let innerOnly = true;
  for (const { segment, isWordLike, inner } of segments) {
    if (!isWordLike) {
      between += segment;
      innerOnly &&= inner;
      continue;
    }
    const breakBefore = tokens.length > 0 && !(innerOnly && between !== "") && CLAUSE_BREAK.test(between);
    if (breakBefore) clause++;
    tokens.push({
      key: lookupKey(segment),
      caseClass: caseClass(segment),
      clause,
      breakBefore,
      joinedBefore: tokens.length > 0 && JOINING_HYPHEN.test(between),
      dottedBefore: tokens.length > 0 && ABBREVIATION_PERIOD.test(between),
      commaBefore: tokens.length > 0 && between.trim() === ",",
    });
    between = "";
    innerOnly = true;
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
  /** The form can be a conjunction (`что`, `как`, `dass`). */
  readonly conjunction: boolean;
  /** The form can be a verb (`будет`, `могу`). */
  readonly verb: boolean;
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
         e.source_pos IN ('character', 'letter-name'),
         f.source <> ${FormSource.Lemma},
         f.source = ${FormSource.LetterVariant},
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
        conjunction: rows.some(
          (row) => row.pos === "SCONJ" || row.pos === "CCONJ",
        ),
        verb: rows.some((row) => row.pos === "VERB" || row.pos === "AUX"),
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
  /** Its verb may inflect and stand apart: a verb entry, or an untyped phrase with a verb. */
  readonly verb: boolean;
  /**
   * An entry is tagged as a verb. Only these follow the German bracket (the
   * rest ends the clause, the verb may come first), which untyped phrasebook
   * lines don't (`Wie heißen Sie eigentlich?`).
   */
  readonly verbEntry: boolean;
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
  // Wiktionary files many verb idioms as untyped phrases (`стелить соломку`,
  // `ihre Tage haben`), so a phrase with a verb's dictionary form counts as a
  // verb phrase too. Not proverbs, which are quoted, not inflected.
  const verbLemmas = new Set(
    db.$client
      .query<{ form: string }, []>(
        `SELECT DISTINCT f.form AS form FROM forms f JOIN entries e ON e.id = f.entry_id
         WHERE f.source = ${FormSource.Lemma} AND e.pos IN ('VERB', 'AUX')`,
      )
      .all()
      .map((row) => row.form),
  );
  const rows = db.$client
    .query<{ form: string; id: number; pos: UdPos; sourcePos: string }, []>(
      `SELECT f.form AS form, e.id AS id, e.pos AS pos, e.source_pos AS sourcePos FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE instr(f.form, ' ') > 0 AND instr(e.lemma, ' ') > 0 AND f.source <> ${FormSource.Abbreviation}
       ORDER BY f.form, e.id`,
    )
    .all();
  const byForm = new Map<
    string,
    {
      ids: Array<number>;
      verb: boolean;
      verbEntry: boolean;
      interjection: boolean;
    }
  >();
  for (const row of rows) {
    const phrase = byForm.get(row.form) ?? {
      ids: [],
      verb: false,
      verbEntry: false,
      interjection: true,
    };
    phrase.ids.push(row.id);
    phrase.verbEntry ||= row.pos === "VERB";
    phrase.verb ||=
      row.pos === "VERB" ||
      (row.pos === "X" &&
        row.sourcePos === "phrase" &&
        tokenize(row.form, locale).some((token) => verbLemmas.has(token.key)));
    phrase.interjection &&= row.pos === "INTJ";
    byForm.set(row.form, phrase);
  }
  const index = new Map<string, Array<Phrase>>();
  for (const [form, { ids, verb, verbEntry, interjection }] of byForm) {
    const tokens = tokenize(form, locale);
    if (tokens.length < 2) continue;
    const phrase: Phrase = {
      tokens: tokens.map((token) => token.key),
      breaks: tokens.map((token) => token.breakBefore),
      entryIds: ids,
      verb,
      verbEntry,
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

/**
 * Languages that write some words as hyphen-joined parts (`что-нибудь`,
 * `по-русски`, `какого-то`). The segmenter splits them, so with context the
 * parts are joined back into one word, and a phrase can't use only one part.
 */
const HYPHEN_WORDS: ReadonlySet<string> = new Set(["ru"]);

/** Reflexive pronouns a phrase's `sich` stands for. */
const REFLEXIVES: Readonly<Record<string, ReadonlySet<string>>> = {
  de: new Set(["sich", "mich", "dich", "uns", "euch", "mir", "dir"]),
};

/**
 * The particle that negates a verb, in languages where negation changes the
 * case of the verb's object: Russian and Polish put it in the genitive
 * (`иметь значение` → `не имеет значения`, `mieć znaczenie` → `nie ma
 * znaczenia`), so the phrase's own forms no longer match.
 */
const NEGATIONS: Readonly<Record<string, string>> = {
  ru: "не",
  pl: "nie",
};

type Matcher = {
  readonly tokens: ReadonlyArray<Token>;
  readonly info: (key: string, wordClass?: CaseClass) => TokenInfo;
  readonly reflexives: ReadonlySet<string> | undefined;
  /** Words allowed between a verb and the rest of its phrase (`MAX_GAPS`). */
  readonly maxGap: number;
  /** This language's verb negation (`NEGATIONS`). */
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
  /** Hyphen-joined parts are one word (`HYPHEN_WORDS`). */
  readonly hyphenWords: boolean;
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
        !endsClause(m.tokens, start + n - 1, false))
    ) {
      continue;
    }
    const last = phrase.tokens[n - 1]!;
    if (
      m.bracket &&
      phrase.verbEntry &&
      !m.info(last).verbLemma &&
      !endsClause(m.tokens, start + n - 1)
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
        (verbPlace > at[0]! || !endsClause(m.tokens, at.at(-1)!))
      ) {
        continue;
      }
      // Elsewhere only a few words come between (`miało to miejsce`,
      // `MAX_GAPS`), so `jest to się w dupie` isn't `być w dupie`.
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

/** Words allowed between a verb and the rest of its phrase, outside German. */
const MAX_GAP = 1;

/**
 * Languages that allow more (`MAX_GAP`). Russian often puts an object and an
 * adverb between the verb and the rest (`дашь мне честное слово`, `держать
 * все время ухо востро`); in Polish two words let in as many literal readings
 * as idioms (`jesteśmy u Mikołaja w domu` isn't `być w domu`).
 */
const MAX_GAPS: Readonly<Record<string, number>> = { ru: 2 };

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
    maxGap: MAX_GAPS[locale] ?? MAX_GAP,
    negation: NEGATIONS[locale],
    negated: false,
    bracket: BRACKET.has(locale),
    hyphenWords: HYPHEN_WORDS.has(locale),
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

/** Most spellings tried for one run of hyphen-joined parts. */
const MAX_SPELLINGS = 32;

/** Dictionary forms an affix must start or end, after a hyphen, to count as one. */
const MIN_HYPHEN_AFFIX_FORMS = 3;

const affixIndexes = new WeakMap<DictionaryDb, ReadonlySet<string>>();

/**
 * Affixes that attach with a hyphen (`-то`, `-нибудь`, `экс-`), read from the
 * dictionary's hyphenated forms: `-то` ends many (`кто-то`, `где-то`), while
 * the suffixes `-ак` and `-е` end none. Built once per file, on first use.
 */
const hyphenAffixes = (db: DictionaryDb): ReadonlySet<string> => {
  const cached = affixIndexes.get(db);
  if (cached !== undefined) return cached;
  const counts = new Map<string, number>();
  const rows = db.$client
    .query<{ form: string }, []>(
      "SELECT DISTINCT form FROM forms WHERE instr(form, '-') > 1",
    )
    .all();
  for (const { form } of rows) {
    const parts = form.split("-");
    if (parts.some((part) => part === "")) continue;
    for (const affix of [`${parts[0]}-`, `-${parts.at(-1)}`]) {
      counts.set(affix, (counts.get(affix) ?? 0) + 1);
    }
  }
  const affixes = new Set(
    [...counts].flatMap(([affix, n]) =>
      n >= MIN_HYPHEN_AFFIX_FORMS ? [affix] : [],
    ),
  );
  affixIndexes.set(db, affixes);
  return affixes;
};

type Rows = (key: string, wordClass?: CaseClass) => ReadonlyArray<FormRow>;

/**
 * Ways to write the hyphen-joined `parts` as a form: as written first, then
 * with parts replaced by their lemmas, for words that inflect inside but
 * whose inflected forms the dictionary lacks (`одним-единственным` for
 * `один-единственный`, `всех-всех` for `все-все`). The first readings of the
 * first parts are kept when there are more than `MAX_SPELLINGS`.
 */
const spellings = (
  rows: Rows,
  parts: ReadonlyArray<Token>,
): ReadonlyArray<string> => {
  let out: Array<Array<string>> = [[]];
  for (const part of parts) {
    const lemmas = rows(part.key)
      .map((row) => lookupKey(row.lemma))
      .filter((lemma) => !lemma.includes(" "));
    const readings = [...new Set([part.key, ...lemmas])];
    out = out
      .flatMap((prefix) => readings.map((reading) => [...prefix, reading]))
      .slice(0, MAX_SPELLINGS);
  }
  return out.map((words) => words.join("-"));
};

/**
 * Entry ids of the hyphen-joined word the context word at `clicked` is part
 * of (`first`..`last`): the longest run of its parts that is a form, around
 * the clicked part (`кого-нибудь` for `кто-нибудь`), as written or with its
 * parts as lemmas (`spellings`). With none, the clicked part's hyphen affix
 * (`-то`, `-ка`, `экс-`, see `hyphenAffixes`), so `сказал-то` still explains
 * `то`, but only beside dictionary words: `-е` in `environment-е` is an ending.
 * After a number, the part is an ending the grammar file explains (`-е` in
 * `1990-е`, `-го` in `3-го`), if it lists one.
 */
const hyphenWordIds = (
  db: DictionaryDb,
  rows: Rows,
  tokens: ReadonlyArray<Token>,
  first: number,
  last: number,
  clicked: number,
): ReadonlyArray<number> => {
  for (let length = last - first + 1; length >= 2; length--) {
    const from = Math.max(first, clicked - length + 1);
    const to = Math.min(clicked, last - length + 1);
    for (let start = from; start <= to; start++) {
      const parts = tokens.slice(start, start + length);
      for (const spelling of spellings(rows, parts)) {
        const found = rows(spelling, parts[0]!.caseClass);
        if (found.length > 0) return found.map((row) => row.id);
      }
    }
  }
  // An ending written after a number (`3-го`, `1990-х`): the grammar file's ending.
  if (clicked > first && /^\p{N}+$/u.test(tokens[clicked - 1]!.key)) {
    return grammarIds(db, `-${tokens[clicked]!.key}`);
  }
  const others = tokens
    .slice(first, last + 1)
    .filter((_, i) => first + i !== clicked);
  if (others.some((token) => rows(token.key).length === 0)) return [];
  const key = tokens[clicked]!.key;
  const affixes = hyphenAffixes(db);
  return [
    ...(clicked > first ? [`-${key}`] : []),
    ...(clicked < last ? [`${key}-`] : []),
  ]
    .filter((affix) => affixes.has(affix))
    .flatMap((affix) => {
      // The grammar file's endings are for numbers (`3-ой`), not for `о-ой`.
      const endings = new Set(grammarIds(db, affix));
      return rows(affix).flatMap((row) => (endings.has(row.id) ? [] : [row.id]));
    });
};

/**
 * Entry ids of the hyphen-joined word `word` is part of in `context`, in
 * languages that write words that way (`HYPHEN_WORDS`): `что` or `нибудь` in
 * `что-нибудь`. The client doesn't say which occurrence was clicked, so
 * every occurrence must be part of a hyphen-joined word that has entries:
 * not `восток` in `на восток и северо-восток`, nor `веб` in
 * `веб-разработчиков ... веб-сайтов`. Then each one's entries count
 * (`по-русски, по-немецки`).
 */
export const hyphenEntryIds = (
  db: DictionaryDb,
  word: string,
  context: string,
  locale: string,
): ReadonlyArray<number> => {
  if (!HYPHEN_WORDS.has(locale)) return [];
  const tokens = tokenize(context, locale);
  const cache = new Map<string, ReadonlyArray<FormRow>>();
  const rows: Rows = (key, wordClass = CaseClass.Capitalised) => {
    const cacheKey = `${wordClass}${key}`;
    let found = cache.get(cacheKey);
    if (found === undefined) {
      found = formRows(db, key, wordClass);
      cache.set(cacheKey, found);
    }
    return found;
  };
  const ids: Array<number> = [];
  for (const clicked of positionsOf(tokens, word, locale)) {
    let first = clicked;
    let last = clicked;
    while (tokens[first]!.joinedBefore) first--;
    while (tokens[last + 1]?.joinedBefore === true) last++;
    if (first === last) return [];
    const here = hyphenWordIds(db, rows, tokens, first, last, clicked);
    if (here.length === 0) return [];
    ids.push(...here);
  }
  return [...new Set(ids)];
};

/** Entry ids of the grammar file's lines for `form` (`-го`), and no others. */
const grammarIds = (db: DictionaryDb, form: string): ReadonlyArray<number> =>
  db.$client
    .query<{ id: number }, [string]>(
      `SELECT e.id AS id FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ?1 AND e.source_pos = '${GRAMMAR_SOURCE_POS}' ORDER BY e.id`,
    )
    .all(form)
    .map((row) => row.id);

/** Words that may stand before an abbreviation as part of it (`и т. д.`, `и т. п.`). */
const ABBREVIATION_LEADS: ReadonlySet<string> = new Set(["и"]);

/**
 * Ways to write the dotted run of `parts` as a form, longest first: with the
 * word before it when that can belong to it (`и т. д.`), then alone; spaced
 * and unspaced (both are indexed), with the final period and without.
 */
const abbreviationSpellings = (
  parts: ReadonlyArray<string>,
  lead: string | undefined,
): ReadonlyArray<string> =>
  [...(lead !== undefined ? [`${lead} `] : []), ""].flatMap((before) =>
    [". ", "."].flatMap((joiner) => {
      const run = parts.join(joiner);
      return [`${before}${run}.`, `${before}${run}`];
    }),
  );

/**
 * Entry ids of the abbreviation the context word `word` is a piece of, in
 * any language: `т` or `д` in `т.д.` (browsers send the piece alone),
 * `z` in `z.B.`. The pieces are the run of words joined by a period and at
 * most one space. As with hyphenated words, the client doesn't say which
 * occurrence was clicked, so every occurrence must be a piece of an
 * abbreviation the dictionary has.
 */
export const abbreviationEntryIds = (
  db: DictionaryDb,
  word: string,
  context: string,
  locale: string,
): ReadonlyArray<number> => {
  const tokens = tokenize(context, locale);
  const ids: Array<number> = [];
  for (const clicked of positionsOf(tokens, word, locale)) {
    let first = clicked;
    let last = clicked;
    while (tokens[first]!.dottedBefore) first--;
    while (tokens[last + 1]?.dottedBefore === true) last++;
    if (first === last) return [];
    // The longest run around the clicked piece that is a form: a period and a
    // space also end a sentence, so `т.д. лежали` holds `т. д.`.
    let found: ReadonlyArray<FormRow> | undefined;
    for (let length = last - first + 1; length >= 2 && found === undefined; length--) {
      for (let start = Math.max(first, clicked - length + 1); start <= Math.min(clicked, last - length + 1); start++) {
        const parts = tokens.slice(start, start + length).map((token) => token.key);
        const before = tokens[start - 1];
        const lead =
          before !== undefined && !tokens[start]!.dottedBefore && !tokens[start]!.breakBefore && ABBREVIATION_LEADS.has(before.key)
            ? before.key
            : undefined;
        found = abbreviationSpellings(parts, lead)
          .map((spelling) => formRows(db, lookupKey(spelling)))
          .find((rows) => rows.length > 0);
        if (found !== undefined) break;
      }
    }
    if (found === undefined) return [];
    // One entry per spelling written with or without spaces (`и т. д.`, `и т.д.`).
    const spellings = new Set<string>();
    for (const row of found) {
      const spelling = lookupKey(row.lemma).replace(/\s+/g, "");
      if (spellings.has(spelling)) continue;
      spellings.add(spelling);
      ids.push(row.id);
    }
  }
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
