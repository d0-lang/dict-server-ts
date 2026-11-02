import { cleanWord, lookupKey } from "../../dictionary/lookupKey.ts";
import type { PronKind, UdPos } from "../../dictionary/schema.ts";
import { isHistorical, type LanguageRules } from "./languages.ts";
import { toUdPos } from "./pos.ts";
import {
  grammarPointerTarget,
  hasDeadLabel,
  isBareDerivedGloss,
  isMisreadFormOf,
  isOwnEntryGloss,
  isPlaceholderGloss,
  isVerbalNounForm,
  keepForm,
  skipSense,
  synonymTargets,
  type SkippedSenseReason,
} from "./rules.ts";
import type {
  WiktextractEntry,
  WiktextractForm,
  WiktextractSense,
  WiktextractSound,
} from "../source/wiktextract.ts";

/** One sense of an entry: a parent gloss first, then what was nested under it. */
export type ImportSense = {
  readonly translations: ReadonlyArray<string>;
  /** Words a "synonym of" gloss points at; the writer keeps those with an entry. */
  readonly see: ReadonlyArray<string>;
};

/** A dictionary entry ready to be written. */
export type ImportEntry = {
  readonly lemma: string;
  readonly pos: UdPos;
  readonly sourcePos: string;
  readonly etymology: number;
  readonly senses: ReadonlyArray<ImportSense>;
  readonly pronunciations: ReadonlyArray<{
    readonly kind: PronKind;
    readonly value: string;
  }>;
  /** Normalized (`lookupKey`) inflected forms, lemma excluded, deduplicated. */
  readonly forms: ReadonlyArray<string>;
  /** Senses whose gloss only names another word; the writer adds its meaning. */
  readonly derived: ReadonlyArray<DerivedSense>;
  /** Normalized verbal nouns from the table, used only if they have no entry. */
  readonly verbalNouns: ReadonlyArray<string>;
};

/** A sense like "diminutive of kotek", which needs the meaning of its base. */
export type DerivedSense = {
  readonly gloss: string;
  /** `lookupKey`s of the base words, in source order. */
  readonly bases: ReadonlyArray<string>;
};

/**
 * "X is a form of Y" taken from a `form-of` / `alt-of` sense, or from the table
 * of a word with no entry (`tańsi` in the table of `tańszy` -> `tani`). At the
 * end of the import it becomes a `forms` row `X -> Y` when Y exists, following
 * chains, as a fallback for forms missing from Y's inflection table.
 */
export type FormOfLink = {
  /** `lookupKey` of the word carrying the form-of sense. */
  readonly form: string;
  /** `lookupKey` of the lemma it points at. */
  readonly lemma: string;
  readonly sourcePos: string;
  /**
   * From a gloss like "old dative of prosty" rather than a `form-of` tag. Weaker
   * evidence, so it only resolves to the same part of speech, and only when the
   * form doesn't already reach that lemma.
   */
  readonly pointer?: true;
};

export type TransformResult = {
  /** Undefined when no sense survived (pure form-of entries, archaic-only words). */
  readonly entry: ImportEntry | undefined;
  /**
   * The entry to use if the word ends up with no other entry, for words whose
   * only senses belong to a historical stage (`książę`).
   */
  readonly historicalEntry?: ImportEntry;
  readonly formOf: ReadonlyArray<FormOfLink>;
  /** Distinct parent glosses of this line, to spot new templates across words. */
  readonly parentGlosses: ReadonlyArray<string>;
  readonly skippedSenses: Readonly<Record<SkippedSenseReason, number>>;
  readonly droppedForms: number;
};

/** The most specific gloss of wiktextract's parent-to-child path. */
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

const isLinkSense = (sense: WiktextractSense): boolean => {
  const tags = sense.tags ?? [];
  if (!tags.includes("form-of") && !tags.includes("alt-of")) return false;
  const gloss = senseGloss(sense);
  return gloss === undefined || !isMisreadFormOf(gloss);
};

/** `sens==Polish==`: a heading the dump left on a link target. */
const cleanTarget = (word: string): string => word.replace(/==.*$/, "");

const stripParentColon = (gloss: string): string =>
  gloss.replace(/\s*:\s*$/, "");

/** Targets of parents like "dative/locative singular of się", which name no meaning. */
const pointerParentTargets = (
  rules: LanguageRules,
  sense: WiktextractSense,
): ReadonlyArray<string> =>
  (sense.glosses ?? []).slice(0, -1).flatMap((gloss) => {
    const target = grammarPointerTarget(
      rules,
      stripParentColon(gloss.trim()),
      sense.links ?? [],
    );
    return target === undefined ? [] : [target];
  });

