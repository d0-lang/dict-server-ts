import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import { lookupKey } from "@dict/core/lookupKey";
import { FormSource } from "@dict/core/schema";
import { analyzerFor, type Morpheme } from "../common/analyzer.ts";
import { type FormRow, formRows, grammarIds } from "../common/forms.ts";
import {
  loadEntries,
  type LookupResult,
  type Segment,
} from "../common/entries.ts";
import { positionsOf, tokenize } from "../common/tokenize.ts";

/**
 * Words found by a morphological analyzer (`context.analyzer`), for a script
 * without spaces. The segmenter, client's and server's alike, cuts inflected
 * words short (`食|べ|ま|した`), so a click on `食` would show "food". With the
 * sentence, the analyzer cuts it into morphemes with their base forms, the
 * language's `join` rules make words of them (`食べ` + `まし` + `た`), and the
 * lookup returns the word around the clicked piece as `match`: its entries
 * first (`食べる`, by the head's base form), then each morpheme as a part
 * (`segments`), an ending by its grammar-file line (`ます`, `た`). A phrase the
 * dictionary lists over several words (`手に入る`, `かもしれない`) comes first.
 */

/** Parts of speech that take endings, so a word with endings keeps only these entries. */
const INFLECTING = new Set(["VERB", "ADJ", "AUX"]);

/** Most words a phrase may span. */
const MAX_PHRASE_WORDS = 4;

type Settings = NonNullable<Language["context"]["analyzer"]>;
type Rule = Settings["join"][number];

/** `pos` is one of `tags` or starts with one and a `-`. */
const hasPos = (pos: string, tags: ReadonlyArray<string>): boolean =>
  tags.some((tag) => pos === tag || pos.startsWith(`${tag}-`));

const joins = (rule: Rule, morpheme: Morpheme, before: Morpheme): boolean =>
  hasPos(morpheme.pos, rule.pos) &&
  (rule.surface === undefined || rule.surface.includes(morpheme.surface)) &&
  (rule.base === undefined ||
    morpheme.bases.some((base) => rule.base!.includes(base))) &&
  (rule.after === undefined
    ? /\p{L}/u.test(before.surface)
    : hasPos(before.pos, rule.after)) &&
  (rule.afterSurface === undefined ||
    rule.afterSurface.includes(before.surface));

/** The morphemes as words: each joined to the word before it when a rule says so. */
export const wordsOf = (
  morphemes: ReadonlyArray<Morpheme>,
  settings: Settings,
): ReadonlyArray<ReadonlyArray<Morpheme>> => {
  const words: Array<Array<Morpheme>> = [];
  let prefixes: Array<Morpheme> = [];
  for (const morpheme of morphemes) {
    const word = words.at(-1);
    const before = word?.at(-1);
    if (
      prefixes.length === 0 &&
      before !== undefined &&
      before.end === morpheme.start &&
      settings.join.some((rule) => joins(rule, morpheme, before))
    ) {
      word!.push(morpheme);
    } else if (hasPos(morpheme.pos, settings.prefixes)) {
      prefixes.push(morpheme);
    } else if (!/\p{L}/u.test(morpheme.surface)) {
      // A prefix joins a word, not a number (`約` + `30`) or a sign.
      for (const prefix of prefixes) words.push([prefix]);
      prefixes = [];
      words.push([morpheme]);
    } else {
      words.push([...prefixes, morpheme]);
      prefixes = [];
    }
  }
  for (const prefix of prefixes) words.push([prefix]);
  return words;
};

/**
 * The lookup of `word` as part of the word the analyzer finds around it in
 * `context`, or undefined when that word is just `word` (or the click can't be
 * placed): then the plain lookup answers.
 */
