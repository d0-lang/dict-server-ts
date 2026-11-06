import { existsSync } from "node:fs";
import { DATA_DIR, loadConfig } from "./config.ts";
import { makeWebHandler } from "./http/app.ts";

const { handler } = makeWebHandler();
const { port, languages } = loadConfig();

// Fail here, not with a 500 on every request.
if (languages.length === 0) {
  console.error(
    `no dictionaries in ${DATA_DIR}/: build one (see README) or set LANGUAGES`,
  );
  process.exit(1);
}
for (const pair of languages) {
  if (!existsSync(`${DATA_DIR}/${pair}.sqlite`)) {
    console.error(
      `${DATA_DIR}/${pair}.sqlite is missing: build it (see README) or remove ${pair} from LANGUAGES`,
    );
    process.exit(1);
  }
}

console.log(`serving ${languages.join(", ")}`);

Bun.serve({
  port,
  fetch: (request) => handler(request),
});

console.log(`dict server listening on http://localhost:${port}`);
