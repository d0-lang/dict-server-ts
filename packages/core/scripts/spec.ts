/**
 * Writes the JSON Schemas in `spec/` from the Effect Schemas they mirror:
 * `bun run spec`. `spec.test.ts` fails when a file is stale.
 */
import { writeFileSync } from "node:fs";
import { SPEC_FILES } from "../src/spec.ts";

for (const [file, render] of SPEC_FILES) {
  writeFileSync(file, render());
  console.log(`wrote ${file}`);
}
