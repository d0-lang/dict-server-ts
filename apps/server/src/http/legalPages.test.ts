import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import type { AppConfigValues } from "../config.ts";
import { sha256Hex } from "../legal.ts";
import { makeWebHandler } from "./app.ts";
import { legalPage } from "./legalPages.ts";
import { dictHandlersMemory, legalPagesMemory } from "./testing.ts";

const serve = (config: Partial<AppConfigValues>) =>
  makeWebHandler(dictHandlersMemory(config), legalPagesMemory(config));

const dir = mkdtempSync(join(tmpdir(), "dict-legal-pages-"));
const privacyFile = join(dir, "privacy.md");
const tosFile = join(dir, "terms.md");
writeFileSync(
  privacyFile,
  "# Privacy policy\n\nWrite to contact@example.org.\n\n## In short\n\n- **No** cookies.\n",
);
writeFileSync(tosFile, "# Terms of use\n\nBe kind.\n");

describe("legal pages", () => {
  const on = serve({ privacyFile, tosFile, name: "Test <server>" });
  const off = serve({ includeLegal: false });
  afterAll(() => Promise.all([on.dispose(), off.dispose()]));

  it("GET /privacy renders the file whose hash get-meta sends", async () => {
    const response = await on.handler(new Request("http://localhost/privacy"));
    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get("content-type"),
      "text/html; charset=utf-8",
    );
    const page = await response.text();
    assert.include(page, "<title>Privacy policy · Test &lt;server&gt;</title>");
    assert.include(page, "<h2>In short</h2>");
    assert.include(page, "<strong>No</strong> cookies.");
    assert.include(page, '<a href="mailto:contact@example.org">');

    const meta = await on.handler(
      new Request("http://localhost/v1/get-meta", {
        headers: { "x-nonce": "pages" },
      }),
    );
    const { legal } = (await meta.json()) as {
      legal: { privacy_hash: string };
    };
    assert.strictEqual(
      legal.privacy_hash,
      sha256Hex(new Uint8Array(await Bun.file(privacyFile).arrayBuffer())),
    );
  });

  it("GET /terms renders the terms, and both pages link to each other", async () => {
    const response = await on.handler(new Request("http://localhost/terms"));
    assert.strictEqual(response.status, 200);
    const page = await response.text();
    assert.include(page, "<h1>Terms of use</h1>");
    assert.include(page, '<a href="/privacy">Privacy policy</a>');
    assert.include(page, '<span aria-current="page">Terms</span>');
  });

  it("the pages run nothing and load nothing", async () => {
    const response = await on.handler(new Request("http://localhost/privacy"));
    assert.strictEqual(
      response.headers.get("content-security-policy"),
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    assert.strictEqual(
      response.headers.get("x-content-type-options"),
      "nosniff",
    );
  });

  it("are not served with INCLUDE_LEGAL off", async () => {
    for (const path of ["/privacy", "/terms"]) {
      const response = await off.handler(
        new Request(`http://localhost${path}`),
      );
      assert.strictEqual(response.status, 404);
    }
  });
});

describe("legalPage", () => {
  it("shows raw HTML in a document as text", () => {
    const page = legalPage(
      '# Privacy\n\n<script>alert(1)</script>\n\nText <img src=x onerror="alert(1)"> here.\n',
      "dict",
      "privacy",
    );
    assert.notInclude(page, "<script>");
    assert.notInclude(page, "<img");
    assert.include(page, "&lt;script&gt;");
  });

  it("falls back to a title when the document has no heading", () => {
    assert.include(
      legalPage("Be kind.\n", "dict", "terms"),
      "<title>Terms · dict</title>",
    );
  });
});
