import { Result } from "effect";
import {
  altOfLemmas,
  formOfLemmas,
  isAltOfSense,
  isArchaicSense,
  isFormOfSense,
  isGarbageSense,
  lineMentionsLanguage,
  senseTranslations,
  soundIsHistorical,
} from "./filter.ts";
import type { LanguageProfile } from "./languages.ts";
import { toUdPos } from "./pos.ts";
import {
  decodeWiktextractEntry,
  type WiktextractEntry,
} from "./wiktextract.ts";

const AUDIO_HOST = "upload.wikimedia.org";
const MAX_FORM_LENGTH = 300;
const SKIP_FORM_TAGS = new Set(["table-tags", "inflection-template"]);

export type PreparedSense = {
  readonly translations: ReadonlyArray<string>;
};

export type FormLink = {
  readonly form: string;
  readonly lemma: string;
  readonly pos: string;
};

export type PreparedEntry = {
  readonly lemma: string;
  readonly pos: string;
  readonly etymologyNumber: string;
  readonly ipa: ReadonlyArray<string>;
  readonly audio: ReadonlyArray<string>;
  readonly senses: ReadonlyArray<PreparedSense>;
  /** Surface forms, including the citation form. Duplicates are left for SQLite. */
  readonly forms: ReadonlyArray<string>;
};

export type ClassifyStats = {
  readonly decoded: number;
  readonly langMismatches: number;
  readonly badLines: number;
  readonly entries: number;
  readonly senses: number;
  readonly formsAttempted: number;
  readonly formOfEntries: number;
  readonly altOfEntries: number;
  readonly fallbackLinks: number;
  readonly sensesDroppedFormOf: number;
  readonly sensesDroppedAltOf: number;
  readonly sensesDroppedArchaic: number;
  readonly sensesDroppedEmpty: number;
  readonly unknownPos: Readonly<Record<string, number>>;
};

export const emptyClassifyStats = (): ClassifyStats => ({
  decoded: 0,
  langMismatches: 0,
  badLines: 0,
  entries: 0,
  senses: 0,
  formsAttempted: 0,
  formOfEntries: 0,
  altOfEntries: 0,
  fallbackLinks: 0,
  sensesDroppedFormOf: 0,
  sensesDroppedAltOf: 0,
  sensesDroppedArchaic: 0,
  sensesDroppedEmpty: 0,
  unknownPos: {},
});

export const addClassifyStats = (
  left: ClassifyStats,
  right: ClassifyStats,
): ClassifyStats => {
  const unknownPos = { ...left.unknownPos };
  for (const [pos, count] of Object.entries(right.unknownPos)) {
    unknownPos[pos] = (unknownPos[pos] ?? 0) + count;
  }
  return {
    decoded: left.decoded + right.decoded,
    langMismatches: left.langMismatches + right.langMismatches,
    badLines: left.badLines + right.badLines,
    entries: left.entries + right.entries,
    senses: left.senses + right.senses,
    formsAttempted: left.formsAttempted + right.formsAttempted,
    formOfEntries: left.formOfEntries + right.formOfEntries,
    altOfEntries: left.altOfEntries + right.altOfEntries,
    fallbackLinks: left.fallbackLinks + right.fallbackLinks,
    sensesDroppedFormOf: left.sensesDroppedFormOf + right.sensesDroppedFormOf,
    sensesDroppedAltOf: left.sensesDroppedAltOf + right.sensesDroppedAltOf,
    sensesDroppedArchaic:
      left.sensesDroppedArchaic + right.sensesDroppedArchaic,
    sensesDroppedEmpty: left.sensesDroppedEmpty + right.sensesDroppedEmpty,
    unknownPos,
  };
};

export type ClassifiedLine = {
  readonly entry: PreparedEntry | undefined;
  readonly fallbacks: ReadonlyArray<FormLink>;
  readonly stats: ClassifyStats;
};

const bump = (
  stats: ClassifyStats,
  patch: Partial<Omit<ClassifyStats, "unknownPos">>,
  unknownPos?: string,
): ClassifyStats => {
  const next = { ...stats, ...patch };
  if (unknownPos === undefined) {
    return next;
  }
  return {
    ...next,
    unknownPos: {
      ...stats.unknownPos,
      [unknownPos]: (stats.unknownPos[unknownPos] ?? 0) + 1,
    },
  };
};

const uniqueKeepOrder = (
  values: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
};

