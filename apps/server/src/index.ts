import { existsSync } from "node:fs";
import { Effect, References, Result } from "effect";
import { DATA_DIR, loadConfig } from "./config.ts";
import { makeWebHandler } from "./http/app.ts";
import { legalSection } from "./legal.ts";

const { handler } = makeWebHandler();
const config = loadConfig();
const { port, languages } = config;

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

// A legal document the handlers can't read is only a 500 on every request,
// so check them here too. The handlers log the placeholder warnings.
const legal = await Effect.runPromise(
  legalSection(config).pipe(
    Effect.result,
    Effect.provideService(References.MinimumLogLevel, "Error"),
  ),
);
if (Result.isFailure(legal)) {
  console.error(legal.failure.message);
  process.exit(1);
}

console.log(`serving ${languages.join(", ")}`);

Bun.serve({
  port,
  fetch: (request) => handler(request),
});

console.log(`dict server listening on http://localhost:${port}`);
