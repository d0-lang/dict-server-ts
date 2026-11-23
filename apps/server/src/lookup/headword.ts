import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { hiragana } from "@dict/core/kana";
import {
  FEATURE_LABELS,
  FEATURES,
  parseFeatures,
  type FeatureName,
  type Features,
} from "@dict/core/features";
import type { Language } from "@dict/core/language";
import { cleanWord, lookupKey } from "@dict/core/lookupKey";
import { FormSource } from "@dict/core/schema";
import type { Audio, LookupEntry, LookupResult } from "./common/entries.ts";
import { wiktionaryPageUrl } from "./common/sources.ts";
import { inScriptOrder, withOtherSpellings } from "./scripts.ts";

/**
 * The headword a reader sees: the lemma as a learner's dictionary prints it
 * (with its article, for a language that has `headword.articles`) and its
 * grammar as `labels`. Entries with the same headword are one entry in the
 * protocol, so they are merged here, however the source split them.
 */

/** What an entry shows as its headword. */
export type Headword = {
  readonly lemma: string;
  readonly labels: ReadonlyArray<string>;
};

const valuesIn = (features: Features, name: FeatureName) =>
  (FEATURES[name] as ReadonlyArray<string>).filter(
    (value) => features[name]?.includes(value) === true,
  );

/** The article(s) a noun's lemma starts with (`der/das`), or undefined. */
const articleOf = (
  articles: NonNullable<Language["headword"]["articles"]>,
  features: Features,
): string | undefined => {
  if (
    features.Number?.includes("Ptan") === true &&
    articles.Ptan !== undefined
  ) {
    return articles.Ptan;
  }
  const genders = valuesIn(features, "Gender").flatMap((gender) => {
    const article = articles[gender as keyof typeof articles];
    return article === undefined ? [] : [article];
  });
  return genders.length > 0 ? [...new Set(genders)].join("/") : undefined;
};

export const headwordOf = (
  language: Language,
  lemma: string,
  pos: string,
  featureText: string | null | undefined,
): Headword => {
  const features = parseFeatures(featureText);
  const { articles, labels } = language.headword;
  // A lemma may already start with one (`die Alten`, `der wahre Jakob`).
  const hasArticle =
    articles !== undefined &&
    Object.values(articles).some((a) => lemma.startsWith(`${a} `));
  const article =
    articles !== undefined && pos === "NOUN" && !hasArticle
      ? articleOf(articles, features)
      : undefined;
  // An article shows the gender, and for plural-only nouns their number.
  const shown = labels.filter(
    (name) => article === undefined || (name !== "Gender" && name !== "Number"),
  );
  return {
    lemma: article === undefined ? lemma : `${article} ${lemma}`,
    labels: shown.flatMap((name) => {
      const values = valuesIn(features, name);
      return values.length > 0
        ? [values.map((value) => FEATURE_LABELS[value] ?? value).join("/")]
        : [];
    }),
  };
};

/**
 * The headwords a `see` word stands for: those of its entries, of `pos`
 * first. A word with two headwords (`der See`, `die See`) gives both.
 */
const seeHeadwords = (
  db: DictionaryDb,
  language: Language,
  word: string,
  pos: string,
): ReadonlyArray<string> => {
  const key = lookupKey(word);
  const rows = db.$client
    .query<
      { lemma: string; pos: string; features: string | null },
      [string, number]
    >(
      `SELECT e.lemma, e.pos, e.features FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ?1 AND f.source = ?2 ORDER BY e.id`,
    )
    .all(key, FormSource.Lemma)
    .filter((row) => lookupKey(row.lemma) === key);
  const samePos = rows.filter((row) => row.pos === pos);
  const heads = (samePos.length > 0 ? samePos : rows).map(
    (row) => headwordOf(language, row.lemma, row.pos, row.features).lemma,
  );
  return heads.length > 0 ? [...new Set(heads)] : [word];
};

const unique = (values: ReadonlyArray<string>) => [...new Set(values)];

/**
 * `result` as the protocol sends it: each entry with its headword and labels,
 * `see` words written as their targets' headwords, and entries that share a
 * headword (and segment) merged in the order they first appear.
 */
/** What the reader clicked: the word and its sentence, if sent. */
export type ClickedText = {
  readonly word: string;
  readonly context?: string;
};