const audioUrl = (
  sound: {
    readonly ogg_url?: string | null;
    readonly mp3_url?: string | null;
    readonly tags?: ReadonlyArray<string> | null;
  },
  profile: LanguageProfile,
): string | undefined => {
  if (soundIsHistorical(sound.tags, profile)) {
    return undefined;
  }
  const url = sound.ogg_url ?? sound.mp3_url;
  if (url === undefined || url === null || url.length === 0) {
    return undefined;
  }
  try {
    const host = new URL(url).host;
    if (host !== AUDIO_HOST) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return url;
};

const pronunciations = (
  entry: WiktextractEntry,
  profile: LanguageProfile,
): {
  readonly ipa: ReadonlyArray<string>;
  readonly audio: ReadonlyArray<string>;
} => {
  const ipa: string[] = [];
  const audio: string[] = [];
  for (const sound of entry.sounds ?? []) {
    if (soundIsHistorical(sound.tags, profile)) {
      continue;
    }
    const pronunciation = sound.ipa?.trim();
    if (pronunciation !== undefined && pronunciation.length > 0) {
      ipa.push(pronunciation);
    }
    const url = audioUrl(sound, profile);
    if (url !== undefined) {
      audio.push(url);
    }
  }
  return { ipa: uniqueKeepOrder(ipa), audio: uniqueKeepOrder(audio) };
};

/**
 * Surface form worth indexing. `-` is wiktextract's "this form does not exist".
 * `table-tags` / `inflection-template` rows are template bookkeeping (`no-table-tags`,
 * `pl-decl-noun-masc-inani`), not words.
 */
export const acceptForm = (
  form: string,
  tags?: ReadonlyArray<string> | null,
): string | undefined => {
  if (tags?.some((tag) => SKIP_FORM_TAGS.has(tag))) {
    return undefined;
  }
  const trimmed = form.normalize("NFC").trim();
  if (
    trimmed.length === 0 ||
    trimmed === "-" ||
    trimmed.length > MAX_FORM_LENGTH ||
    trimmed.includes("{")
  ) {
    return undefined;
  }
  return trimmed;
};

const etymologyNumberOf = (entry: WiktextractEntry): string => {
  const value = entry.etymology_number;
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return String(value);
};

const classifyDecoded = (
  entry: WiktextractEntry,
  profile: LanguageProfile,
): ClassifiedLine => {
  let stats = bump(emptyClassifyStats(), { decoded: 1 });
  if (entry.lang_code !== profile.code) {
    return {
      entry: undefined,
      fallbacks: [],
      stats: bump(stats, { langMismatches: 1 }),
    };
  }

  const lemma = acceptForm(entry.word ?? "", undefined);
  const sourcePos = entry.pos?.trim();
  if (
    lemma === undefined ||
    sourcePos === undefined ||
    sourcePos.length === 0
  ) {
    return { entry: undefined, fallbacks: [], stats };
  }

  const mapped = toUdPos(sourcePos);
  if (!mapped.mapped) {
    stats = bump(stats, {}, sourcePos);
  }

  const senses: PreparedSense[] = [];
  const fallbacks: FormLink[] = [];
  let droppedFormOf = 0;
  let droppedAltOf = 0;
  let droppedArchaic = 0;
  let droppedEmpty = 0;
  let sawFormOf = false;
  let sawAltOf = false;

  for (const sense of entry.senses ?? []) {
    if (isFormOfSense(sense)) {
      sawFormOf = true;
      droppedFormOf += 1;
      if (!isArchaicSense(entry, sense, profile)) {
        for (const target of formOfLemmas(sense)) {
          fallbacks.push({ form: lemma, lemma: target, pos: mapped.ud });
        }
      }
      continue;
    }
    if (isAltOfSense(sense)) {
      sawAltOf = true;
      droppedAltOf += 1;
      if (!isArchaicSense(entry, sense, profile)) {
        for (const target of altOfLemmas(sense)) {
          fallbacks.push({ form: lemma, lemma: target, pos: mapped.ud });
        }
      }
      continue;
    }
    if (isArchaicSense(entry, sense, profile)) {
      droppedArchaic += 1;
      continue;
    }
    if (isGarbageSense(entry, sense, profile)) {
      droppedEmpty += 1;
      continue;
    }
    senses.push({ translations: senseTranslations(sense) });
  }

  stats = bump(stats, {
    sensesDroppedFormOf: droppedFormOf,
    sensesDroppedAltOf: droppedAltOf,
    sensesDroppedArchaic: droppedArchaic,
    sensesDroppedEmpty: droppedEmpty,
    fallbackLinks: fallbacks.length,
    formOfEntries: senses.length === 0 && sawFormOf ? 1 : 0,
    altOfEntries: senses.length === 0 && sawAltOf && !sawFormOf ? 1 : 0,
  });

  if (senses.length === 0) {
    return { entry: undefined, fallbacks, stats };
  }

  const forms: string[] = [lemma];
  for (const form of entry.forms ?? []) {
    const surface =
      form.form === undefined || form.form === null
        ? undefined
        : acceptForm(form.form, form.tags);
    if (surface !== undefined) {
      forms.push(surface);
    }
  }

  const { audio, ipa } = pronunciations(entry, profile);
  stats = bump(stats, {
    entries: 1,
    senses: senses.length,
    formsAttempted: forms.length,
  });

  return {
    entry: {
      lemma,
      pos: mapped.ud,
      etymologyNumber: etymologyNumberOf(entry),
      ipa,
      audio,
      senses,
      forms,
    },
    fallbacks,
    stats,
  };
};

export const classifyLine = (
  line: string,
  profile: LanguageProfile,
): ClassifiedLine => {
  if (!lineMentionsLanguage(line, profile.code)) {
    return { entry: undefined, fallbacks: [], stats: emptyClassifyStats() };
  }
  const parsed = Result.try({
    try: () => decodeWiktextractEntry(JSON.parse(line)),
    catch: () => undefined,
  });
  if (parsed._tag === "Failure") {
    return {
      entry: undefined,
      fallbacks: [],
      stats: bump(emptyClassifyStats(), { badLines: 1 }),
    };
  }
  return classifyDecoded(parsed.success, profile);
};
