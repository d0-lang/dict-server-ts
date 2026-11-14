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
import type { LookupEntry, LookupResult } from "./common/entries.ts";

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
export const presentResult = (
  db: DictionaryDb,
  language: Language,
  result: LookupResult,
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
    audio: Array<string>;
    reading: string | undefined;
    senses: Array<LookupEntry["senses"][number]>;
  }> = [];
  /** The merged entries with each headword, readings aside, in order. */
  const withKey = new Map<string, Array<number>>();
  const newIndex = new Map<number, number>();
  result.entries.forEach((entry, i) => {
    const head = headwordOf(language, entry.lemma, entry.pos, entry.features);
    // A context entry stays apart from an own entry with the same headword.
    const key = JSON.stringify([
      head.lemma,
      entry.pos,
      head.labels,
      segmentOf.get(i),
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
      });
    }
    newIndex.set(i, at);
    const target = merged[at]!;
    target.ipa = unique([...target.ipa, ...(entry.pron?.ipa ?? [])]);
    target.audio = unique([...target.audio, ...(entry.pron?.audio ?? [])]);
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
  });

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
      ...(entry.match !== undefined ? { match: entry.match } : {}),
    };
  });
  const segments = result.segments?.map((segment) => {
    const indexes = [
      ...new Set((segment.entries ?? []).map((i) => newIndex.get(i)!)),
    ];
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
