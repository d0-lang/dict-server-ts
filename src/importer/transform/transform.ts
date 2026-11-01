import { formKey, type PronKind, type UdPos } from "../../dictionary/schema.ts";
import { SKIPPED_SENSE_TAGS, type LanguageRules } from "./languages.ts";
import { toUdPos } from "./pos.ts";
import type {
  WiktextractEntry,
  WiktextractForm,
  WiktextractSense,
  WiktextractSound,
} from "../source/wiktextract.ts";

/** A dictionary entry ready to be written. */
export type ImportEntry = {
  readonly lemma: string;
  readonly pos: UdPos;
  readonly sourcePos: string;
  readonly etymology: number;
  /** One item per sense, each a non-empty list of translations. */
  readonly senses: ReadonlyArray<ReadonlyArray<string>>;
  readonly pronunciations: ReadonlyArray<{
    readonly kind: PronKind;
    readonly value: string;
  }>;
  /** Normalized (`formKey`) inflected forms, lemma excluded, deduplicated. */
  readonly forms: ReadonlyArray<string>;
};

/**
 * "X is a form of Y" taken from a `form-of` / `alt-of` sense. Not an entry of
 * its own: at the end of the import it becomes a `forms` row `X -> Y` when Y
 * exists, as a fallback for forms missing from Y's inflection table.
 */
export type FormOfLink = {
  /** `formKey` of the word carrying the form-of sense. */
  readonly form: string;
  /** `formKey` of the lemma it points at. */
  readonly lemma: string;
  readonly sourcePos: string;
};

export type SkippedSenseReason = "archaic" | "historical" | "no-gloss";

export type TransformResult = {
  /** Undefined when no sense survived (pure form-of entries, archaic-only words). */
  readonly entry: ImportEntry | undefined;
  readonly formOf: ReadonlyArray<FormOfLink>;
  readonly skippedSenses: Readonly<Record<SkippedSenseReason, number>>;
  readonly droppedForms: number;
};

const hasTagSet = (
  tags: ReadonlyArray<string> | undefined,
  set: ReadonlyArray<string>,
): boolean =>
  tags !== undefined && set.length > 0 && set.every((t) => tags.includes(t));

const isHistorical = (
  rules: LanguageRules,
  tags: ReadonlyArray<string> | undefined,
): boolean => rules.excludedTagSets.some((set) => hasTagSet(tags, set));

/** Rows of an inflection table that are template metadata, not words. */
const JUNK_FORM_TAGS = new Set([
  "table-tags",
  "inflection-template",
  "class",
  "canonical",
  "romanization",
]);

/**
 * `forms` rows without a `source` come from the headword line. Most are
 * related *words* (diminutives, aspect partners, feminine equivalents, the
 * derived adverb), which must not resolve to this lemma. Only these tags mark
 * a real form of the same lexeme there.
 */
const HEAD_FORM_KEEP_TAGS = new Set([
  "alternative",
  "comparative",
  "superlative",
]);
const HEAD_FORM_DERIVED_TAGS = new Set([
  "adjective",
  "adverb",
  "augmentative",
  "demonym",
  "derived",
  "diminutive",
  "feminine",
  "masculine",
  "neuter",
  "abbreviation",
  "imperfective",
  "perfective",
  "frequentative",
  "surname",
  "noun-from-verb",
]);

const keepForm = (
  rules: LanguageRules,
  lemmaHasSpace: boolean,
  form: WiktextractForm,
): boolean => {
  const word = form.form.trim();
  if (word === "" || word === "-" || word === "—") return false;
  // "-(e)m robił", "będę robił": analytic forms of single-word lemmas are not
  // something a single-word lookup can hit, and they bloat the index.
  if (!lemmaHasSpace && /\s/.test(word)) return false;
  if (word.startsWith("-") || word.includes("(")) return false;
  const tags = form.tags ?? [];
  if (tags.some((t) => JUNK_FORM_TAGS.has(t))) return false;
  if (isHistorical(rules, tags)) return false;
  if (form.source === undefined) {
    return (
      tags.some((t) => HEAD_FORM_KEEP_TAGS.has(t)) &&
      !tags.some((t) => HEAD_FORM_DERIVED_TAGS.has(t))
    );
  }
  return true;
};

/**
 * The most specific gloss. wiktextract repeats parent glosses in subsenses
 * (["parent", "child"]) and puts headers like "The meaning of this term is
 * uncertain..." first, so the last one is the sense itself.
 */
const senseGloss = (sense: WiktextractSense): string | undefined => {
  const glosses = sense.glosses;
  if (glosses === undefined || glosses.length === 0) return undefined;
  const gloss = glosses[glosses.length - 1]!.trim();
  return gloss === "" ? undefined : gloss;
};

