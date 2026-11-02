/**
 * Judges a sample with `claude -p`, one batch per call, on your Claude login.
 * Verdicts are saved by word, sentence, popover and prompt, so only what changed
 * since an earlier run is judged again.
 *
 *   bun eval/judge.ts --dir eval/out/pl/base --effort medium
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { renderPopover, verdictKey } from "./popover.ts";
import type { SampleRecord, Verdict } from "./types.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    model: { type: "string", default: "haiku" },
    effort: { type: "string", default: "medium" },
    size: { type: "string", default: "25" },
    concurrency: { type: "string", default: "5" },
    attempts: { type: "string", default: "3" },
    cache: { type: "string" },
    dry: { type: "boolean", default: false },
  },
});
if (!values.dir) throw new Error("Usage: judge --dir <dir>");
const dir = values.dir;
const cachePath = resolve(values.cache ?? join(dirname(dir), "verdicts.jsonl"));
const promptPath = resolve(import.meta.dirname, "judge-prompt.md");
const prompt = readFileSync(promptPath, "utf8");

const sample: ReadonlyArray<SampleRecord> = JSON.parse(readFileSync(join(dir, "sample.json"), "utf8"));
const cached = new Set<string>(
  existsSync(cachePath)
    ? readFileSync(cachePath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line).key)
    : [],
);

const pending = new Map<string, SampleRecord>();
for (const item of sample) {
  const key = verdictKey(item, prompt);
  if (!cached.has(key)) pending.set(key, item);
}
const size = Number(values.size);
const queue = [...pending];
const batches: Array<ReadonlyArray<[string, SampleRecord]>> = [];
for (let i = 0; i < queue.length; i += size) batches.push(queue.slice(i, i + size));
console.log(`${sample.length} items: ${sample.length - pending.size} already judged, ${pending.size} to judge, ${batches.length} batches`);
if (values.dry) process.exit(0);

const render = (key: string, item: SampleRecord) =>
  `id: ${key.slice(0, 8)}\nword: ${item.word}\nsentence: ${item.sentence}\n${renderPopover(item.entries)}`;

const UNDERSTOOD = new Set(["yes", "partly", "wrong", "no"]);
const parse = (text: string, ids: ReadonlySet<string>): Map<string, Verdict> => {
  const verdicts = new Map<string, Verdict>();
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const verdict = JSON.parse(line) as Verdict;
      if (ids.has(verdict.id) && UNDERSTOOD.has(verdict.understood)) {
        verdicts.set(verdict.id, { ...verdict, flags: verdict.flags ?? {} });
      }
    } catch {
      // A malformed line counts as missing, and the item is retried.
    }
  }
  return verdicts;
};

const cwd = mkdtempSync(join(tmpdir(), "lookup-judge-"));
const totals = { batches: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0, cost: 0, retries: 0, noThinking: 0 };

const call = async (input: string) => {
  const process_ = Bun.spawn(
    ["claude", "-p", "--model", values.model!, "--effort", values.effort!, "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence", "--system-prompt-file", promptPath, "--output-format", "json"],
    { cwd, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" },
  );
  const stdout = await new Response(process_.stdout).text();
  await process_.exited;
  return JSON.parse(stdout);
};

const judgeBatch = async (batch: ReadonlyArray<[string, SampleRecord]>, label: string) => {
  let remaining = [...batch];
  for (let attempt = 1; attempt <= Number(values.attempts) && remaining.length > 0; attempt++) {
    const input = `Judge these items.\n\n${remaining.map(([key, item]) => render(key, item)).join("\n---\n")}\n`;
    writeFileSync(join(dir, `${label.replace(" ", "-")}.input.txt`), input);
    const result = await call(input).catch((error) => ({ is_error: true, result: String(error) }));
    if (result.is_error) {
      console.log(`${label} attempt ${attempt}: ${String(result.result).slice(0, 200)}`);
      totals.retries++;
      continue;
    }
    const usage = result.usage;
    totals.input += usage.input_tokens;
    totals.cacheWrite += usage.cache_creation_input_tokens;
    totals.cacheRead += usage.cache_read_input_tokens;
    totals.output += usage.output_tokens;
    const thinking = usage.output_tokens_details?.thinking_tokens ?? 0;
    totals.thinking += thinking;
    totals.cost += result.total_cost_usd;
    // Runs with no thinking judged measurably worse, so they don't count unless nothing else is left.
    if (thinking === 0 && attempt < Number(values.attempts)) {
      totals.retries++;
      continue;
    }
    if (thinking === 0) totals.noThinking++;
    const verdicts = parse(result.result, new Set(remaining.map(([key]) => key.slice(0, 8))));
    for (const [key] of remaining) {
      const verdict = verdicts.get(key.slice(0, 8));
      if (verdict) appendFileSync(cachePath, JSON.stringify({ key, thinking, ...verdict }) + "\n");
    }
    remaining = remaining.filter(([key]) => !verdicts.has(key.slice(0, 8)));
    if (remaining.length > 0) totals.retries++;
  }
  totals.batches++;
  console.log(`${totals.batches}/${batches.length} batches done${remaining.length > 0 ? `, ${label} left ${remaining.length} unjudged` : ""}`);
};

let index = 0;
await Promise.all(
  Array.from({ length: Number(values.concurrency) }, async () => {
    while (index < batches.length) {
      const current = index++;
      await judgeBatch(batches[current]!, `batch ${current + 1}`);
    }
  }),
);
console.table(totals);
