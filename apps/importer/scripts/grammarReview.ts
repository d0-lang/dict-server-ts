/**
 * The grammar-file lines that changed against a git ref, each drawn as the
 * extension's popover draws it, before and after, on one HTML page.
 *
 *   bun apps/importer/scripts/grammarReview.ts --base main --out review.html [--langs de,ja]
 *
 * Readings and IPA come from `DATA_DIR` (default `data`), when imported.
 */
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type GrammarEntry, parseGrammarFile } from "../src/grammar.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "main" },
    out: { type: "string", default: "grammar-review.html" },
    langs: { type: "string" },
  },
});
const dataDir = process.env.DATA_DIR ?? "data";
const langs =
  values.langs?.split(",") ??
  readdirSync("languages").filter((l) =>
    existsSync(join("languages", l, "grammar.tsv")),
  );

const POS_NAMES: Record<string, string> = {
  ADJ: "adjective",
  ADP: "adposition",
  ADV: "adverb",
  AUX: "auxiliary",
  CCONJ: "conjunction",
  DET: "determiner",
  INTJ: "interjection",
  NOUN: "noun",
  NUM: "numeral",
  PART: "particle",
  PRON: "pronoun",
  PROPN: "proper noun",
  SCONJ: "conjunction",
  VERB: "verb",
};
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const key = (e: GrammarEntry) => `${e.lemma}\t${e.pos}`;

const read = (lang: string, ref?: string): ReadonlyArray<GrammarEntry> => {
  const path = `languages/${lang}/grammar.tsv`;
  const text =
    ref === undefined
      ? readFileSync(path, "utf8")
      : execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" });
  return parseGrammarFile(text, path);
};

/** The extension's `linkSense` (src/lib/dict/entries.ts): whole-word matches link, one unmatched target links the whole sense, others follow as "; see". */
const splitWords = (text: string) => text.split(/([^\p{L}\p{M}\p{N}]+)/u);
const lemmaKey = (text: string) => text.normalize("NFC").toLowerCase();
const wordsOf = (text: string) =>
  splitWords(lemmaKey(text)).filter((w, i) => i % 2 === 0 && w !== "");
const link = (s: string) => `<span class="link">${esc(s)}<sup>↗</sup></span>`;
const sense = (text: string, see: ReadonlyArray<string>) => {
  const targets = [...new Set(see)]
    .map((target) => ({ target, run: wordsOf(target) }))
    .filter(({ run }) => run.length > 0)
    .sort((a, b) => b.run.length - a.run.length);
  const words = splitWords(text);
  const found = new Set<string>();
  let html = "";
  let plainFrom = 0;
  let i = 0;
  while (i < words.length) {
    const match = targets.find(({ run }) =>
      run.every((w, k) => lemmaKey(words[i + k * 2] ?? "") === w),
    );
    if (match === undefined) {
      i += 2;
      continue;
    }
    const end = i + match.run.length * 2 - 1;
    html +=
      esc(words.slice(plainFrom, i).join("")) +
      link(words.slice(i, end).join(""));
    found.add(match.target);
    plainFrom = end;
    i = end + 1;
  }
  html += esc(words.slice(plainFrom).join(""));
  const unfound = targets.map((t) => t.target).filter((t) => !found.has(t));
  if (targets.length === 1 && unfound.length === 1) return link(text);
  return unfound.length > 0
    ? `${html}; see ${unfound.map(link).join(", ")}`
    : html;
};

const popover = (
  e: GrammarEntry,
  pron: { reading?: string; ipa?: string },
) => `<div class="pop">
  <div class="head"><h2>${esc(e.lemma)}</h2>${POS_NAMES[e.pos] ? ` <span class="pos">${POS_NAMES[e.pos]}</span>` : ""}</div>
  ${pron.reading && pron.reading !== e.lemma ? `<p>${esc(pron.reading)}</p>` : ""}
  ${pron.ipa ? `<p class="ipa">${esc(pron.ipa)}</p>` : ""}
  <ol>${e.senses.map((s, i) => `<li>${sense(s, e.see?.[i] ?? [])}</li>`).join("")}</ol>
</div>`;

const sections = langs.flatMap((lang) => {
  const before = new Map(read(lang, values.base).map((e) => [key(e), e]));
  const after = read(lang);
  const db = existsSync(join(dataDir, `${lang}_en.sqlite`))
    ? new Database(join(dataDir, `${lang}_en.sqlite`), { readonly: true })
    : undefined;
  const pronOf = (e: GrammarEntry) => {
    const rows =
      db
        ?.query<{ kind: string; value: string }, [string, string]>(
          `SELECT p.kind, p.value FROM entries e JOIN pronunciations p ON p.entry_id = e.id
           WHERE e.lemma = ?1 AND e.pos = ?2 AND e.source_pos = 'grammar' ORDER BY p.idx`,
        )
        .all(e.lemma, e.pos) ?? [];
    return {
      reading: rows.find((r) => r.kind === "reading")?.value,
      ipa: rows.find((r) => r.kind === "ipa")?.value,
    };
  };
  const changed = after.flatMap((e) => {
    const old = before.get(key(e));
    return JSON.stringify(old) === JSON.stringify(e) ? [] : [{ old, e }];
  });
  if (changed.length === 0) return [];
  const rows = changed
    .map(({ old, e }) => {
      const pron = pronOf(e);
      return `<div class="row" data-word="${esc(e.lemma)}"><div class="side"><div class="tag">Before</div>${old ? popover(old, pron) : `<div class="pop empty">New line</div>`}</div><div class="side"><div class="tag">After</div>${popover(e, pron)}</div></div>`;
    })
    .join("\n");
  return [
    {
      lang,
      count: changed.length,
      html: `<section id="${lang}" class="lang">${rows}</section>`,
    },
  ];
});

