import {
  featuresOfTags,
  FEATURE_POS,
  formatFeatures,
} from "@dict/core/features";
import { hiragana } from "@dict/core/kana";
import { cleanWord, lookupKey } from "@dict/core/lookupKey";
import type { PronKind, UdPos } from "@dict/core/schema";
import { isHistorical, type LanguageRules } from "./languages.ts";
import { toUdPos } from "./pos.ts";
import {
  grammarPointerTarget,
  hasDeadLabel,
  isBareDerivedGloss,
  isMarked,
  isMarkedAlternative,
  isMisreadFormOf,
  isMisreadTarget,
  isOwnEntryGloss,
  isPlaceholderGloss,
  isVerbalNounForm,
  keepForm,
  skipSense,
  synonymTargets,
  type Degree,
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
  readonly glosses: ReadonlyArray<string>;
  /** Words a "synonym of" gloss points at; the writer keeps those with an entry. */
  readonly see: ReadonlyArray<string>;
};

/** A dictionary entry ready to be written. */
export type ImportEntry = {
  readonly lemma: string;
  /** The Wiktionary page the entry comes from (wiktextract's `word`), credited in lookups. */
  readonly page: string;
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
  /**
   * Declined forms of the table's participles, with
   * `participleDeclension.onlyNew`: used only where no other entry has the
   * form, so `bestehende` stays `bestehend`'s.
   */
  readonly participleForms?: ReadonlyArray<string>;
  /**
   * Normalized forms the table only ever tags comparative or superlative
   * (`besser`; not `neuer`, also a plain form of `neu`), with that degree when
   * the table gives only one (`größere` comparative, `größte` superlative).
   */
  readonly degreeForms?: ReadonlyArray<DegreeForm>;
  /** The headword's grammar as a UD feature string (`Gender=Masc`), for nouns and verbs. */
  readonly features?: string;
  /** For a reflexive entry (`bawić się`), the verb it belongs to (`bawić`). */
  readonly reflexiveOf?: string;
};

/** A form a table tags comparative or superlative, and which of the two, if only one. */
export type DegreeForm = {
  readonly form: string;
  readonly degree?: Degree;
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
  /**
   * From a spelling with a usage label (obsolete, dialectal, ...). It only
   * resolves when the form reaches no entry in any other way.
   */
  readonly marked?: true;
};

export type TransformResult = {
  /** Undefined when no sense survived (pure form-of entries, archaic-only words). */
  readonly entry: ImportEntry | undefined;
  /**
   * The entry to use if the word ends up with no other entry, for words whose
   * only senses belong to a historical stage (`książę`).
   */
  readonly historicalEntry?: ImportEntry;
  /** The word's reflexive senses as entries of their own (`bawić się`), for `rules.reflexive`. */
  readonly reflexiveEntries?: ReadonlyArray<ImportEntry>;
  readonly formOf: ReadonlyArray<FormOfLink>;
  /** Distinct parent glosses of this line, to spot new templates across words. */
  readonly parentGlosses: ReadonlyArray<string>;
  readonly skippedSenses: Readonly<Record<SkippedSenseReason, number>>;
  readonly droppedForms: number;
  /** A soft redirect: the word (`form`, a lookup key) is a spelling of these lemmas (`つまり` -> `詰まり`). */
  readonly redirect?: {
    readonly form: string;
    readonly targets: ReadonlyArray<string>;
  };
};

/** The most specific gloss of wiktextract's parent-to-child path. */
const senseGloss = (sense: WiktextractSense): string | undefined => {
  const glosses = sense.glosses;
  if (glosses === undefined || glosses.length === 0) return undefined;
  const gloss = glosses[glosses.length - 1]!.trim();
  return gloss === "" ? undefined : gloss;
};

/**
 * The word in kana: the first form with ruby that spells `word` (or `word`
 * and kana after it), with each
 * base replaced by its reading (`食べる` with `[["食", "た"]]` is `たべる`).
 * Words without ruby (kana, or no kanji reading given) have none. A small
 * `ヶ` or `ヵ`, which ruby leaves bare, is read by the romanization
 * (`smallKe`).
 */
