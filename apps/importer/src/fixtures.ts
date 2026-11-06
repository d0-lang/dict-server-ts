import { join } from "node:path";

/**
 * Real (trimmed) lines from the raw English Wiktionary extract, plus one
 * English entry whose translations mention `"lang_code": "pl"`. Also used by
 * the server's tests to build a small dictionary.
 */
export const PL_SAMPLE = join(
  import.meta.dirname,
  "fixtures",
  "pl-sample.jsonl",
);