export const presentResult = (
  db: DictionaryDb,
  language: Language,
  result: LookupResult,
  clicked?: ClickedText,
): LookupResult => {
  const segmentOf = new Map<number, number>();
  result.segments?.forEach((segment, s) =>
    segment.entries?.forEach((i) => segmentOf.set(i, s)),
  );
  const merged: Array<{
    lemma: string;
    pos: LookupEntry["pos"];
    labels: ReadonlyArray<string>;
    match: ReadonlyArray<string> | undefined;
    ipa: Array<string>;
    audio: Array<Audio>;
    reading: string | undefined;
    senses: Array<LookupEntry["senses"][number]>;
    sources: Array<string>;
  }> = [];
  /** The merged entries with each headword, readings aside, in order. */
  const withKey = new Map<string, Array<number>>();
  const newIndex = new Map<number, number>();
  const spelled = result.entries.map((entry, i) => {
    const segment = segmentOf.get(i);
    return language.headword.otherSpellings
      ? withOtherSpellings(db, entry.lemma, [
          ...(entry.match ?? []),
          ...(segment !== undefined ? [result.segments![segment]!.text] : []),
          ...(clicked !== undefined ? [clicked.word] : []),
          ...(clicked?.context !== undefined ? [clicked.context] : []),
        ])
      : { lemma: entry.lemma, otherScript: undefined, used: entry.lemma };
  });
  const order = language.headword.otherSpellings
    ? inScriptOrder(
        db,
        [clicked?.context ?? clicked?.word ?? ""].join(""),
        result.entries.map((entry, i) => ({
          group: JSON.stringify([segmentOf.get(i), entry.match]),
          otherScript: spelled[i]!.otherScript,
          used: spelled[i]!.used,
          lemma: entry.lemma,
        })),
      )
    : result.entries.map((_, i) => i);
  for (const i of order) {
    const entry = result.entries[i]!;
    const segment = segmentOf.get(i);
    const lemma = spelled[i]!.lemma;
    const grammar = headwordOf(language, lemma, entry.pos, entry.features);
    // Labels the lookup added stay after the grammar's (`て form`).
    const head = {
      ...grammar,
      labels: unique([...grammar.labels, ...(entry.labels ?? [])]),
    };
    // A context entry stays apart from an own entry with the same headword.
    const key = JSON.stringify([
      head.lemma,
      entry.pos,
      head.labels,
      segment,
      entry.match,
    ]);
    // A different reading is a different headword (`人前` as ひとまえ "the
    // public" and as にんまえ "portion of food"). An entry without one joins
    // the first with that headword, whatever its reading: it names none of
    // its own, and the first is the likeliest. An entry with one joins the
    // one with the same reading, else the first that has none yet.
    // Katakana and hiragana spell the same reading (`三` as サン and さん).
    const reading = entry.pron?.reading;
    const same = withKey.get(key) ?? [];
    let at =
      reading === undefined
        ? same[0]
        : (same.find(
            (m) =>
              merged[m]!.reading !== undefined &&
              hiragana(merged[m]!.reading!) === hiragana(reading),
          ) ?? same.find((m) => merged[m]!.reading === undefined));
    if (at === undefined) {
      at = merged.length;
      withKey.set(key, [...same, at]);
      merged.push({
        lemma: head.lemma,
        pos: entry.pos,
        labels: head.labels,
        match: entry.match,
        ipa: [],
        audio: [],
        reading: undefined,
        senses: [],
        sources: [],
      });
    }
    newIndex.set(i, at);
    const target = merged[at]!;
    target.ipa = unique([...target.ipa, ...(entry.pron?.ipa ?? [])]);
    for (const audio of entry.pron?.audio ?? []) {
      if (!target.audio.some((other) => other.url === audio.url)) {
        target.audio.push(audio);
      }
    }
    target.sources = unique([
      ...target.sources,
      ...(entry.sources ?? []),
      ...(entry.pages ?? []).map((title) =>
        wiktionaryPageUrl(title, language.name),
      ),
    ]);
    target.reading ??= entry.pron?.reading;
    target.senses.push(
      ...entry.senses.map((sense) =>
        sense.see === undefined
          ? sense
          : {
              ...sense,
              see: unique(
                sense.see.flatMap((word) =>
                  seeHeadwords(db, language, word, entry.pos),
                ),
              ),
            },
      ),
    );
  }

  const entries: Array<LookupEntry> = merged.map((entry) => {
    const pron = {
      ...(entry.ipa.length > 0 ? { ipa: entry.ipa } : {}),
      ...(entry.audio.length > 0 ? { audio: entry.audio } : {}),
      ...(entry.reading !== undefined ? { reading: entry.reading } : {}),
    };
    return {
      lemma: entry.lemma,
      pos: entry.pos,
      ...(entry.labels.length > 0 ? { labels: entry.labels } : {}),
      ...(Object.keys(pron).length > 0 ? { pron } : {}),
      senses: entry.senses,
      ...(entry.sources.length > 0 ? { sources: entry.sources } : {}),
      ...(entry.match !== undefined ? { match: entry.match } : {}),
    };
  });
  const segments = result.segments?.map((segment) => {
    const remapped = [
      ...new Set((segment.entries ?? []).map((i) => newIndex.get(i)!)),
    ];
    // Ranked by the text's script, the segment's entries are in that order.
    const indexes = language.headword.otherSpellings
      ? remapped.sort((a, b) => a - b)
      : remapped;
    return indexes.length > 0
      ? { text: segment.text, entries: indexes }
      : { text: segment.text };
  });
  return { entries, ...(segments !== undefined ? { segments } : {}) };
};

/**
 * A lookup of a headword with its article (`der See`, as `see` writes it):
 * the word after the article, and the whole string its entries must show.
 */
export const articleLookup = (
  language: Language,
  word: string,
): { readonly word: string; readonly headword: string } | undefined => {
  const articles = Object.values(language.headword.articles ?? {});
  if (articles.length === 0) return undefined;
  const clean = cleanWord(word);
  const space = clean.indexOf(" ");
  if (space < 0) return undefined;
  const lead = clean.slice(0, space);
  const rest = clean.slice(space + 1).trim();
  const known = lead.split("/").every((article) => articles.includes(article));
  return known && rest !== "" ? { word: rest, headword: clean } : undefined;
};