export const rubyReading = (
  word: string,
  forms: ReadonlyArray<WiktextractForm>,
): string | undefined => {
  for (const form of forms) {
    // The canonical form may add kana after the word: `勉強する` for the
    // する-verb `勉強`. The reading then drops the same kana.
    if (
      !form.form.startsWith(word) ||
      form.ruby === undefined ||
      form.ruby.length === 0
    )
      continue;
    const added = form.form.slice(word.length);
    if (form.ruby.some(([base]) => base !== undefined && added.includes(base)))
      continue;
    let rest = word;
    let reading = "";
    const fits = form.ruby.every((pair) => {
      const [base, kana] = pair;
      const at =
        base === undefined || pair.length !== 2 ? -1 : rest.indexOf(base);
      if (at < 0) return false;
      reading += rest.slice(0, at) + kana;
      rest = rest.slice(at + base!.length);
      return true;
    });
    if (fits) return smallKe(reading + rest, forms);
  }
  return undefined;
};

/**
 * `reading` with each small `ヶ` or `ヵ` as it is read: か in a counter
 * (`三ヶ月` is さんかげつ), が in a name (`関ヶ原` is せきがはら). Ruby gives
 * it no reading, but the romanization tells which: read が, it has one more
 * `g` than the rest of the reading has kana of the が row (`Chigasaki` for
 * ち + さき; `sankagetsu` for さん + げつ has only げ's). か without a
 * romanization: the counter is the common word.
 */
const smallKe = (
  reading: string,
  forms: ReadonlyArray<WiktextractForm>,
): string => {
  if (!/[ヶヵ]/u.test(reading)) return reading;
  const romanization = forms.find((form) =>
    form.tags?.includes("romanization"),
  )?.form;
  const count = (text: string, letters: RegExp) =>
    text.match(letters)?.length ?? 0;
  let voiced =
    romanization === undefined
      ? 0
      : count(romanization, /g/giu) -
        count(hiragana(reading), /[がぎぐげご]/gu);
  return reading.replace(/[ヶヵ]/gu, () => (voiced-- > 0 ? "が" : "か"));
};

const pickPronunciations = (
  rules: LanguageRules,
  sounds: ReadonlyArray<WiktextractSound>,
  reading?: string,
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
    ...(reading !== undefined
      ? [{ kind: "reading" as const, value: reading }]
      : []),
  ];
};

const toEtymology = (value: number | string | undefined): number => {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return n !== undefined && Number.isInteger(n) && n >= 0 ? n : 0;
};

/**
 * A link target as the dump writes it, without what isn't the word: a heading
 * the dump left on it (`sens==Polish==`), or the aspect Slavic form-of templates
 * write after a verb (`розташува́ти pf`, `узурпува́ти impf or pf`).
 */
const cleanTarget = (word: string): string =>
  word
    .replace(/==.*$/, "")
    .replace(/\s+(?:impf|pf)(?:\s+or\s+(?:impf|pf))?$/, "");

const isLinkSense = (
  rules: LanguageRules,
  lemma: string,
  sense: WiktextractSense,
): boolean => {
  const tags = sense.tags ?? [];
  if (!tags.includes("form-of") && !tags.includes("alt-of")) return false;
  const gloss = senseGloss(sense);
  if (gloss !== undefined && isMisreadFormOf(gloss)) return false;
  const targets = [...(sense.form_of ?? []), ...(sense.alt_of ?? [])].map(
    (link) => cleanTarget(link.word),
  );
  // Russian verbal nouns are tagged `form-of` without naming the verb
  // (`продолжение` "continuation"); their gloss is the meaning.
  if (targets.length === 0) return false;
  return !isMisreadTarget(rules, lemma, targets, sense.links ?? []);
};

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
        glosses: [...glosses],
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
      readonly marked?: true;
    }
  | {
      readonly kind: "derived";
      readonly gloss: string;
      readonly bases: ReadonlyArray<string>;
    }
  | { readonly kind: "gloss"; readonly gloss: string };

