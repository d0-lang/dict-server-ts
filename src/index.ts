import { existsSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { makeWebHandler } from "./http/app.ts";

const { handler } = makeWebHandler();
const { port, languages } = loadConfig();

// Fail here, not with a 500 on every request.
for (const pair of languages) {
  if (!existsSync(`data/${pair}.sqlite`)) {
    console.error(
      `data/${pair}.sqlite is missing: build it (see README) or remove ${pair} from LANGUAGES`,
    );
    process.exit(1);
  }
}

Bun.serve({
  port,
  fetch: (request) => handler(request),
});

console.log(`dict server listening on http://localhost:${port}`);