/** A sense's gloss path without placeholders or grammar parents, parents tidied. */
const glossPath = (
  rules: LanguageRules,
  sense: WiktextractSense,
): ReadonlyArray<string> => {
  const glosses = sense.glosses ?? [];
  return glosses.flatMap((gloss, i) => {
    const text = gloss.trim();
    if (text === "" || isPlaceholderGloss(text)) return [];
    if (i === glosses.length - 1) return [text];
    const parent = stripParentColon(text);
    return grammarPointerTarget(rules, parent, sense.links ?? []) === undefined
      ? [parent]
      : [];
  });
};

/** Senses being built, merged by their top parent in first-seen order. */
const makeSenseGroups = () => {
  const groups = new Map<string, { glosses: Set<string>; see: Set<string> }>();
  return {
    groups,
    add: (path: ReadonlyArray<string>, see: ReadonlyArray<string> = []) => {
      const head = path[0];
      if (head === undefined) return;
      const group = groups.get(head) ?? {
        glosses: new Set([head]),
        see: new Set<string>(),
      };
      groups.set(head, group);
      path.forEach((gloss) => group.glosses.add(gloss));
      see.forEach((word) => group.see.add(word));
    },
    senses: (): ReadonlyArray<ImportSense> =>
      [...groups.values()].map(({ glosses, see }) => ({
        translations: [...glosses],
        see: [...see],
      })),
  };
};

/**
 * What remains of a skipped sense: its parents, down to the first one labelled
 * as out of use. A level without a label is alive, whatever `tags` says.
 */
const livingParents = (
  rules: LanguageRules,
  sense: WiktextractSense,
): ReadonlyArray<string> => {
  const glosses = sense.glosses ?? [];
  if (glosses.length < 2) return [];
  const raw =
    sense.raw_glosses?.length === glosses.length ? sense.raw_glosses : [];
  const dead = glosses
    .slice(0, -1)
    .findIndex((_, i) => hasDeadLabel(rules, raw[i]));
  const kept = dead === -1 ? glosses.slice(0, -1) : glosses.slice(0, dead);
  return glossPath(rules, { glosses: [...kept, ""], links: sense.links ?? [] });
};

/** What one wiktextract sense turns into. */
type SenseOutcome =
  | { readonly kind: "skip"; readonly reason: SkippedSenseReason }
  | {
      readonly kind: "link";
      readonly targets: ReadonlyArray<string>;
      readonly pointer?: true;
    }
  | {
      readonly kind: "derived";
      readonly gloss: string;
      readonly bases: ReadonlyArray<string>;
    }
  | { readonly kind: "gloss"; readonly gloss: string };

const classifySense = (
  rules: LanguageRules,
  sense: WiktextractSense,
): SenseOutcome => {
  const tags = sense.tags ?? [];
  const reason = skipSense(rules, tags);
  if (reason !== undefined) return { kind: "skip", reason };
  const gloss = senseGloss(sense);
  if (isLinkSense(sense)) {
    const links = [...(sense.form_of ?? []), ...(sense.alt_of ?? [])].map(
      (link) => ({ word: cleanTarget(link.word) }),
    );
    if (gloss !== undefined && isOwnEntryGloss(gloss)) {
      return {
        kind: "derived",
        gloss,
        bases: isBareDerivedGloss(
          gloss,
          links.map((l) => l.word),
        )
          ? links.map((l) => lookupKey(l.word))
          : [],
      };
    }
    return { kind: "link", targets: links.map((l) => lookupKey(l.word)) };
  }
  if (gloss === undefined) return { kind: "skip", reason: "no-gloss" };
  if (glossPath(rules, sense).length === 0) {
    return { kind: "skip", reason: "placeholder" };
  }
  if (sense.glosses?.length === 1) {
    const target = grammarPointerTarget(rules, gloss, sense.links ?? []);
    if (target !== undefined) {
      return { kind: "link", targets: [lookupKey(target)], pointer: true };
    }
  }
  return { kind: "gloss", gloss };
};

/** Normalized forms to index for a lemma, and how many raw forms were dropped. */
const collectForms = (
  rules: LanguageRules,
  lemma: string,
  rawForms: ReadonlyArray<WiktextractForm>,
): { readonly forms: ReadonlyArray<string>; readonly dropped: number } => {
  const lemmaKey = lookupKey(lemma);
  const forms = new Set<string>();
  let dropped = 0;
  for (const form of rawForms) {
    if (!keepForm(rules, lemma, form)) {
      dropped++;
      continue;
    }
    const key = lookupKey(form.form);
    if (key !== lemmaKey) forms.add(key);
  }
  return { forms: [...forms], dropped };
};