const pickPronunciations = (
  rules: LanguageRules,
  sounds: ReadonlyArray<WiktextractSound>,
): ImportEntry["pronunciations"] => {
  const usable = sounds.filter((s) => !isHistorical(rules, s.tags));
  const isStandard = (s: WiktextractSound) =>
    (s.note === undefined || rules.standardPronNotes.includes(s.note)) &&
    (s.tags === undefined || s.tags.every((t) => t === "standard"));
  const withIpa = usable.filter((s) => s.ipa !== undefined && s.ipa !== "");
  const standardIpa = withIpa.filter(isStandard);
  const ipa = (standardIpa.length > 0 ? standardIpa : withIpa).map(
    (s) => s.ipa!,
  );
  const audio = usable.flatMap((s) =>
    [s.ogg_url, s.mp3_url].filter(
      (u): u is string => u !== undefined && u.startsWith("https://"),
    ),
  );
  return [
    ...[...new Set(ipa)].map((value) => ({ kind: "ipa" as const, value })),
    ...[...new Set(audio)].map((value) => ({ kind: "audio" as const, value })),
  ];
};

const toEtymology = (value: number | string | undefined): number => {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return n !== undefined && Number.isInteger(n) && n >= 0 ? n : 0;
};

/** What one wiktextract sense turns into. */
type SenseOutcome =
  | { readonly kind: "skip"; readonly reason: SkippedSenseReason }
  | { readonly kind: "link"; readonly targets: ReadonlyArray<string> }
  | { readonly kind: "gloss"; readonly gloss: string };

const classifySense = (
  rules: LanguageRules,
  sense: WiktextractSense,
): SenseOutcome => {
  const tags = sense.tags ?? [];
  if (tags.some((t) => SKIPPED_SENSE_TAGS.includes(t))) {
    const reason = tags.includes("archaic") ? "archaic" : "no-gloss";
    return { kind: "skip", reason };
  }
  if (isHistorical(rules, tags)) return { kind: "skip", reason: "historical" };
  if (tags.includes("form-of") || tags.includes("alt-of")) {
    const links = [...(sense.form_of ?? []), ...(sense.alt_of ?? [])];
    return { kind: "link", targets: links.map((l) => formKey(l.word)) };
  }
  const gloss = senseGloss(sense);
  return gloss === undefined
    ? { kind: "skip", reason: "no-gloss" }
    : { kind: "gloss", gloss };
};

/** Normalized forms to index for a lemma, and how many raw forms were dropped. */
const collectForms = (
  rules: LanguageRules,
  lemma: string,
  rawForms: ReadonlyArray<WiktextractForm>,
): { readonly forms: ReadonlyArray<string>; readonly dropped: number } => {
  const lemmaKey = formKey(lemma);
  const lemmaHasSpace = /\s/.test(lemma);
  const forms = new Set<string>();
  let dropped = 0;
  for (const form of rawForms) {
    if (!keepForm(rules, lemmaHasSpace, form)) {
      dropped++;
      continue;
    }
    const key = formKey(form.form);
    if (key !== lemmaKey) forms.add(key);
  }
  return { forms: [...forms], dropped };
};

/** Pure mapping of one wiktextract line (already known to be `rules.code`). */
export const transformEntry = (
  rules: LanguageRules,
  raw: WiktextractEntry,
): TransformResult => {
  const lemma = raw.word.normalize("NFC").trim();
  const lemmaKey = formKey(lemma);
  const skippedSenses: Record<SkippedSenseReason, number> = {
    archaic: 0,
    historical: 0,
    "no-gloss": 0,
  };
  const formOf: Array<FormOfLink> = [];
  const glosses = new Set<string>();

  for (const sense of raw.senses ?? []) {
    const outcome = classifySense(rules, sense);
    switch (outcome.kind) {
      case "skip":
        skippedSenses[outcome.reason]++;
        break;
      case "link":
        for (const target of outcome.targets) {
          if (target !== "" && target !== lemmaKey) {
            formOf.push({ form: lemmaKey, lemma: target, sourcePos: raw.pos });
          }
        }
        break;
      case "gloss":
        glosses.add(outcome.gloss);
        break;
    }
  }

  const links = dedupeLinks(formOf);
  // Pure form-of lines and archaic-only words produce no entry, so their forms
  // are not looked at.
  if (glosses.size === 0) {
    return { entry: undefined, formOf: links, skippedSenses, droppedForms: 0 };
  }

  const { forms, dropped } = collectForms(rules, lemma, raw.forms ?? []);
  return {
    entry: {
      lemma,
      pos: toUdPos(raw.pos),
      sourcePos: raw.pos,
      etymology: toEtymology(raw.etymology_number),
      senses: [...glosses].map((gloss) => [gloss]),
      pronunciations: pickPronunciations(rules, raw.sounds ?? []),
      forms,
    },
    formOf: links,
    skippedSenses,
    droppedForms: dropped,
  };
};

const dedupeLinks = (links: ReadonlyArray<FormOfLink>) => {
  if (links.length < 2) return links;
  const seen = new Set<string>();
  return links.filter((l) => {
    const k = `${l.form}\u0000${l.lemma}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
