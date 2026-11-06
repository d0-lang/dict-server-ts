import { join } from "node:path";
import { Schema } from "effect";
import { Language } from "./language.ts";

const SPEC_DIR = join(import.meta.dirname, "..", "..", "..", "spec");

/** A JSON Schema file for `schema`'s encoded form, as written in the repo. */
const jsonSchema = (title: string, schema: Schema.Top): string => {
  const document = Schema.toJsonSchemaDocument(schema, {
    onExcessProperty: "error",
  });
  return `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title,
      ...document.schema,
      ...(Object.keys(document.definitions).length > 0
        ? { $defs: document.definitions }
        : {}),
    },
    null,
    2,
  )}\n`;
};

/** Files in `spec/` generated from TypeScript, with what they should contain. */
export const SPEC_FILES: ReadonlyArray<readonly [string, () => string]> = [
  [
    join(SPEC_DIR, "language.schema.json"),
    () =>
      jsonSchema("Language record (languages/<code>/language.toml)", Language),
  ],
];