const classifySense = (
  rules: LanguageRules,
  lemma: string,
  sense: WiktextractSense,
): SenseOutcome => {
  const tags = sense.tags ?? [];
  const reason = skipSense(rules, tags);
  if (reason !== undefined) return { kind: "skip", reason };
  const gloss = senseGloss(sense);
  if (isLinkSense(rules, lemma, sense)) {
    const links = [...(sense.form_of ?? []), ...(sense.alt_of ?? [])].map(
      (link) => ({ word: cleanTarget(link.word) }),
    );
    if (gloss !== undefined && isOwnEntryGloss(gloss, rules.ownEntryForms)) {
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
    return {
      kind: "link",
      targets: links.map((l) => lookupKey(l.word)),
      ...(isMarked(tags) ? { marked: true as const } : {}),
    };
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

/** Normalized forms to index for a lemma, declined participles apart, and how many raw forms were dropped. */
const collectForms = (
  rules: LanguageRules,
  lemma: string,
  rawForms: ReadonlyArray<WiktextractForm>,
): {
  readonly forms: ReadonlyArray<string>;
  readonly participles: ReadonlyArray<string>;
  readonly dropped: number;
} => {
  const lemmaKey = lookupKey(lemma);
  const forms = new Set<string>();
  const participles = new Set<string>();
  let dropped = 0;
  // A table whose every cell is a dash (Ukrainian `монета`), not a missing
  // table: without one, the headword line holds other words too (German `der`
  // for `CIA`), except in languages whose words have no tables
  // (`headwordInflections`: French `structure`, plural `structures`).
  const table = rawForms.filter((form) => form.source !== undefined);
  const noTable =
    table.length > 0
      ? !table.some((form) => keepForm(rules, lemma, form))
      : rules.headwordInflections === true;
  for (const form of rawForms) {
    if (!keepForm(rules, lemma, form, noTable)) {
      dropped++;
      continue;
    }
    const key = lookupKey(form.form);
    if (key !== lemmaKey) forms.add(key);
    for (const declined of participleForms(rules, key, form.tags ?? [])) {
      (rules.participleDeclension?.onlyNew ? participles : forms).add(declined);
    }
  }
  return {
    forms: [...forms],
    participles: [...participles].filter(
      (form) => !forms.has(form) && form !== lemmaKey,
    ),
    dropped,
  };
};

/**
 * The declined forms of an adjectival participle the table lists in one form
 * only (`wymagany` -> `wymaganego`, `wymaganej`; `ausgelegt` ->
 * `ausgelegte`), for a language with `participleDeclension`.
 */
const participleForms = (
  rules: LanguageRules,
  key: string,
  tags: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const declension = rules.participleDeclension;
  if (
    declension === undefined ||
    !declension.tags.every((tag) => tags.includes(tag)) ||
    !key.endsWith(declension.ending) ||
    /\s/u.test(key)
  ) {
    return [];
  }
  const stem = key.slice(0, key.length - declension.ending.length);
  return declension.endings.map((ending) => stem + ending);
};

const isDegreeForm = (form: WiktextractForm): boolean =>
  form.tags?.some((tag) => tag === "comparative" || tag === "superlative") ??
  false;

/** Forms the table only ever tags comparative or superlative, with the degree when only one. */
const degreeOnlyForms = (
  forms: ReadonlyArray<WiktextractForm>,
): ReadonlyArray<DegreeForm> => {
  const plain = new Set(
    forms
      .filter((form) => !isDegreeForm(form))
      .map((form) => lookupKey(form.form)),
  );
  const degrees = new Map<string, Set<Degree>>();
  for (const form of forms.filter(isDegreeForm)) {
    const key = lookupKey(form.form);
    if (plain.has(key)) continue;
    const found = degrees.get(key) ?? new Set<Degree>();
    for (const tag of form.tags ?? []) {
      if (tag === "comparative" || tag === "superlative") found.add(tag);
    }
    degrees.set(key, found);
  }
  return [...degrees].map(([form, found]) =>
    found.size === 1 ? { form, degree: [...found][0]! } : { form },
  );
};

/**
 * The grammar of a noun or verb line: what the word's own tags, its canonical
 * form's tags (Russian) and the tags every sense shares (German, Polish) say.
 * A tag on only some senses describes those senses, not the word (`Apfel` is
 * not plural-only because one sense is).
 */
const lineFeatures = (
  raw: WiktextractEntry,
  pos: UdPos,
): string | undefined => {
  if (!FEATURE_POS.has(pos)) return undefined;
  const senses = (raw.senses ?? []).filter(
    (sense) =>
      !sense.tags?.includes("form-of") && !sense.tags?.includes("alt-of"),
  );
  const shared = senses.reduce<ReadonlySet<string> | undefined>(
    (common, sense) => {
      const tags = new Set(sense.tags ?? []);
      return common === undefined
        ? tags
        : new Set([...common].filter((tag) => tags.has(tag)));
    },
    undefined,
  );
  const canonical = (raw.forms ?? [])
    .filter((form) => form.tags?.includes("canonical"))
    .flatMap((form) => form.tags ?? []);
  return formatFeatures(
    featuresOfTags([...(raw.tags ?? []), ...canonical, ...(shared ?? [])]),
  );
};

const VALENCY = /\b(?:transitive|intransitive|ambitransitive|ditransitive)\b/u;

/**
 * The particle of a sense Wiktionary labels "(reflexive with się, ...)":
 * `się`, `sobie`. Undefined for other senses, and for a bare `reflexive`
 * tag, which doesn't say which particle.
 */
const reflexiveParticle = (sense: WiktextractSense): string | undefined => {
  const label = /^\(([^)]*)\)/u.exec(sense.raw_glosses?.[0] ?? "")?.[1];
  // "(transitive, reflexive with się) to guard": the plain verb means it too.
  return label === undefined || VALENCY.test(label)
    ? undefined
    : /(?:^|,\s*)reflexive with (\p{L}+)(?:,|$)/u.exec(label)?.[1];
};

/** Pure mapping of one wiktextract line (already known to be `rules.code`). */
export const transformEntry = (
  rules: LanguageRules,
  raw: WiktextractEntry,
): TransformResult => {
  const lemma = cleanWord(raw.word);
  const lemmaKey = lookupKey(lemma);
  if (raw.pos === "soft-redirect") {
    return {
      entry: undefined,
      formOf: [],
      parentGlosses: [],
      skippedSenses: {
        archaic: 0,
        "historical-stage": 0,
        "no-gloss": 0,
        placeholder: 0,
      },
      droppedForms: 0,
      redirect: {
        form: lemmaKey,
        targets: (raw.redirects ?? []).map(cleanWord),
      },
    };
  }
  const shownLemma = rules.stressedLemmas
    ? stressedLemma(lemma, raw.forms ?? [])
    : lemma;
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
  /** particle -> the reflexive senses with it, as an entry of their own */
  const reflexive = new Map<
    string,
    { senses: ReturnType<typeof makeSenseGroups>; derived: Array<DerivedSense> }
  >();

  for (const sense of raw.senses ?? []) {
    const outcome = classifySense(rules, lemma, sense);
    const particle =
      rules.reflexive === undefined ? undefined : reflexiveParticle(sense);
    let own = { senses, derived };
    if (
      particle !== undefined &&
      (outcome.kind === "gloss" || outcome.kind === "derived")
    ) {
      own = reflexive.get(particle) ?? {
        senses: makeSenseGroups(),
        derived: [],
      };
      reflexive.set(particle, own);
    }
    switch (outcome.kind) {
      case "skip": {
        skippedSenses[outcome.reason]++;
        if (!isLinkSense(rules, lemma, sense)) {
          senses.add(livingParents(rules, sense));
          if (outcome.reason === "historical-stage") {
            historicalSenses.add(glossPath(rules, sense));
          }
        }
        break;
      }
      case "derived": {
        own.senses.add([outcome.gloss]);
        const bases = outcome.bases.filter((b) => b !== "" && b !== lemmaKey);
        if (bases.length > 0) own.derived.push({ gloss: outcome.gloss, bases });
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
              ...(outcome.marked ? { marked: true as const } : {}),
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
        own.senses.add(
          path,
          synonymTargets(rules, outcome.gloss, sense.links ?? []).filter(
            (word) => lookupKey(word) !== lemmaKey,
          ),
        );
        break;
      }
    }
  }

  const { forms, participles, dropped } = collectForms(
    rules,
    lemma,
    raw.forms ?? [],
  );
  // `man` on the headword line of `Mann` ("obsolete"): the variant points here
  // only if it turns out to be no word of its own.
  for (const form of raw.forms ?? []) {
    if (!isMarkedAlternative(form)) continue;
    const key = lookupKey(form.form);
    if (key !== "" && key !== lemmaKey && !/\s/.test(key)) {
      formOf.push({
        form: key,
        lemma: lemmaKey,
        sourcePos: raw.pos,
        marked: true,
      });
    }
  }
  const features = lineFeatures(raw, toUdPos(raw.pos));
  const makeEntry = (
    entrySenses: ReadonlyArray<ImportSense>,
    derivedSenses: ReadonlyArray<DerivedSense>,
    particle?: string,
  ): ImportEntry => ({
    lemma:
      particle === undefined
        ? shownLemma
        : rules.reflexive === "before"
          ? `${particle} ${shownLemma}`
          : `${shownLemma} ${particle}`,
    page: lemma,
    pos: toUdPos(raw.pos),
    sourcePos: isLetterName(lemma, entrySenses) ? LETTER_NAME_POS : raw.pos,
    etymology: toEtymology(raw.etymology_number),
    senses: entrySenses,
    pronunciations: pickPronunciations(
      rules,
      raw.sounds ?? [],
      rubyReading(raw.word, raw.forms ?? []),
    ),
    // A reflexive entry is found by the verb's forms, the verb itself included.
    forms: particle === undefined ? forms : [...new Set([lemmaKey, ...forms])],
    derived: derivedSenses,
    verbalNouns: (raw.forms ?? [])
      .filter(isVerbalNounForm)
      .map((form) => lookupKey(form.form)),
    degreeForms: degreeOnlyForms(raw.forms ?? []),
    ...(participles.length > 0 ? { participleForms: participles } : {}),
    ...(features !== undefined ? { features } : {}),
    ...(particle !== undefined ? { reflexiveOf: shownLemma } : {}),
  });

  const reflexiveEntries = [...reflexive].flatMap(([particle, own]) =>
    own.senses.groups.size > 0
      ? [makeEntry(own.senses.senses(), own.derived, particle)]
      : [],
  );
  const withReflexive = reflexiveEntries.length > 0 ? { reflexiveEntries } : {};

  if (senses.groups.size === 0 && reflexiveEntries.length === 0) {
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
    entry:
      senses.groups.size > 0 ? makeEntry(senses.senses(), derived) : undefined,
    ...withReflexive,
    formOf: links,
    parentGlosses: [...parentGlosses],
    skippedSenses,
    droppedForms: dropped,
  };
};

/** Combining acute and grave, the stress marks of Russian and other Cyrillic dictionaries. */
const STRESS_MARKS = /[\u0300\u0301]/gu;

/**
 * The first `canonical` headword form that is `lemma` with stress marks
 * (`соба́ка`), or `lemma` itself. A canonical form that differs otherwise
 * (`к (k)`, a stray mark after a space) is not the lemma.
 */
const stressedLemma = (
  lemma: string,
  forms: ReadonlyArray<WiktextractForm>,
): string => {
  for (const form of forms) {
    if (!(form.tags ?? []).includes("canonical")) continue;
    const written = cleanWord(form.form);
    const plain = written
      .normalize("NFD")
      .replace(STRESS_MARKS, "")
      .normalize("NFC");
    if (plain === lemma && written !== lemma) return written;
  }
  return lemma;
};

/**
 * `entries.source_pos` of a one-letter noun about the letter: its first sense
 * names it (Russian `а` "the name of the Cyrillic letter А", then "the sound
 * expressed by the letter", "the first item in a list"). Lookups rank it with
 * the letter entries, after the word (`а` "but, and").
 */
export const LETTER_NAME_POS = "letter-name";

const LETTER_NAME = /^the name of the .*\bletter\b/i;

const isLetterName = (
  lemma: string,
  senses: ReadonlyArray<ImportSense>,
): boolean =>
  [...lemma].length === 1 && LETTER_NAME.test(senses[0]?.glosses[0] ?? "");

/** How weak a link is: a pointer or a marked spelling is weaker than a plain link. */
const weakness = (link: FormOfLink): number =>
  (link.pointer ? 1 : 0) + (link.marked ? 1 : 0);

/** One link per form and lemma; the strongest link to the same word wins. */
const dedupeLinks = (links: ReadonlyArray<FormOfLink>) => {
  if (links.length < 2) return links;
  const byKey = new Map<string, FormOfLink>();
  for (const link of links) {
    const k = `${link.form}\u0000${link.lemma}`;
    const seen = byKey.get(k);
    if (seen === undefined || weakness(link) < weakness(seen)) {
      byKey.set(k, link);
    }
  }
  return [...byKey.values()];
};