const NAMES: Record<string, string> = {
  de: "German",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  pl: "Polish",
  ru: "Russian",
  uk: "Ukrainian",
  zh: "Chinese",
};

writeFileSync(
  values.out,
  `<title>Grammar Line Review</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* One column of before/after popover pairs per language, tabs on top. */
:root{--bg:#f6f6f7;--fg:#1c1c1f;--muted:#76767e;--card:#ffffff;--border:#e3e3e8;--link:#4b3fd1;--chip:#ececf0;--font:Inter,system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121214;--fg:#f4f4f6;--muted:#9d9da6;--card:#232326;--border:#34343a;--link:#a7a4ff;--chip:#2c2c31;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121214;--fg:#f4f4f6;--muted:#9d9da6;--card:#232326;--border:#34343a;--link:#a7a4ff;--chip:#2c2c31;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:14px/1.5 var(--font);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px 48px}
.wrap{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
header{display:flex;flex-direction:column;gap:4px}
h1{font-size:20px;font-weight:650;margin:0;text-wrap:balance}
header p{margin:0;color:var(--muted);max-width:65ch}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;position:sticky;top:env(safe-area-inset-top,0px);background:var(--bg);padding-block:8px;z-index:2}
.tabs{display:flex;flex-wrap:wrap;gap:6px}
.tabs button{font:inherit;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:999px;padding:4px 12px;cursor:pointer}
.tabs button[aria-selected="true"]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.tabs .n{color:var(--muted);margin-left:4px;font-variant-numeric:tabular-nums}
.tabs button[aria-selected="true"] .n{color:inherit;opacity:.7}
#filter{font:inherit;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:8px;padding:5px 10px;min-width:0;flex:1 1 160px;max-width:240px}
button:focus-visible,#filter:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.lang{display:flex;flex-direction:column;gap:20px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
@media (max-width:640px){.row{grid-template-columns:1fr}}
.side{display:flex;flex-direction:column;gap:4px;min-width:0}
.tag{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.pop{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px;min-width:0;overflow-wrap:anywhere}
.pop.empty{color:var(--muted)}
.head h2{display:inline;font-size:16px;font-weight:600;margin:0}.pos{color:var(--muted);font-size:12px}
.pop p{margin:0}.ipa{color:var(--muted);font-size:12px}
ol{margin:6px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:4px}
.link{text-decoration:underline;text-underline-offset:2px}.link sup{font-size:9px;opacity:.6;margin-left:1px}
.none{color:var(--muted)}
</style>
<div class="wrap">
<header><h1>Grammar line review</h1><p>Each hand-written grammar line that changed against <code>${esc(values.base)}</code>, drawn as the extension's popover draws it. Underlined words are links to another entry.</p></header>
<div class="bar"><div class="tabs" role="tablist">${sections.map((s) => `<button role="tab" data-lang="${s.lang}" aria-selected="false">${NAMES[s.lang] ?? s.lang}<span class="n">${s.count}</span></button>`).join("")}</div><input id="filter" type="search" placeholder="Find a word" aria-label="Find a word"></div>
${sections.map((s) => s.html).join("\n")}
<p class="none" hidden>No changed line matches.</p>
</div>
<script>
const tabs=[...document.querySelectorAll('[role=tab]')];const langs=[...document.querySelectorAll('.lang')];const filter=document.getElementById('filter');const none=document.querySelector('.none');
const show=(lang)=>{if(!langs.some(l=>l.id===lang))lang=langs[0]?.id;tabs.forEach(t=>t.setAttribute('aria-selected',String(t.dataset.lang===lang)));langs.forEach(l=>l.hidden=l.id!==lang);apply();};
const apply=()=>{const q=filter.value.trim().toLowerCase();let shown=0;const cur=langs.find(l=>!l.hidden);cur?.querySelectorAll('.row').forEach(r=>{const hit=q===''||r.dataset.word.toLowerCase().includes(q)||r.textContent.toLowerCase().includes(q);r.hidden=!hit;if(hit)shown++;});none.hidden=shown>0;};
tabs.forEach(t=>t.addEventListener('click',()=>{location.hash=t.dataset.lang;}));
filter.addEventListener('input',apply);
addEventListener('hashchange',()=>show(location.hash.slice(1)));
show(location.hash.slice(1));
</script>`,
);
console.log(
  `${values.out}: ${sections.map((s) => `${s.lang} ${s.count}`).join(", ")}`,
);
