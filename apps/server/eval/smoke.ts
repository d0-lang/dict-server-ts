/**
 * Checks a running server against the dictionary files it was started with,
 * the way a client sees it: the key and signed metadata, then lookups of a
 * fixed spread of lemmas from each file, which must all find something. The
 * release-candidate workflow runs it against the image it built.
 *
 *   bun apps/server/eval/smoke.ts --url http://localhost:3000 --data data
 *
 * Exits with 1 and lists what failed.
 */
import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000" },
    data: { type: "string", default: "data" },
    "per-language": { type: "string", default: "20" },
    "wait-seconds": { type: "string", default: "120" },
  },
});
const base = values.url!.replace(/\/$/, "");
const perLanguage = Number(values["per-language"]);
const failures: Array<string> = [];

const fromBase64 = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Waits until the server answers, since it loads every dictionary first. */
const waitForServer = async () => {
  const deadline = Date.now() + Number(values["wait-seconds"]) * 1000;
  for (;;) {
    try {
      const response = await fetch(`${base}/v1/get-key`);
      if (response.ok) return (await response.json()) as { key: string };
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      console.error(
        `${base} did not answer within ${values["wait-seconds"]} s`,
      );
      process.exit(1);
    }
    await Bun.sleep(1000);
  }
};

/** The pairs in the data directory, as the server finds them. */
const pairs = readdirSync(values.data!)
  .filter((file) => file.endsWith(".sqlite"))
  .map((file) => file.slice(0, -".sqlite".length))
  .sort();

/** `count` lemmas spread over the file: single words a client could send. */
const sampleLemmas = (pair: string, count: number): Array<string> => {
  const db = new Database(join(values.data!, `${pair}.sqlite`), {
    readonly: true,
  });
  try {
    const lemmas = db
      .query<{ lemma: string }, []>(
        `SELECT lemma FROM entries
         WHERE source_pos <> 'grammar' AND lemma NOT LIKE '% %' AND length(lemma) <= 64
         ORDER BY id`,
      )
      .all()
      .map((row) => row.lemma);
    const step = Math.max(1, Math.floor(lemmas.length / count));
    return lemmas.filter((_, i) => i % step === 0).slice(0, count);
  } finally {
    db.close();
  }
};

const { key } = await waitForServer();

// Metadata: signed over the exact body, with our nonce, listing every file.
const nonce = crypto.randomUUID();
const metaResponse = await fetch(`${base}/v1/get-meta`, {
  headers: { "X-Nonce": nonce },
});
const body = new Uint8Array(await metaResponse.arrayBuffer());
const signature = metaResponse.headers.get("x-signature") ?? "";
const publicKey = await crypto.subtle.importKey(
  "raw",
  fromBase64(key),
  "Ed25519",
  false,
  ["verify"],
);
if (
  !(await crypto.subtle.verify(
    "Ed25519",
    publicKey,
    fromBase64(signature),
    body,
  ))
) {
  failures.push("get-meta: the signature does not verify");
}
const meta = JSON.parse(new TextDecoder().decode(body)) as {
  nonce: string;
  languages: Array<string>;
};
if (meta.nonce !== nonce) failures.push("get-meta: the nonce is not ours");
if ([...meta.languages].sort().join() !== pairs.join()) {
  failures.push(
    `get-meta: languages ${meta.languages.join(", ")}, files ${pairs.join(", ")}`,
  );
}

for (const pair of pairs) {
  const lemmas = sampleLemmas(pair, perLanguage);
  let found = 0;
  for (const word of lemmas) {
    const response = await fetch(`${base}/v1/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, lang: pair }),
    });
    const result = response.ok
      ? ((await response.json()) as { entries: Array<unknown> })
      : undefined;
    if (result === undefined) {
      failures.push(`${pair} ${word}: HTTP ${response.status}`);
    } else if (result.entries.length === 0) {
      failures.push(`${pair} ${word}: no entries`);
    } else {
      found++;
    }
  }
  console.log(`${pair}: ${found} of ${lemmas.length} lemmas found`);
  if (lemmas.length === 0) failures.push(`${pair}: no lemmas to look up`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("all checks passed");
