import { Exit, Schema } from "effect";

/**
 * The subset of a raw wiktextract JSONL line the importer reads. Unknown keys
 * are ignored and almost everything is optional, because the raw English
 * Wiktionary dump is very uneven (see https://kaikki.org/dictionary/rawdata.html
 * and the wiktextract README for the full shape).
 */

const Tags = Schema.optionalKey(Schema.Array(Schema.String));

const WordLink = Schema.Struct({
  word: Schema.String,
});

export const WiktextractSense = Schema.Struct({
  /** The path from the top parent gloss down to this sense. */
  glosses: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Same path with its labels, like "(obsolete) ...", when any level has one. */
  raw_glosses: Schema.optionalKey(Schema.Array(Schema.String)),
  tags: Tags,
  /** `[text, target]` pairs for the whole path; targets look like `dom#Polish`. */
  links: Schema.optionalKey(Schema.Array(Schema.Array(Schema.String))),
  /** `form-of` senses point at their lemma here ("domu" -> "dom"). */
  form_of: Schema.optionalKey(Schema.Array(WordLink)),
  /** `alt-of` senses point at the main spelling here. */
  alt_of: Schema.optionalKey(Schema.Array(WordLink)),
});
export type WiktextractSense = typeof WiktextractSense.Type;

export const WiktextractForm = Schema.Struct({
  form: Schema.String,
  tags: Tags,
  source: Schema.optionalKey(Schema.String),
  /** Readings over the form's kanji, as `[base, kana]` pairs (Japanese `[["食", "た"]]` for `食べる`). */
  ruby: Schema.optionalKey(Schema.Array(Schema.Array(Schema.String))),
});
export type WiktextractForm = typeof WiktextractForm.Type;

export const WiktextractSound = Schema.Struct({
  ipa: Schema.optionalKey(Schema.String),
  ogg_url: Schema.optionalKey(Schema.String),
  mp3_url: Schema.optionalKey(Schema.String),
  tags: Tags,
  /** Regional variant label, e.g. "Central Greater Poland". */
  note: Schema.optionalKey(Schema.String),
});
export type WiktextractSound = typeof WiktextractSound.Type;

export const WiktextractEntry = Schema.Struct({
  word: Schema.String,
  pos: Schema.String,
  lang_code: Schema.String,
  /** Tags of the whole word; most languages put its gender on the senses instead. */
  tags: Tags,
  etymology_number: Schema.optionalKey(
    Schema.Union([Schema.Number, Schema.String]),
  ),
  senses: Schema.optionalKey(Schema.Array(WiktextractSense)),
  forms: Schema.optionalKey(Schema.Array(WiktextractForm)),
  /** A soft redirect's targets: the page only points at these words (Japanese kana -> kanji). */
  redirects: Schema.optionalKey(Schema.Array(Schema.String)),
  sounds: Schema.optionalKey(Schema.Array(WiktextractSound)),
  /** The headword line's templates (`ja-verb-suru` for a Japanese する-verb). */
  head_templates: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String })),
  ),
});
export type WiktextractEntry = typeof WiktextractEntry.Type;

const decodeEntry = Schema.decodeUnknownExit(WiktextractEntry);

/**
 * Cheap pre-filter on the raw line before `JSON.parse`. The full dump is
 * ~25 GB of JSON for every language; parsing only lines that mention the
 * language code is what makes streaming it practical. A match is only a
 * candidate: nested translation lists also contain `lang_code`, so the
 * top-level field is checked again after parsing.
 */
const lineMayBeLanguage = (line: string, langCode: string): boolean =>
  line.includes(`"lang_code": "${langCode}"`) ||
  line.includes(`"lang_code":"${langCode}"`);

const parseJson = (line: string): { readonly ok: boolean; value?: unknown } => {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return { ok: false };
  }
};

/**
 * One raw line: its entry when it belongs to `langCode`, `"other-language"`
 * when it doesn't, or `"invalid"` when it can't be parsed or decoded.
 */
export const parseLine = (
  line: string,
  langCode: string,
): WiktextractEntry | "other-language" | "invalid" => {
  if (!lineMayBeLanguage(line, langCode)) return "other-language";
  const json = parseJson(line);
  if (!json.ok) return "invalid";
  const value = json.value;
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { lang_code?: unknown }).lang_code !== langCode
  ) {
    return "other-language"; // the code only appeared nested (e.g. in translations)
  }
  const decoded = decodeEntry(value);
  return Exit.isSuccess(decoded) ? decoded.value : "invalid";
};
