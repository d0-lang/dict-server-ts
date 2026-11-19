import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { AppConfig } from "../config.ts";
import { readLegalDocuments } from "../legal.ts";

/**
 * `GET /privacy` and `GET /terms`: the privacy policy and terms as web pages,
 * rendered from the same files whose hashes the `legal` section sends, so an
 * operator can point `PRIVACY_LINK` and `TOS_LINK` here instead of hosting
 * the texts elsewhere. Only with `INCLUDE_LEGAL=true`: without it the files
 * are the unfilled templates, and both paths answer 404.
 */
export const LegalPages = HttpRouter.addAll(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    if (!config.includeLegal) return [];
    // index.ts has already checked the files can be read.
    const { privacy, terms } = yield* readLegalDocuments(config).pipe(
      Effect.orDie,
    );
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    const privacyPage = legalPage(decode(privacy), config.name, "privacy");
    const termsPage = legalPage(decode(terms), config.name, "terms");
    return [
      HttpRouter.route("GET", "/privacy", respond(privacyPage)),
      HttpRouter.route("GET", "/terms", respond(termsPage)),
    ];
  }),
);

/** `LegalPages` on the configuration from the environment. */
export const LegalPagesLive = LegalPages.pipe(Layer.provide(AppConfig.layer));

const respond = (page: string) =>
  Effect.sync(() =>
    HttpServerResponse.text(page, {
      contentType: "text/html; charset=utf-8",
      headers: {
        // The page is text and one inline stylesheet: nothing runs, nothing loads.
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        // Readers see a changed text as soon as the server serves it.
        "cache-control": "no-cache",
      },
    }),
  );

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The page for one document: its Markdown as HTML, raw HTML in it shown as text. */
export const legalPage = (
  markdown: string,
  serverName: string,
  document: "privacy" | "terms",
): string => {
  const body = Bun.markdown.html(markdown, {
    noHtmlBlocks: true,
    noHtmlSpans: true,
    autolinks: { url: true, email: true },
  });
  const heading = /^# +(.+)$/m.exec(markdown)?.[1]?.trim();
  const title =
    heading ?? (document === "privacy" ? "Privacy policy" : "Terms");
  const name = escapeHtml(serverName);
  const link = (path: string, label: string, current: boolean) =>
    current
      ? `<span aria-current="page">${label}</span>`
      : `<a href="${path}">${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · ${name}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<span class="server">${name}</span>
<nav>${link("/privacy", "Privacy policy", document === "privacy")} · ${link("/terms", "Terms", document === "terms")}</nav>
</header>
<main>
${body}</main>
</body>
</html>
`;
};

const STYLE = `
:root {
  color-scheme: light dark;
  --text: #1d1d1f;
  --muted: #5f6368;
  --line: #d9dce1;
  --link: #0b57d0;
  --page: #ffffff;
  --code: #f1f3f4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --text: #e8eaed;
    --muted: #9aa0a6;
    --line: #3c4043;
    --link: #8ab4f8;
    --page: #17181a;
    --code: #26282b;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--page);
  color: var(--text);
  font: 17px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
header, main { max-width: 44rem; margin: 0 auto; padding: 0 1.25rem; }
header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  padding-top: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--line);
  font-size: 0.875rem;
  color: var(--muted);
}
.server { font-weight: 600; }
nav [aria-current] { color: var(--text); }
main { padding-bottom: 3rem; overflow-wrap: break-word; }
h1 { font-size: 1.75rem; line-height: 1.25; margin: 1.75rem 0 0.5rem; }
h2 { font-size: 1.25rem; line-height: 1.3; margin: 2.25rem 0 0.5rem; }
h3 { font-size: 1.05rem; margin: 1.5rem 0 0.25rem; }
p, ul, ol, table { margin: 0 0 1rem; }
ul, ol { padding-left: 1.4rem; }
li { margin: 0.25rem 0; }
a { color: var(--link); text-underline-offset: 0.15em; }
strong { font-weight: 600; }
code { background: var(--code); border-radius: 4px; padding: 0.1em 0.3em; font-size: 0.9em; }
table { display: block; overflow-x: auto; border-collapse: collapse; }
th, td { border: 1px solid var(--line); padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
hr { border: 0; border-top: 1px solid var(--line); margin: 2rem 0; }
`;
