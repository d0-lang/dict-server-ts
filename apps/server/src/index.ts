import { existsSync } from "node:fs";
import { Effect, References, Result } from "effect";
import { DATA_DIR, loadConfig } from "./config.ts";
import { makeWebHandler } from "./http/app.ts";
import { legalSection } from "./legal.ts";
import { reportUrl } from "./report.ts";

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
if (legal.success === undefined) {
  console.log("INCLUDE_LEGAL is off: clients will treat this as a test server");
}

// So would a report link that isn't an absolute https URL.
const report = await Effect.runPromise(
  reportUrl(config.reportUrl).pipe(Effect.result),
);
if (Result.isFailure(report)) {
  console.error(report.failure.message);
  process.exit(1);
}

console.log(`serving ${languages.join(", ")}`);

// Open the dictionaries and load the analyzers before listening, so the first
// lookups don't wait for them and a load that fails stops the server here,
// not every request after.
try {
  await handler(new Request("http://localhost/v1/get-key"));
} catch (error) {
  console.error(error);
  process.exit(1);
}

Bun.serve({
  port,
  // A lookup body is a few KB at most (64 + 500 code units, JSON-escaped);
  // Bun's default is 128 MB.
  maxRequestBodySize: 16 * 1024,
  // Above nginx's default upstream keepalive (60 s), so a proxy in front
  // closes an idle connection before the server does. Bun's default of 10 s
  // made clients wait under load.
  idleTimeout: 75,
  fetch: (request) => handler(request),
});

console.log(`dict server listening on http://localhost:${port}`);
