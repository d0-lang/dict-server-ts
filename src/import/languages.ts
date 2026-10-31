/**
 * Per-language import rules. The raw dump is English Wiktionary, so glosses
 * are English and the stored pair is `<code>_en` (for example `pl_en`).
 *
 * Archaic tags such as "archaic" and "obsolete" apply to every language.
 * Anything more specific (Middle Polish, and similar stage labels) lives here
 * so it does not leak into other languages.
 */
export type LanguageProfile = {
  readonly code: string;
  readonly glossLanguage: "en";
  readonly pair: string;
  /** Passed to `toLocaleLowerCase` when folding forms for lookup. */
  readonly locale: string;
  /** Exact sense tags that mark a sense as out of scope for this language. */
  readonly archaicTags: ReadonlySet<string>;
  /**
   * Drop a sense when its tags contain every tag in a group. Wiktextract splits
   * the label "Middle Polish" into the tags "Middle" and "Polish". The category
   * of the same name is also attached to living senses (for example "mapa"),
   * so it is not a safe filter.
   */
  readonly archaicTagGroups: ReadonlyArray<ReadonlyArray<string>>;
  /** Exact sense categories. Entry-level categories are not applied. */
  readonly archaicCategories: ReadonlySet<string>;
  /**
   * A sound is skipped when its tags contain every tag in any of these groups.
   * Used to keep historical pronunciations out of the IPA list.
   */
  readonly skipSoundTagGroups: ReadonlyArray<ReadonlyArray<string>>;
};

const profile = (
  code: string,
  archaicTags: ReadonlyArray<string>,
  archaicTagGroups: ReadonlyArray<ReadonlyArray<string>>,
  archaicCategories: ReadonlyArray<string>,
  skipSoundTagGroups: ReadonlyArray<ReadonlyArray<string>> = [],
  locale: string = code,
): LanguageProfile => ({
  code,
  glossLanguage: "en",
  pair: `${code}_en`,
  locale,
  archaicTags: new Set(archaicTags),
  archaicTagGroups,
  archaicCategories: new Set(archaicCategories),
  skipSoundTagGroups,
});

const profiles: Readonly<Record<string, LanguageProfile>> = {
  pl: profile("pl", [], [["Middle", "Polish"]], [], [["Middle", "Polish"]]),
};

export const languageProfile = (code: string): LanguageProfile =>
  profiles[code] ?? profile(code, [], [], []);

export const pairFor = (code: string): string => languageProfile(code).pair;
