import type { LanguageProfile } from "./languages.ts";
import type { WiktextractEntry, WiktextractSense } from "./wiktextract.ts";

const GLOBAL_ARCHAIC_TAGS = new Set(["archaic", "obsolete"]);

const cleanGlosses = (
  glosses: ReadonlyArray<string> | null | undefined,
): ReadonlyArray<string> => {
  if (glosses === null || glosses === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const gloss of glosses) {
    const trimmed = gloss.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

/** English glosses, qualifiers kept when wiktextract still has `raw_glosses`. */
export const senseTranslations = (
  sense: WiktextractSense,
): ReadonlyArray<string> => {
  const raw = cleanGlosses(sense.raw_glosses);
  if (raw.length > 0) {
    return raw;
  }
  return cleanGlosses(sense.glosses);
};

export const isFormOfSense = (sense: WiktextractSense): boolean => {
  const tags = sense.tags ?? [];
  if (tags.includes("form-of")) {
    return true;
  }
  const targets = sense.form_of ?? [];
  return targets.length > 0;
};

const linkedLemmas = (
  links: WiktextractSense["form_of"],
): ReadonlyArray<string> => {
  const lemmas: string[] = [];
  const seen = new Set<string>();
  for (const target of links ?? []) {
    const word = target.word?.trim();
    if (word === undefined || word.length === 0 || seen.has(word)) {
      continue;
    }
    seen.add(word);
    lemmas.push(word);
  }
  return lemmas;
};

export const formOfLemmas = (sense: WiktextractSense): ReadonlyArray<string> =>
  linkedLemmas(sense.form_of);

export const isAltOfSense = (sense: WiktextractSense): boolean => {
  const tags = sense.tags ?? [];
  if (tags.includes("alt-of")) {
    return true;
  }
  return (sense.alt_of ?? []).length > 0;
};

export const altOfLemmas = (sense: WiktextractSense): ReadonlyArray<string> =>
  linkedLemmas(sense.alt_of);

export const isArchaicSense = (
  _entry: WiktextractEntry,
  sense: WiktextractSense,
  profile: LanguageProfile,
): boolean => {
  const tags = sense.tags ?? [];
  for (const tag of tags) {
    if (GLOBAL_ARCHAIC_TAGS.has(tag) || profile.archaicTags.has(tag)) {
      return true;
    }
  }
  for (const group of profile.archaicTagGroups) {
    if (group.every((tag) => tags.includes(tag))) {
      return true;
    }
  }
  for (const category of sense.categories ?? []) {
    if (profile.archaicCategories.has(category)) {
      return true;
    }
  }
  return false;
};

export const soundIsHistorical = (
  tags: ReadonlyArray<string> | null | undefined,
  profile: LanguageProfile,
): boolean => {
  if (tags === null || tags === undefined || tags.length === 0) {
    return false;
  }
  const present = new Set(tags);
  return profile.skipSoundTagGroups.some((group) =>
    group.every((tag) => present.has(tag)),
  );
};

/**
 * Senses that are not stored as translations: inflected-form glosses, archaic
 * senses, and senses with no English gloss left.
 */
export const isGarbageSense = (
  entry: WiktextractEntry,
  sense: WiktextractSense,
  profile: LanguageProfile,
): boolean => {
  if (
    isFormOfSense(sense) ||
    isAltOfSense(sense) ||
    isArchaicSense(entry, sense, profile)
  ) {
    return true;
  }
  return senseTranslations(sense).length === 0;
};

const needlesFor = (code: string): ReadonlyArray<string> => [
  `"lang_code": "${code}"`,
  `"lang_code":"${code}"`,
];

/**
 * True when a line's own language (or a descendant, which uses the same
 * adjacent `"lang"` / `"lang_code"` pair) matches `code`.
 *
 * Translation objects put `"code"` between those keys, so an English entry
 * that merely lists a Polish translation does not match.
 */
export const lineMentionsLanguage = (line: string, code: string): boolean => {
  for (const needle of needlesFor(code)) {
    let from = 0;
    while (from < line.length) {
      const index = line.indexOf(needle, from);
      if (index < 0) {
        break;
      }
      const before = line.slice(Math.max(0, index - 80), index);
      if (/"lang"\s*:\s*"[^"]*"\s*,\s*$/.test(before)) {
        return true;
      }
      from = index + needle.length;
    }
  }
  return false;
};