export const analyzedLookup = (
  db: DictionaryDb,
  word: string,
  context: string,
  language: Language,
  at?: number,
): LookupResult | undefined => {
  const settings = language.context.analyzer;
  const analyze = analyzerFor(language);
  if (settings === undefined || analyze === undefined) return undefined;
  const tokens = tokenize(context, language.code);
  const clicked = positionsOf(tokens, word, language.code, { context, at });
  if (clicked.length !== 1) return undefined;
  const piece = tokens[clicked[0]!]!;
  // A word in Latin letters alone (`JOC`, `Don`) is no word of this
  // language. A unit after a number is (`28g`: the analyzer reads `グラム`).
  if (/^[\p{Script=Latin}\p{P}]+$/u.test(word)) return undefined;

  const words = wordsOf(analyze(context), settings);
  const startOf = (w: ReadonlyArray<Morpheme>) => w[0]!.start;
  const endOf = (w: ReadonlyArray<Morpheme>) => w.at(-1)!.end;
  // The word the piece starts with, when it starts one (`に` of `における`,
  // `東` of `東日本`). A piece that starts inside a word is cut off from it
  // (`思っ|たより`): then the word holding most of the piece, the first on a
  // tie (`より`; `あります` of `ありま|すか`).
  const overlap = (w: ReadonlyArray<Morpheme>) =>
    Math.min(endOf(w), piece.end) - Math.max(startOf(w), piece.start);
  let index = words.findIndex((w) => startOf(w) === piece.start);
  if (index < 0) {
    words.forEach((w, i) => {
      if (
        overlap(w) > 0 &&
        (index < 0 || overlap(w) > overlap(words[index]!))
      ) {
        index = i;
      }
    });
  }
  if (index < 0) return undefined;
  const found = words[index]!;
  const text = context.slice(startOf(found), endOf(found));
  // The piece runs past the word on either side (`たより` for `より`).
  const wider = piece.start < startOf(found) || piece.end > endOf(found);

  const cache = new Map<string, ReadonlyArray<FormRow>>();
  const rows = (form: string): ReadonlyArray<FormRow> => {
    const key = lookupKey(form);
    let result = cache.get(key);
    if (result === undefined) {
      result = formRows(db, key);
      cache.set(key, result);
    }
    return result;
  };
  /** The UD parts of speech the language maps the morpheme's tags to. */
  const uposOf = (m: Morpheme): ReadonlySet<string> =>
    new Set(
      Object.entries(settings.upos).flatMap(([tag, tags]) =>
        hasPos(m.pos, [tag]) ? tags : [],
      ),
    );
  // A word's head: its first morpheme that is no prefix and has letters
  // (`日` in `2|7|日`, `勉強` in `お|勉強`).
  const headOf = (w: ReadonlyArray<Morpheme>): Morpheme =>
    w.find(
      (m) => !hasPos(m.pos, settings.prefixes) && /\p{L}/u.test(m.surface),
    ) ??
    w.find((m) => !hasPos(m.pos, settings.prefixes)) ??
    w[0]!;
  // An entry whose lemma is itself several words: a phrase.
  const severalWords = (row: FormRow) =>
    wordsOf(analyze(row.lemma), settings).length > 1;
  // A phrase over several words around this one, longest first: an entry
  // whose lemma is itself several words (`手に入る`, `かも知れない`; not
  // `似合う` for `に|あわせて`). It may end inside its last word
  // (`かもしれない` in `か|も|しれないです`), or be written with that word's
  // base form (`手に入れ|た` -> `手に入れる`). It is tried before the
  // segmenter's own piece: `によると` before `による`.
  for (let size = MAX_PHRASE_WORDS; size >= 2; size--) {
    for (let first = Math.max(0, index - size + 1); first <= index; first++) {
      const span = words.slice(first, first + size);
      if (span.length < size) continue;
      const gaps = span.some(
        (w, i) => i > 0 && startOf(w) !== endOf(span[i - 1]!),
      );
      if (gaps) continue;
      const start = startOf(span[0]!);
      const last = span.at(-1)!;
      const head = headOf(last);
      const forms: Array<{ form: string; written: string }> = [];
      // Spelled as written, and with each morpheme spelled its lemma's way
      // (`かもしれない` -> `かも知れない`, `手にいれ` -> `手に入れ`).
      const morphemes = span.flat();
      const respelled = (upTo: number) =>
        morphemes
          .slice(0, upTo)
          .map((m) => m.spellings.at(-1)!)
          .join("");
      for (let k = last.length; k >= 1; k--) {
        const end = last[k - 1]!.end;
        // The phrase holds the whole clicked piece (`による` in `に|よる|と`).
        if (end < piece.end) break;
        const written = context.slice(start, end);
        const upTo = morphemes.indexOf(last[k - 1]!) + 1;
        forms.push(
          { form: written, written },
          { form: respelled(upTo), written },
        );
        if (k === last.length) {
          const before = morphemes.indexOf(head);
          for (const base of head.bases) {
            forms.push(
              { form: context.slice(start, head.start) + base, written },
              { form: respelled(before) + base, written },
            );
          }
        }
      }
      for (const { form, written } of forms) {
        const phrase = rows(form).filter(severalWords);
        if (phrase.length === 0) continue;
        // The phrase is just the clicked piece (`日本語`, `日本|語` to the
        // analyzer): the plain lookup answers, if it has the piece.
        if (written === word && rows(word).length > 0) return undefined;
        const phraseIds = [...new Set(phrase.map((row) => row.id))];
        const own = wholeIds(found, text);
        return {
          entries: [
            ...loadEntries(db, phraseIds).map((entry) => ({
              ...entry,
              match: [written],
            })),
            ...loadEntries(
              db,
              own.filter((id) => !phraseIds.includes(id)),
            ).map((entry) => ({ ...entry, match: [text] })),
          ],
        };
      }
    }
  }
  // A piece that starts a word and runs on past it, with no phrase above
  // that holds it, is a phrase the segmenter knows (`そうですね`): the plain
  // lookup answers it, if the dictionary has it as a phrase spelled so. Not a one-word entry (`いいん`, read as `委員`
  // "committee member", in `いい|ん|だ`), nor a redirect (`よね` to `米`
  // "rice", for `よ` + `ね`).
  if (
    wider &&
    piece.start === startOf(found) &&
    rows(word).some(
      (row) => row.source !== FormSource.Redirect && severalWords(row),
    )
  ) {
    return undefined;
  }

  // A piece over several words with no entry of its own, a compound
  // (`年|前`, `明治|天皇`, `南|関東`): what each word has inside the piece as
  // a part with its own entries, as a compound written as one word. The
  // piece starts and ends between morphemes (`2900年` gives `年`).
  const inPiece = words
    .map((w) => w.filter((m) => m.start >= piece.start && m.end <= piece.end))
    .filter((w) => w.length > 0);
  if (
    inPiece.length > 1 &&
    startOf(inPiece[0]!) === piece.start &&
    endOf(inPiece.at(-1)!) === piece.end &&
    rows(word).length === 0
  ) {
    const partIds = inPiece.map((w) => [
      ...new Set(wholeIds(w, context.slice(startOf(w), endOf(w)))),
    ]);
    if (partIds.some((ids) => ids.length > 0)) {
      let next = 0;
      const segments = inPiece.map((w, i): Segment => {
        const text = context.slice(startOf(w), endOf(w));
        const count = partIds[i]!.length;
        const indexes = Array.from({ length: count }, (_, k) => next + k);
        next += count;
        return count > 0 ? { text, entries: indexes } : { text };
      });
      return {
        entries: partIds.flatMap((ids) => loadEntries(db, ids)),
        segments,
      };
    }
  }

  // The clicked piece is the word: the plain lookup answers, unless its top
  // entry is only redirected there, as an obscure word written alike (`みる`
  // to `海松` "seaweed"). Then the analyzer's lemma comes first (`見る`), with
  // nothing underlined.
  if (found.length === 1 && text === word) {
    // A word written in kana whose lemma the analyzer writes in kanji, as a
    // part of speech none of its own entries has (`もの` the noun is `物`,
    // and `もの` has only particle entries): that lemma's entries of that
    // part of speech first. Not `ちょっと`, an adverb with an adverb entry,
    // before `一寸`, a unit of length.
    const lemma = found[0]!.bases.at(-1);
    const upos = uposOf(found[0]!);
    const own =
      lemma !== undefined &&
      upos.size > 0 &&
      /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(word) &&
      /\p{Script=Han}/u.test(lemma) &&
      !rows(word).some((row) => upos.has(row.pos))
        ? rows(lemma).filter(
            (row) =>
              lookupKey(row.lemma) === lookupKey(lemma) && upos.has(row.pos),
          )
        : [];
    if (own.length > 0) {
      const ids = [...new Set(own.map((row) => row.id))];
      const rest = rows(word)
        .map((row) => row.id)
        .filter((id) => !ids.includes(id));
      return { entries: loadEntries(db, [...ids, ...new Set(rest)]) };
    }
    // Nothing for the word as written (`暗く`): its base form's entries
    // (`暗い`). A top entry only redirected there: the lemma's entries first
    // (`所` for `とこ`, before `常` and `床`).
    if (
      rows(word).length > 0 &&
      rows(word)[0]!.source !== FormSource.Redirect
    ) {
      return undefined;
    }
    const byLemma =
      lemma === undefined
        ? []
        : rows(lemma)
            .filter((row) => lookupKey(row.lemma) === lookupKey(lemma))
            .map((row) => row.id);
    const ranked = byLemma.length > 0 ? byLemma : wholeIds(found, text);
    if (ranked.length === 0 || ranked[0] === rows(word)[0]?.id) {
      return undefined;
    }
    const rest = rows(word)
      .map((row) => row.id)
      .filter((id) => !ranked.includes(id));
    return { entries: loadEntries(db, [...ranked, ...new Set(rest)]) };
  }

  /** The word's own entries: its form as written, else its head's base forms (`勉強` for `勉強しています`). */
  function wholeIds(
    w: ReadonlyArray<Morpheme>,
    written: string,
  ): ReadonlyArray<number> {
    const head = headOf(w);
    const prefix = context.slice(startOf(w), head.start);
    const candidates = [
      written,
      ...head.bases.flatMap((base) =>
        prefix === "" ? [base] : [prefix + base, base],
      ),
    ];
    const inflected = w.length > 1 && w.at(-1) !== head;
    for (const form of candidates) {
      const found = rows(form);
      if (found.length === 0) continue;
      const inflecting = found.filter((row) => INFLECTING.has(row.pos));
      const kept = inflected && inflecting.length > 0 ? inflecting : found;
      // The base form's own entry before entries that only name the form (`行った` "past of 行く").
      // The base forms' own entries first, the last named first: it is the
      // most specific (UniDic's lemma `要る` against the written `いる`, which
      // is also `居る`). Entries that only name the form follow (`行った`
      // "past of 行く").
      const priority = (row: FormRow) => {
        const at = head.bases.map(lookupKey).lastIndexOf(lookupKey(row.lemma));
        return at < 0 ? head.bases.length : head.bases.length - 1 - at;
      };
      const ranked = [...kept].sort((a, b) => priority(a) - priority(b));
      return [...new Set(ranked.map((row) => row.id))];
    }
    return [];
  }

  // A word made with a suffix (`機械|屋` "mechanic") is not the word before
  // the suffix (`機械` "machine"). Without an entry of its own, it has no
  // entries as a whole: each part shows its own.
  const derived =
    rows(text).length === 0 &&
    found.some((m) => hasPos(m.pos, settings.suffixes));
  const whole = derived ? [] : wholeIds(found, text);
  // Without the word's own entries there is nothing to underline it with.
  if (whole.length === 0 && !derived) return undefined;
  const shown = new Set(whole);
  const match = [text];
  const wholeEntries = loadEntries(db, whole).map((entry) => ({
    ...entry,
    match,
  }));
  // A piece wider than the word can't be split by the word's parts.
  if (found.length === 1 || wider) {
    return derived ? undefined : { entries: wholeEntries };
  }

  // Each morpheme a part: an ending by its grammar-file line, else by its base
  // forms (`し` -> `する`); the head also by its spelling (`勉強` the noun).
  const partIds = found.map((morpheme, i) => {
    const grammar = morpheme.bases.flatMap((base) => grammarIds(db, base));
    const isHead =
      i === found.findIndex((m) => !hasPos(m.pos, settings.prefixes));
    const forms = isHead
      ? [morpheme.surface, ...morpheme.bases]
      : morpheme.bases;
    const bases = new Set([morpheme.surface, ...morpheme.bases].map(lookupKey));
    // Entries of the part's own lemma; else what its base forms find, for a
    // lemma the dictionary writes otherwise (`欲しい` under `ほしい`).
    const byLemma = forms.flatMap((form) =>
      rows(form).filter((row) => bases.has(lookupKey(row.lemma))),
    );
    // Only when they find one lemma: `とく` (casual `ておく`) would bring
    // `解く`, `説く` and `得`.
    const byBase = morpheme.bases.flatMap((base) => rows(base));
    const own =
      byLemma.length > 0
        ? byLemma
        : new Set(byBase.map((row) => lookupKey(row.lemma))).size === 1
          ? byBase
          : [];
    const ids =
      !isHead && grammar.length > 0 ? grammar : own.map((row) => row.id);
    return [...new Set(ids)].filter((id) => !shown.has(id));
  });
  let next = whole.length;
  const segments = found.map((morpheme, i): Segment => {
    const count = partIds[i]!.length;
    const indexes = Array.from({ length: count }, (_, k) => next + k);
    next += count;
    return count > 0
      ? { text: morpheme.surface, entries: indexes }
      : { text: morpheme.surface };
  });
  const partEntries = partIds.flatMap((ids) => loadEntries(db, ids));
  if (derived) {
    if (partEntries.length === 0) return undefined;
    // The first entry's `match` names the word the parts split.
    const [first, ...rest] = partEntries;
    return { entries: [{ ...first!, match }, ...rest], segments };
  }
  return { entries: [...wholeEntries, ...partEntries], segments };
};
