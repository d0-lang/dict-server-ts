// Downloads the dictionaries of the release this image was built for into DATA_DIR,
// checked against the release's SHA256SUMS. The one-shot `dictionaries` service in
// compose.yaml runs it before the server starts.
//
// DICT_RELEASE  the release tag, baked into the image by CI (Dockerfile ARG VERSION)
// DICT_REPO     where the releases are, default d0-lang/dict-server-ts
// GITHUB_TOKEN  optional; needed while the repo is private
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const release = process.env["DICT_RELEASE"]?.trim();
const repo = process.env["DICT_REPO"]?.trim() || "d0-lang/dict-server-ts";
const token = process.env["GITHUB_TOKEN"]?.trim();
const dataDir = process.env["DATA_DIR"]?.trim() || "data";
const marker = join(dataDir, ".release");

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

if (!release) {
  fail(
    "DICT_RELEASE is not set: this image was not built by the release workflow",
  );
}

const github = (url: string, accept: string) =>
  fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "dict-server-fetch",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

/** `<sha256>  <name>` lines, as `sha256sum` writes them. */
const parseSums = (text: string) =>
  new Map(
    text
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+\*?/))
      .map(([hash, name]) => [name!, hash!]),
  );

const installed = (): boolean => {
  if (!existsSync(marker) || readFileSync(marker, "utf8").trim() !== release) {
    return false;
  }
  const sums = parseSums(readFileSync(join(dataDir, "SHA256SUMS"), "utf8"));
  return [...sums.keys()].every((name) => existsSync(join(dataDir, name)));
};

if (installed()) {
  console.log(`the dictionaries of ${release} are already in ${dataDir}/`);
  process.exit(0);
}

type Asset = { name: string; url: string; size: number };
const response = await github(
  `https://api.github.com/repos/${repo}/releases/tags/${release}`,
  "application/vnd.github+json",
);
if (!response.ok) {
  fail(
    `cannot read release ${release} of ${repo}: ${response.status} ${response.statusText}` +
      (response.status === 404 && !token
        ? " (a private repo needs GITHUB_TOKEN)"
        : ""),
  );
}
const assets = ((await response.json()) as { assets: Asset[] }).assets.filter(
  (asset) => asset.name.endsWith(".sqlite") || asset.name === "SHA256SUMS",
);

// Downloaded next to the files they replace, so the moves below are renames.
const tmp = join(dataDir, `.tmp-${release}`);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const download = async (asset: Asset) => {
  // The asset API answers with a redirect to the file; fetch drops the token there.
  const file = await github(asset.url, "application/octet-stream");
  if (!file.ok || !file.body) {
    fail(`cannot download ${asset.name}: ${file.status} ${file.statusText}`);
  }
  const hash = createHash("sha256");
  const body = Readable.fromWeb(file.body!);
  body.on("data", (chunk) => hash.update(chunk));
  await pipeline(body, createWriteStream(join(tmp, asset.name)));
  console.log(`${asset.name}: ${(asset.size / 1e6).toFixed(0)} MB`);
  return [asset.name, hash.digest("hex")] as const;
};

const hashes = new Map(await Promise.all(assets.map(download)));
const sums = parseSums(readFileSync(join(tmp, "SHA256SUMS"), "utf8"));
for (const [name, expected] of sums) {
  if (hashes.get(name) !== expected) {
    rmSync(tmp, { recursive: true, force: true });
    fail(`${name} does not match SHA256SUMS of ${release}`);
  }
}

// The new files in, the ones this release no longer has out, then the marker last,
// so an interrupted run downloads again.
rmSync(marker, { force: true });
for (const name of sums.keys())
  renameSync(join(tmp, name), join(dataDir, name));
renameSync(join(tmp, "SHA256SUMS"), join(dataDir, "SHA256SUMS"));
for (const name of readdirSync(dataDir)) {
  if (name.endsWith(".sqlite") && !sums.has(name)) rmSync(join(dataDir, name));
}
rmSync(tmp, { recursive: true, force: true });
writeFileSync(marker, `${release}\n`);
console.log(`the dictionaries of ${release} are in ${dataDir}/`);
