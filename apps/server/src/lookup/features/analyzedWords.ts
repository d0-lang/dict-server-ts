import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import { lookupKey } from "@dict/core/lookupKey";
import { FormSource } from "@dict/core/schema";
import { analyzerFor, type Morpheme } from "../common/analyzer.ts";
import { type FormRow, formRows, grammarIds } from "../common/forms.ts";
import {
  loadEntries,
  type LookupEntry,
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
 *
 * `match` is the protocol's: only on entries the sentence adds, and always a
 * run that holds the clicked piece and more. A piece the analyzer reads as
 * several words (`よ|ね`), or that is cut across them (`たん` of
 * `なかった|ん`), is answered by those words as parts, not by the first of
 * them alone.
 */

/** Parts of speech that take endings, so a word with endings keeps only these entries. */
const INFLECTING = new Set(["VERB", "ADJ", "AUX"]);

/**
 * UD's open classes: content words. A morpheme the language maps to none of
 * them (a particle, an auxiliary, a conjunction) is a function word.
 */
const CONTENT = new Set(["NOUN", "PROPN", "VERB", "ADJ", "ADV", "INTJ"]);

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

/** A written piece of the answer with its entries' ids. `main`: it holds the click, so its entries rank first. */
type Part = {
  readonly text: string;
  readonly ids: ReadonlyArray<number>;
  readonly main?: boolean;
};

/**
 * A result of entries for the whole run, then each part's: the main parts'
 * first, then the others' as written. `match` names the run the parts spell,
 * when it is more than the clicked word: on the whole run's entries, as the
 * protocol asks of the first entry. With none of those, on the entries of the
 * part shown first, all of them: entries with one headword are merged only
 * when their `match` is the same (`presentResult`).
 */
const splitResult = (
  db: DictionaryDb,
  whole: ReadonlyArray<LookupEntry>,
  parts: ReadonlyArray<Part>,
  match: Pick<LookupEntry, "match">,
): LookupResult => {
  const ranked = [
    ...parts.filter((part) => part.main === true),
    ...parts.filter((part) => part.main !== true),
  ];
  const from = new Map<Part, number>();
  let next = whole.length;
  for (const part of ranked) {
    from.set(part, next);
    next += part.ids.length;
  }
  const first =
    whole.length === 0 ? ranked.find((part) => part.ids.length > 0) : undefined;
  return {
    entries: [
      ...whole.map((entry) => ({ ...entry, ...match })),
      ...ranked.flatMap((part) =>
        loadEntries(db, part.ids).map((entry) =>
          part === first ? { ...entry, ...match } : entry,
        ),
      ),
    ],
    segments: parts.map((part): Segment =>
      part.ids.length > 0
        ? {
            text: part.text,
            entries: part.ids.map((_, k) => from.get(part)! + k),
          }
        : { text: part.text },
    ),
  };
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
  const textOf = (w: ReadonlyArray<Morpheme>) =>
    context.slice(startOf(w), endOf(w));
  const text = textOf(found);
  // The piece runs past the word on either side (`たより` for `より`): it
  // touches other words too.
  const touched = words.filter((w) => overlap(w) > 0);
  const wider = touched.length > 1;
  /**
   * `match` for entries the sentence adds: the run of `context` they cover,
   * when it holds the clicked word and more. The word's own entries get none,
   * and neither does a lookup without a sentence, where the word is all
   * there is.
   */
  const matchOf = (start: number, end: number): Pick<LookupEntry, "match"> => {
    const run = context.slice(start, end);
    return start <= piece.start &&
      end >= piece.end &&
      run !== word &&
      run.includes(word)
      ? { match: [run] }
      : {};
  };

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
      // The phrase holds the clicked piece from its start on (not `より…`
      // for `たより`, which starts in the word before).
      if (start > piece.start) continue;
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
        // Each underlines what it covers, when that is more than the clicked
        // word: the phrase (`手に入る` for `入る`), and the word around the
        // piece (`しれないです` for `れ`). The clicked word's own entries
        // (`入る`) underline nothing.
        const phraseMatch = matchOf(start, start + written.length);
        const ownMatch = matchOf(startOf(found), endOf(found));
        return {
          entries: [
            ...loadEntries(db, phraseIds).map((entry) => ({
              ...entry,
              ...phraseMatch,
            })),
            ...loadEntries(
              db,
              own.filter((id) => !phraseIds.includes(id)),
            ).map((entry) => ({ ...entry, ...ownMatch })),
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
  // So does a piece of content words alone that the dictionary has as a
  // word, cut only because of what stands around it: a compound after a
  // number or a prefix (`年代` in `2000年|代`, `日本語` in `非日本|語`), a
  // filler cut into syllables (`ま|あ`). No particle or auxiliary is in it,
  // which stand next to any word (`とも` is `と|も`, `すると` is `する|と`).
  // It ends where a word ends, so no ending is cut off (not `外出` in
  // `外|出たい`), and its entry has the part of speech of its last morpheme,
  // which makes the compound's (not `となり` "neighbour" for `と|なり`).
  const inside = touched
    .flat()
    .filter((m) => m.start < piece.end && m.end > piece.start);
  const functionWord = (m: Morpheme) => {
    const tags = [...uposOf(m)];
    return tags.length > 0 && !tags.some((tag) => CONTENT.has(tag));
  };
  if (
    wider &&
    inside[0]!.start === piece.start &&
    endOf(touched.at(-1)!) === piece.end &&
    !inside.some(functionWord) &&
    rows(word).some(
      (row) =>
        row.source === FormSource.Lemma &&
        lookupKey(row.lemma) === lookupKey(word) &&
        uposOf(inside.at(-1)!).has(row.pos),
    )
  ) {
    return undefined;
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
  const derivedWord = (w: ReadonlyArray<Morpheme>): boolean =>
    rows(textOf(w)).length === 0 &&
    w.some((m) => hasPos(m.pos, settings.suffixes));
  // Each morpheme a part: an ending by its grammar-file line, else by its base
  // forms (`し` -> `する`); the head also by its spelling (`勉強` the noun).
  // Entries already `shown` for the whole word are left out.
  const morphemeParts = (
    w: ReadonlyArray<Morpheme>,
    shown: ReadonlySet<number>,
  ): ReadonlyArray<Part> =>
    w.map((morpheme, i) => {
      const grammar = morpheme.bases.flatMap((base) => grammarIds(db, base));
      const isHead =
        i === w.findIndex((m) => !hasPos(m.pos, settings.prefixes));
      const forms = isHead
        ? [morpheme.surface, ...morpheme.bases]
        : morpheme.bases;
      const bases = new Set(
        [morpheme.surface, ...morpheme.bases].map(lookupKey),
      );
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
      return {
        text: morpheme.surface,
        ids: [...new Set(ids)].filter((id) => !shown.has(id)),
      };
    });

  // A piece that is several words (`よ|ね`, `年|前`, `明治|天皇`), or is cut
  // across them (`たん` of `なかった|ん`, `すか` of `あります|か`): each word
  // it touches is a part with its own entries, the one that holds most of the
  // piece first. The parts spell the run of those words, which is the `match`
  // when it is more than the piece. What the dictionary has for the piece
  // itself was not taken above, and is left out (`委員` for `いいん`), unless
  // it has nothing for the word that holds most of the piece: then the
  // analyzer's cut is no better, and the plain lookup answers (`でも` in
  // `横ばえで|も`, `ちゃんと` in `スマホちゃん|と`).
  if (wider) {
    const known = !derivedWord(found) && wholeIds(found, text).length > 0;
    if (!known && rows(word).length > 0) return undefined;
    const parts = touched.flatMap((w): ReadonlyArray<Part> => {
      if (!derivedWord(w)) {
        return [
          { text: textOf(w), ids: wholeIds(w, textOf(w)), main: w === found },
        ];
      }
      // Of a word shown by its parts, the ones inside the piece come first
      // (`上` of `保全|上` for `上の`).
      return morphemeParts(w, new Set()).map((part, i) => ({
        ...part,
        main: w === found && w[i]!.start < piece.end && w[i]!.end > piece.start,
      }));
    });
    if (parts.every((part) => part.ids.length === 0)) return undefined;
    return splitResult(
      db,
      [],
      parts,
      matchOf(startOf(touched[0]!), endOf(touched.at(-1)!)),
    );
  }

  // The word around the piece (`食べました` for `食`), or the piece itself
  // read as several morphemes (`新|幹線`): its own entries, underlining it
  // when it is more than the piece, then each morpheme as a part.
  const derived = derivedWord(found);
  const whole = derived ? [] : wholeIds(found, text);
  // Without the word's own entries there is nothing to show it by.
  if (whole.length === 0 && !derived) return undefined;
  const match = matchOf(startOf(found), endOf(found));
  const wholeEntries = loadEntries(db, whole);
  if (found.length === 1) {
    return derived
      ? undefined
      : { entries: wholeEntries.map((entry) => ({ ...entry, ...match })) };
  }
  const parts = morphemeParts(found, new Set(whole));
  if (derived && parts.every((part) => part.ids.length === 0)) {
    return undefined;
  }
  return splitResult(db, wholeEntries, parts, match);
};
