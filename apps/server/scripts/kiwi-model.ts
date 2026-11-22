/**
 * Fetches Kiwi's model (the Korean analyzer, `context.analyzer.dictionary =
 * "kiwi"`) into `KIWI_MODEL_DIR` (default `models/kiwi`): the base model of
 * the Kiwi release that matches the installed `kiwi-nlp` package, checked
 * against its checksum. Does nothing when the files are there.
 *
 *   bun run kiwi:model
 *
 * Only the model's own files and its `VERSION` stamp are written or
 * replaced: the folder may hold other files.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Each Kiwi release's base model's checksum: a `kiwi-nlp` upgrade adds its own. */
const SHA256: Readonly<Record<string, string>> = {
  "0.25.0": "2b32096ce9f48da6aaaf486db01ff46834e7e3dcb92f507879d35e3d2180a2dc",
};
/** Where the files are inside the archive. */
const INSIDE = "models/cong/base";

const { version: VERSION } = (await Bun.file(
  Bun.resolveSync("kiwi-nlp/package.json", import.meta.dir),
).json()) as { version: string };
const sha256 = SHA256[VERSION];
if (sha256 === undefined) {
  throw new Error(
    `kiwi-nlp is ${VERSION}: add its model's checksum to SHA256 in apps/server/scripts/kiwi-model.ts`,
  );
}
const URL = `https://github.com/bab2min/Kiwi/releases/download/v${VERSION}/kiwi_model_v${VERSION}_base.tgz`;

const dir = process.env["KIWI_MODEL_DIR"]?.trim() || "models/kiwi";
const stamp = join(dir, "VERSION");
if (existsSync(stamp) && (await Bun.file(stamp).text()).trim() === VERSION) {
  console.log(`Kiwi model ${VERSION} is in ${dir}`);
  process.exit(0);
}

console.log(`fetching ${URL}`);
const response = await fetch(URL);
if (!response.ok) throw new Error(`${URL}: HTTP ${response.status}`);
const archive = new Uint8Array(await response.arrayBuffer());
const sum = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
if (sum !== sha256) throw new Error(`checksum ${sum}, expected ${sha256}`);

const work = mkdtempSync(join(tmpdir(), "kiwi-model-"));
try {
  await Bun.write(join(work, "model.tgz"), archive);
  const tar = Bun.spawnSync(["tar", "xzf", "model.tgz"], { cwd: work });
  if (tar.exitCode !== 0) throw new Error(`tar: ${tar.stderr.toString()}`);
  mkdirSync(dir, { recursive: true });
  // The stamp goes first and comes back last, so a run cut short is redone.
  rmSync(stamp, { force: true });
  for (const file of readdirSync(join(work, INSIDE))) {
    copyFileSync(join(work, INSIDE, file), join(dir, file));
  }
  await Bun.write(stamp, `${VERSION}\n`);
  console.log(`Kiwi model ${VERSION} -> ${dir}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
