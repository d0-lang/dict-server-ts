/**
 * Runs `dump:lookups` for every language with a dictionary file in `data/`,
 * and with `--base` checks which languages' answers changed. Most lookup
 * rules are shared, so a change made for one language can change another's
 * popovers; this finds it without the judge.
 *
 *   bun run dump:all --run before
 *   bun run dump:all --run after --base before --allow ja
 *
 * `--allow` names the languages the change is meant to touch. When any other
 * language's responses changed, the run fails. Each language's output is in
 * `apps/server/eval/out/<lang>/dump/<run>.log`.
 *
 * A dump holds all its responses in memory (up to about 4 GB for Japanese),
 * so `--jobs` languages run at a time, 3 by default.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    base: { type: "string" },
    allow: { type: "string", default: "" },
    jobs: { type: "string", default: "3" },
    corpus: { type: "string", default: "../corpus" },
    target: { type: "string", default: "en" },
  },
});
if (values.run === undefined) {
  throw new Error(
    "Usage: dump:all --run <name> [--base <name>] [--allow <lang,...>] [--jobs <n>] [--corpus <dir>]",
  );
}
const run = values.run;
const allowed = new Set(
  values.allow
    .split(",")
    .map((lang) => lang.trim())
    .filter((lang) => lang !== ""),
);

/** Languages with a record in `languages/` and a dictionary file. */
const languages = readdirSync("languages", { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(join("languages", entry.name, "language.toml")) &&
      existsSync(`data/${entry.name}_${values.target}.sqlite`),
  )
  .map((entry) => entry.name)
  .sort();
if (languages.length === 0) throw new Error("no dictionary files in data/");

type Outcome = {
  readonly lang: string;
  readonly ok: boolean;
  /** Responses that differ from the base run, when there is one. */
  readonly changed?: number;
  readonly lookups?: number;
  /** The dump's line comparing the cost with the base run's, when it prints one. */
  readonly cost?: string;
};

const dumpOf = async (lang: string): Promise<Outcome> => {
  const args = [
    "apps/server/eval/lookup-dump.ts",
    "--lang",
    lang,
    "--run",
    run,
    "--texts",
    join(values.corpus, lang),
    "--target",
    values.target,
    ...(values.base === undefined ? [] : ["--base", values.base]),
  ];
  const child = Bun.spawn(["bun", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const dir = join("apps/server/eval/out", lang, "dump");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${run}.log`), stdout + stderr);
  const changed = /^(\d+) of (\d+) responses changed$/m.exec(stdout);
  const cost = /^cost against .*$/m.exec(stdout)?.[0];
  return {
    lang,
    ok: code === 0,
    ...(changed !== null
      ? { changed: Number(changed[1]), lookups: Number(changed[2]) }
      : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
};

const outcomes: Array<Outcome> = [];
const queue = [...languages];
await Promise.all(
  Array.from(
    { length: Math.max(1, Math.min(Number(values.jobs), queue.length)) },
    async () => {
      for (let lang = queue.shift(); lang !== undefined; lang = queue.shift()) {
        const outcome = await dumpOf(lang);
        outcomes.push(outcome);
        console.log(
          `${lang}: ${
            !outcome.ok
              ? "failed, see its log"
              : outcome.changed === undefined
                ? "done"
                : `${outcome.changed} of ${outcome.lookups} responses changed`
          }${outcome.cost === undefined ? "" : `; ${outcome.cost}`}`,
        );
      }
    },
  ),
);

const failed = outcomes.filter((outcome) => !outcome.ok).map((o) => o.lang);
const unexpected = outcomes
  .filter(
    (outcome) =>
      outcome.ok && (outcome.changed ?? 0) > 0 && !allowed.has(outcome.lang),
  )
  .map((outcome) => outcome.lang);
if (failed.length > 0) console.log(`failed: ${failed.sort().join(", ")}`);
if (unexpected.length > 0) {
  console.log(
    `changed, not in --allow: ${unexpected.sort().join(", ")} (logs in apps/server/eval/out/<lang>/dump/${run}.log)`,
  );
}
if (failed.length > 0 || unexpected.length > 0) process.exit(1);
