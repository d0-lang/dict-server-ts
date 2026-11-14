import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { LANGUAGES_DIR, type Language } from "./language.ts";

/**
 * What the labels next to a headword mean (`pf` "perfective"), for the
 * protocol's `/v1/get-labels`. Written in the pair's target language, kept
 * with the language data:
 *
 * - `languages/labels.<target>.toml`: a name for each label every language
 *   shares (`m`, `anim`, `pf`), in that target language;
 * - `languages/<code>/labels.toml`: the language's own longer texts, and any
 *   name it says differently. A key there may give only `text`.
 *
 * Each file is a table per label string, as an entry's `labels` shows it
 * (`[pf]`, `["impf/pf"]`).
 */

/** `name` at most 60 characters, `text` at most 1000 (UTF-16 code units), as the protocol allows. */
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60));
const Text = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1000),
);

export const LabelExplanation = Schema.Struct({
  name: Name,
  text: Schema.optionalKey(Text),
});
export type LabelExplanation = typeof LabelExplanation.Type;

const DefaultsFile = Schema.Record(Schema.String, LabelExplanation);
const LanguageFile = Schema.Record(
  Schema.String,
  Schema.Struct({
    name: Schema.optionalKey(Name),
    text: Schema.optionalKey(Text),
  }),
);

/** Label string -> its explanation. */
export type Labels = Readonly<Record<string, LabelExplanation>>;

export const defaultLabelsFile = (target: string, dir = LANGUAGES_DIR) =>
  join(dir, `labels.${target}.toml`);

export const languageLabelsFile = (code: string, dir = LANGUAGES_DIR) =>
  join(dir, code, "labels.toml");

const readToml = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  file: string,
): S["Type"] | undefined => {
  if (!existsSync(file)) return undefined;
  try {
    return Schema.decodeUnknownSync(schema)(
      Bun.TOML.parse(readFileSync(file, "utf8")),
      { onExcessProperty: "error" },
    );
  } catch (cause) {
    throw new Error(
      `${file}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
};

/**
 * The explanations a language's labels have: the target language's names,
 * with the language's own file over them. Throws when a file is invalid, or
 * when the language's file gives a label no name and the defaults have none.
 */
export const readLabels = (language: Language, dir = LANGUAGES_DIR): Labels => {
  const defaults = readToml(
    DefaultsFile,
    defaultLabelsFile(language.target, dir),
  );
  const own = readToml(LanguageFile, languageLabelsFile(language.code, dir));
  const labels: Record<string, LabelExplanation> = { ...defaults };
  for (const [label, entry] of Object.entries(own ?? {})) {
    const name = entry.name ?? defaults?.[label]?.name;
    if (name === undefined) {
      throw new Error(
        `${languageLabelsFile(language.code, dir)}: "${label}" has no name, and ${defaultLabelsFile(language.target, dir)} has none either`,
      );
    }
    const text = entry.text ?? defaults?.[label]?.text;
    labels[label] = text === undefined ? { name } : { name, text };
  }
  return labels;
};

/**
 * The explanation of a label string. A combined one the files don't list
 * (`m/f`, several values of one feature) is named by its parts, joined with
 * "or" (`masculine or feminine`, `masculine, feminine or neuter`), when each
 * part has a name and the result fits.
 */
export const explainLabel = (
  labels: Labels,
  label: string,
): LabelExplanation | undefined => {
  const listed = labels[label];
  if (listed !== undefined) return listed;
  const parts = label.split("/");
  if (parts.length < 2) return undefined;
  const names = parts.map((part) => labels[part]?.name);
  if (names.some((name) => name === undefined)) return undefined;
  const name = `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
  return name.length <= 60 ? { name } : undefined;
};