/** Pure mapping of one wiktextract line (already known to be `rules.code`). */
export const transformEntry = (
  rules: LanguageRules,
  raw: WiktextractEntry,
): TransformResult => {
  const lemma = cleanWord(raw.word);
  const lemmaKey = lookupKey(lemma);
  const skippedSenses: Record<SkippedSenseReason, number> = {
    archaic: 0,
    "historical-stage": 0,
    "no-gloss": 0,
    placeholder: 0,
  };
  const formOf: Array<FormOfLink> = [];
  const senses = makeSenseGroups();
  const historicalSenses = makeSenseGroups();
  const parentGlosses = new Set<string>();
  const derived: Array<DerivedSense> = [];

  for (const sense of raw.senses ?? []) {
    const outcome = classifySense(rules, sense);
    switch (outcome.kind) {
      case "skip": {
        skippedSenses[outcome.reason]++;
        if (!isLinkSense(sense)) {
          senses.add(livingParents(rules, sense));
          if (outcome.reason === "historical-stage") {
            historicalSenses.add(glossPath(rules, sense));
          }
        }
        break;
      }
      case "derived": {
        senses.add([outcome.gloss]);
        const bases = outcome.bases.filter((b) => b !== "" && b !== lemmaKey);
        if (bases.length > 0) derived.push({ gloss: outcome.gloss, bases });
        break;
      }
      case "link":
        for (const target of outcome.targets) {
          if (target !== "" && target !== lemmaKey) {
            formOf.push({
              form: lemmaKey,
              lemma: target,
              sourcePos: raw.pos,
              ...(outcome.pointer ? { pointer: true as const } : {}),
            });
          }
        }
        break;
      case "gloss": {
        const path = glossPath(rules, sense);
        for (const target of pointerParentTargets(rules, sense)) {
          const lemma = lookupKey(target);
          if (lemma !== lemmaKey) {
            formOf.push({
              form: lemmaKey,
              lemma,
              sourcePos: raw.pos,
              pointer: true,
            });
          }
        }
        path.slice(0, -1).forEach((parent) => parentGlosses.add(parent));
        senses.add(
          path,
          synonymTargets(rules, outcome.gloss, sense.links ?? []).filter(
            (word) => lookupKey(word) !== lemmaKey,
          ),
        );
        break;
      }
    }
  }

  const { forms, dropped } = collectForms(rules, lemma, raw.forms ?? []);
  const makeEntry = (
    entrySenses: ReadonlyArray<ImportSense>,
    derivedSenses: ReadonlyArray<DerivedSense>,
  ): ImportEntry => ({
    lemma,
    pos: toUdPos(raw.pos),
    sourcePos: raw.pos,
    etymology: toEtymology(raw.etymology_number),
    senses: entrySenses,
    pronunciations: pickPronunciations(rules, raw.sounds ?? []),
    forms,
    derived: derivedSenses,
    verbalNouns: (raw.forms ?? [])
      .filter(isVerbalNounForm)
      .map((form) => lookupKey(form.form)),
  });

  if (senses.groups.size === 0) {
    // No entry here, so this word's table belongs to the word it points at.
    const targets = new Map(dedupeLinks(formOf).map((l) => [l.lemma, l]));
    const tableLinks = forms.flatMap((form) =>
      [...targets.values()]
        .filter((link) => link.lemma !== form)
        .map((link) => ({ ...link, form })),
    );
    return {
      entry: undefined,
      ...(historicalSenses.groups.size > 0
        ? { historicalEntry: makeEntry(historicalSenses.senses(), []) }
        : {}),
      formOf: dedupeLinks([...formOf, ...tableLinks]),
      parentGlosses: [...parentGlosses],
      skippedSenses,
      droppedForms: dropped,
    };
  }

  const links = dedupeLinks(formOf);
  return {
    entry: makeEntry(senses.senses(), derived),
    formOf: links,
    parentGlosses: [...parentGlosses],
    skippedSenses,
    droppedForms: dropped,
  };
};

/** One link per form and lemma; a tagged link beats a pointer to the same word. */
const dedupeLinks = (links: ReadonlyArray<FormOfLink>) => {
  if (links.length < 2) return links;
  const byKey = new Map<string, FormOfLink>();
  for (const link of links) {
    const k = `${link.form}\u0000${link.lemma}`;
    const seen = byKey.get(k);
    if (seen === undefined || (seen.pointer && !link.pointer)) {
      byKey.set(k, link);
    }
  }
  return [...byKey.values()];
};
