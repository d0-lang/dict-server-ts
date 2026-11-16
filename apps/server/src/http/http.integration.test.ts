import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { Base64 } from "effect/encoding";
import { DictHandlersMemory, dictHandlersMemory } from "./DictHandlers.ts";
import { makeWebHandler } from "./app.ts";

const verifyEd25519 = async (
  publicKeyBase64: string,
  body: Uint8Array,
  signatureBase64: string,
) => {
  const publicKeyBytes = Base64.decode(publicKeyBase64);
  const signatureBytes = Base64.decode(signatureBase64);
  if (publicKeyBytes._tag === "Failure" || signatureBytes._tag === "Failure") {
    return false;
  }
  const publicKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(publicKeyBytes.success),
    "Ed25519",
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    publicKey,
    new Uint8Array(signatureBytes.success),
    new Uint8Array(body),
  );
};

describe("HTTP API", () => {
  const { handler, dispose } = makeWebHandler(DictHandlersMemory);

  afterAll(() => dispose());

  it("GET /v1/get-key returns a public key", async () => {
    const response = await handler(new Request("http://localhost/v1/get-key"));
    const body = (await response.json()) as { key: string };
    assert.strictEqual(response.status, 200);
    assert.isString(body.key);
    assert.isAbove(body.key.length, 0);
  });

  it("GET /v1/get-meta requires X-Nonce", async () => {
    const response = await handler(new Request("http://localhost/v1/get-meta"));
    assert.strictEqual(response.status, 400);
  });

  it("GET /v1/get-meta refuses an X-Nonce over 128 characters", async () => {
    const meta = (nonce: string) =>
      handler(
        new Request("http://localhost/v1/get-meta", {
          headers: { "X-Nonce": nonce },
        }),
      );
    assert.strictEqual((await meta("n".repeat(128))).status, 200);
    assert.strictEqual((await meta("n".repeat(129))).status, 400);
  });

  it("GET /v1/get-meta signs the exact JSON body", async () => {
    const nonce = "black-box-nonce";
    const metaResponse = await handler(
      new Request("http://localhost/v1/get-meta", {
        headers: { "X-Nonce": nonce, Origin: "http://example.com" },
      }),
    );
    const body = await metaResponse.text();
    const signature = metaResponse.headers.get("x-signature");
    assert.strictEqual(metaResponse.status, 200);
    assert.isString(signature);
    assert.include(
      metaResponse.headers.get("access-control-expose-headers") ?? "",
      "x-signature",
    );

    const parsed = JSON.parse(body) as {
      nonce: string;
      name: string;
      languages: Array<string>;
    };
    assert.strictEqual(parsed.nonce, nonce);
    assert.strictEqual(parsed.name, "dict poc");
    assert.deepStrictEqual(parsed.languages, ["de_en"]);
    assert.deepStrictEqual((parsed as { features?: Array<string> }).features, [
      "context",
      "context-match",
      "labels",
    ]);
    assert.deepStrictEqual((parsed as { sources?: unknown }).sources, [
      {
        name: "Wiktionary",
        url: "https://en.wiktionary.org/",
        license: "CC-BY-SA-4.0",
        license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
      },
      { name: "Wikimedia Commons", url: "https://commons.wikimedia.org/" },
    ]);

    // The documents' source text, not short texts.
    const sha256 = (file: string) =>
      new Bun.CryptoHasher("sha256")
        .update(readFileSync(join(import.meta.dirname, "../../../..", file)))
        .digest("hex");
    assert.deepStrictEqual((parsed as { legal?: unknown }).legal, {
      privacy_link: "https://example.invalid/privacy",
      privacy_hash: sha256("legal/privacy.example.md"),
      tos_link: "https://example.invalid/tos",
      tos_hash: sha256("legal/terms.example.md"),
    });

    const keyResponse = await handler(
      new Request("http://localhost/v1/get-key"),
    );
    const { key } = (await keyResponse.json()) as { key: string };
    assert.isTrue(
      await verifyEd25519(key, new TextEncoder().encode(body), signature!),
    );
    assert.isFalse(
      await verifyEd25519(
        key,
        new TextEncoder().encode(`${body} `),
        signature!,
      ),
    );
  });

  const REPORT_URL =
    "https://github.com/d0-lang/dict-server-ts/issues/new?template=word.yml";

  const getMeta = (h: typeof handler) =>
    h(
      new Request("http://localhost/v1/get-meta", {
        headers: { "X-Nonce": "report-nonce" },
      }),
    );

  it("GET /v1/get-meta leaves report_url out when REPORT_URL is unset", async () => {
    const body = await (await getMeta(handler)).text();
    assert.notProperty(JSON.parse(body), "report_url");
  });

  it("GET /v1/get-meta signs report_url, after sources and before legal", async () => {
    const withReport = makeWebHandler(
      dictHandlersMemory({ reportUrl: REPORT_URL }),
    );
    try {
      const response = await getMeta(withReport.handler);
      const body = await response.text();
      const parsed = JSON.parse(body) as Record<string, unknown>;
      assert.strictEqual(parsed["report_url"], REPORT_URL);
      assert.deepStrictEqual(Object.keys(parsed).slice(-3), [
        "sources",
        "report_url",
        "legal",
      ]);
      const keyResponse = await withReport.handler(
        new Request("http://localhost/v1/get-key"),
      );
      const { key } = (await keyResponse.json()) as { key: string };
      assert.isTrue(
        await verifyEd25519(
          key,
          new TextEncoder().encode(body),
          response.headers.get("x-signature")!,
        ),
      );
    } finally {
      await withReport.dispose();
    }
  });

  it("refuses a REPORT_URL that isn't an absolute https URL", async () => {
    const withReport = makeWebHandler(
      dictHandlersMemory({ reportUrl: "http://example.org/report" }),
    );
    try {
      const response = await getMeta(withReport.handler).catch(() => undefined);
      assert.notStrictEqual(response?.status, 200);
    } finally {
      await withReport.dispose();
    }
  });

  const lookupRaw = (body: string) =>
    handler(
      new Request("http://localhost/v1/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );

  const lookup = (body: unknown) => lookupRaw(JSON.stringify(body));

  it("POST /v1/lookup returns entries, also for an inflected word", async () => {
    const response = await lookup({ word: "PSA", lang: "de_en" });
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      entries: [
        {
          lemma: "pies",
          pos: "NOUN",
          pron: { ipa: ["/pjɛs/"] },
          senses: [{ glosses: ["dog"] }],
        },
      ],
    });
  });

  it("POST /v1/lookup returns segments for a split word", async () => {
    const response = await lookup({ word: "Gemüsefonds", lang: "de_en" });
    const body = (await response.json()) as {
      entries: Array<{ lemma: string }>;
      segments: Array<{ text: string; entries?: Array<number> }>;
    };
    assert.deepStrictEqual(
      body.entries.map((entry) => entry.lemma),
      ["Gemüse", "Fonds", "Fond"],
    );
    assert.deepStrictEqual(body.segments, [
      { text: "Gemüse", entries: [0] },
      { text: "fonds", entries: [1, 2] },
    ]);
  });

  it("POST /v1/lookup links an entry's pages and its recordings' file pages", async () => {
    const response = await lookup({ word: "Mutter", lang: "de_en" });
    const body = (await response.json()) as {
      entries: Array<{
        sources?: Array<string>;
        pron?: { audio?: Array<{ url: string; source?: string }> };
      }>;
    };
    assert.deepStrictEqual(body.entries[0]!.sources, [
      "https://en.wiktionary.org/wiki/Mutter#German",
    ]);
    assert.deepStrictEqual(body.entries[0]!.pron?.audio, [
      {
        url: "https://upload.wikimedia.org/wikipedia/commons/0/03/De-Mutter.ogg",
        source: "https://commons.wikimedia.org/wiki/File:De-Mutter.ogg",
      },
    ]);
  });

  it("GET /v1/get-labels explains the labels of the pairs it serves", async () => {
    const response = await handler(
      new Request("http://localhost/v1/get-labels?lang=ru_en,de_en"),
    );
    assert.strictEqual(response.status, 200);
    assert.isNull(response.headers.get("x-signature"));
    // ru_en isn't served here, so it's left out.
    assert.deepStrictEqual(await response.json(), {
      labels: { de_en: { c: { name: "common gender" } } },
    });
  });

  it("GET /v1/get-labels needs a pair", async () => {
    for (const query of ["", "?lang=", "?lang=,"]) {
      const response = await handler(
        new Request(`http://localhost/v1/get-labels${query}`),
      );
      assert.strictEqual(response.status, 400, query);
      assert.deepStrictEqual(await response.json(), { error: "bad_request" });
    }
  });

  it("POST /v1/lookup accepts a context", async () => {
    const response = await lookup({
      word: "Mutter",
      lang: "de_en",
      context: "Meine Mutter kocht.",
      at: 1,
    });
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as { entries: Array<unknown> };
    assert.strictEqual(body.entries.length, 2);
  });

  it("POST /v1/lookup ignores fields it does not know", async () => {
    const response = await lookup({
      word: "Mutter",
      lang: "de_en",
      context: "Meine Mutter kocht.",
      later: true,
    });
    assert.strictEqual(response.status, 200);
  });

  it("POST /v1/lookup takes `word` and `context` up to the protocol's caps", async () => {
    const response = await lookup({
      word: "M".repeat(64),
      lang: "de_en",
      context: "M".repeat(500),
      at: 500,
    });
    assert.strictEqual(response.status, 200);
  });

  it("POST /v1/lookup rejects what is over the caps, and a bad `at`", async () => {
    for (const body of [
      { word: "M".repeat(65), lang: "de_en" },
      // UTF-16 code units: 33 characters outside the BMP are 66 units.
      { word: "𝕄".repeat(33), lang: "de_en" },
      { word: "Mutter", lang: "de_en", context: "M".repeat(501) },
      { word: "Mutter", lang: "de_en", context: "Mutter", at: "second" },
      { word: "Mutter", lang: "de_en", context: "Mutter", at: 0 },
      { word: "Mutter", lang: "de_en", context: "Mutter", at: 1.5 },
      { word: "Mutter", lang: "de_en", context: "Mutter", at: 501 },
    ]) {
      const response = await lookup(body);
      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(await response.json(), { error: "bad_request" });
    }
  });

  it("POST /v1/lookup returns no entries for an unknown word", async () => {
    const response = await lookup({ word: "nope", lang: "de_en" });
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { entries: [] });
  });

  it("POST /v1/lookup rejects missing or mistyped fields", async () => {
    for (const body of [
      {},
      { word: "Mutter" },
      { lang: "de_en" },
      { word: "", lang: "de_en" },
      { word: 7, lang: "de_en" },
      { word: "Mutter", lang: "de_en", context: 7 },
    ]) {
      const response = await lookup(body);
      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(await response.json(), { error: "bad_request" });
    }
  });

  it("POST /v1/lookup rejects a body that is not a JSON object", async () => {
    for (const body of ["", "not json", "[]", '"Mutter"']) {
      const response = await lookupRaw(body);
      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(await response.json(), { error: "bad_request" });
    }
  });

  it("POST /v1/lookup rejects a language the server does not list", async () => {
    const response = await lookup({ word: "Mutter", lang: "xx_en" });
    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(await response.json(), {
      error: "unsupported_lang",
    });
  });

  it("GET /v1/lookup is gone, so a word cannot be put in a URL", async () => {
    const response = await handler(
      new Request("http://localhost/v1/lookup?word=Mutter&lang=de_en"),
    );
    assert.strictEqual(response.status, 404);
  });

  it("unknown route is not found", async () => {
    const response = await handler(new Request("http://localhost/v1/nope"));
    assert.strictEqual(response.status, 404);
  });
});
