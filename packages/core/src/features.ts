import type { UdPos } from "./schema.ts";

/**
 * Grammar a learner needs with a headword (a noun's gender, a verb's aspect),
 * as Universal Dependencies features (https://universaldependencies.org/u/feat/).
 * Stored in `entries.features` as a UD feature string, `Animacy=Anim|Gender=Masc`,
 * with several values of one feature joined by a comma (`Aspect=Imp,Perf`).
 * Mirrored in `spec/dictionary/features.json` (checked by `features.test.ts`).
 */
export const FEATURES = {
  Gender: ["Masc", "Fem", "Neut", "Com"],
  Animacy: ["Anim", "Inan"],
  Aspect: ["Imp", "Perf"],
  Number: ["Ptan"],
} as const;

export type FeatureName = keyof typeof FEATURES;
export type Features = Partial<Record<FeatureName, ReadonlyArray<string>>>;

/** Parts of speech that get features: names don't need grammar on the headword. */
export const FEATURE_POS: ReadonlySet<UdPos> = new Set(["NOUN", "VERB"]);

/** wiktextract tags that give a feature, the same for every language. */
export const FEATURE_TAGS: Readonly<
  Record<string, readonly [FeatureName, string]>
> = {
  masculine: ["Gender", "Masc"],
  feminine: ["Gender", "Fem"],
  neuter: ["Gender", "Neut"],
  common: ["Gender", "Com"],
  animate: ["Animacy", "Anim"],
  // Polish masculine animals (not persons)
  "animal-not-person": ["Animacy", "Anim"],
  inanimate: ["Animacy", "Inan"],
  imperfective: ["Aspect", "Imp"],
  perfective: ["Aspect", "Perf"],
  "plural-only": ["Number", "Ptan"],
};

const NAMES = Object.keys(FEATURES) as Array<FeatureName>;

/** The features `tags` give, values in `FEATURES` order. */
export const featuresOfTags = (tags: Iterable<string>): Features => {
  const found = new Map<FeatureName, Set<string>>();
  for (const tag of tags) {
    const feature = FEATURE_TAGS[tag];
    if (feature === undefined) continue;
    const [name, value] = feature;
    found.set(name, (found.get(name) ?? new Set()).add(value));
  }
  return Object.fromEntries(
    NAMES.flatMap((name) => {
      const values = found.get(name);
      return values === undefined
        ? []
        : [[name, FEATURES[name].filter((v) => values.has(v))]];
    }),
  );
};

/** The UD feature string of `features`, names sorted; undefined when empty. */
export const formatFeatures = (features: Features): string | undefined => {
  const parts = Object.keys(features)
    .sort()
    .flatMap((name) => {
      const values = features[name as FeatureName];
      return values === undefined || values.length === 0
        ? []
        : [`${name}=${values.join(",")}`];
    });
  return parts.length > 0 ? parts.join("|") : undefined;
};

/** Features from a stored UD feature string; unknown names and values are dropped. */
export const parseFeatures = (text: string | null | undefined): Features => {
  if (text === null || text === undefined || text === "") return {};
  const features: Features = {};
  for (const part of text.split("|")) {
    const [name, values = ""] = part.split("=");
    if (name === undefined || !(name in FEATURES)) continue;
    const known: ReadonlyArray<string> = FEATURES[name as FeatureName];
    features[name as FeatureName] = values
      .split(",")
      .filter((value) => known.includes(value));
  }
  return features;
};
