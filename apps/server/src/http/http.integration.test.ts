import { afterAll, assert, describe, it } from "@effect/vitest";
import { Base64 } from "effect/encoding";
import { DictHandlersMemory } from "./DictHandlers.ts";
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
    ]);

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

  const lookup = (query: string) =>
    handler(new Request(`http://localhost/v1/lookup${query}`));

  it("GET /v1/lookup returns entries, also for an inflected word", async () => {
    const response = await lookup("?word=PSA&lang=de_en");
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

  it("GET /v1/lookup returns segments for a split word", async () => {
    const response = await lookup(
      `?word=${encodeURIComponent("Gemüsefonds")}&lang=de_en`,
    );
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

  it("GET /v1/lookup accepts a context", async () => {
    const response = await lookup(
      `?word=Mutter&lang=de_en&context=${encodeURIComponent("Meine Mutter kocht.")}`,
    );
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as { entries: Array<unknown> };
    assert.strictEqual(body.entries.length, 2);
  });

  it("GET /v1/lookup returns no entries for an unknown word", async () => {
    const response = await lookup("?word=nope&lang=de_en");
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { entries: [] });
  });

  it("GET /v1/lookup rejects missing parameters", async () => {
    for (const query of [
      "",
      "?word=Mutter",
      "?lang=de_en",
      "?word=&lang=de_en",
    ]) {
      const response = await lookup(query);
      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(await response.json(), { error: "bad_request" });
    }
  });

  it("GET /v1/lookup rejects a language the server does not list", async () => {
    const response = await lookup("?word=Mutter&lang=xx_en");
    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(await response.json(), {
      error: "unsupported_lang",
    });
  });

  it("unknown route is not found", async () => {
    const response = await handler(new Request("http://localhost/v1/nope"));
    assert.strictEqual(response.status, 404);
  });
});
