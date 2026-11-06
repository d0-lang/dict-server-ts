import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import { lookupKey } from "@dict/core/lookupKey";
import { CaseClass } from "@dict/core/schema";
import { type FormRow, formRows, grammarIds } from "../common/forms.ts";
import { positionsOf, type Token, tokenize } from "../common/tokenize.ts";

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
      return rows(affix).flatMap((row) =>
        endings.has(row.id) ? [] : [row.id],
      );
    });
};

/**
 * Entry ids of the hyphen-joined word `word` is part of in `context`, in
 * languages that write words that way (`context.hyphenWords`): `что` or `нибудь` in
 * `что-нибудь`. Without `at`, the client doesn't say which occurrence was
 * clicked, so every occurrence must be part of a hyphen-joined word that has entries:
 * not `восток` in `на восток и северо-восток`, nor `веб` in
 * `веб-разработчиков ... веб-сайтов`. Then each one's entries count
 * (`по-русски, по-немецки`).
 */
export const hyphenEntryIds = (
  db: DictionaryDb,
  word: string,
  context: string,
  language: Language,
  at?: number,
): ReadonlyArray<number> => {
  if (!language.context.hyphenWords) return [];
  const locale = language.code;
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
  for (const clicked of positionsOf(tokens, word, locale, { context, at })) {
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
