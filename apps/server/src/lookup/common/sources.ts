/**
 * Credit for the material lookups are built from (the protocol's Sources).
 * Metadata lists the sources; a lookup links each entry to its Wiktionary
 * pages and each recording to its file page on Wikimedia Commons. A client
 * shows a link only when its origin is that of a source's `url`, so every
 * link built here must stay on those two origins.
 */

/** A metadata `sources` item, as the protocol sends it. */
export type Source = {
  readonly name: string;
  readonly url: string;
  readonly license?: string;
  readonly license_url?: string;
  readonly languages?: ReadonlyArray<string>;
};

export const WIKTIONARY: Source = {
  name: "Wiktionary",
  url: "https://en.wiktionary.org/",
  license: "CC-BY-SA-4.0",
  license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
};

/** Recordings: each file has its own author and licence, on its file page. */
export const COMMONS: Source = {
  name: "Wikimedia Commons",
  url: "https://commons.wikimedia.org/",
};

/** What every pair's dictionary is built from (the importer reads the English Wiktionary). */
export const SOURCES: ReadonlyArray<Source> = [WIKTIONARY, COMMONS];

/**
 * A title or heading as MediaWiki writes it in a URL: spaces as `_`, the rest
 * percent-encoded, except `/` and `:` (subpages, namespaces).
 */
const wikiPath = (text: string): string =>
  encodeURIComponent(text.replaceAll(" ", "_"))
    .replaceAll("%2F", "/")
    .replaceAll("%3A", ":");

/**
 * The link to the language's section of a Wiktionary page:
 * `Mutter`, `German` -> `https://en.wiktionary.org/wiki/Mutter#German`.
 * `section` is the language's English name, Wiktionary's heading.
 */
export const wiktionaryPageUrl = (title: string, section: string): string =>
  `${WIKTIONARY.url}wiki/${wikiPath(title)}#${wikiPath(section)}`;

const COMMONS_UPLOAD = "https://upload.wikimedia.org/wikipedia/commons/";

/**
 * The Commons file page of a file URL, read from the URL alone: the file name
 * is the path segment after the two hash directories, also in a `transcoded/`
 * URL (`…/commons/transcoded/7/7c/De-Ilsfeld.ogg/De-Ilsfeld.ogg.mp3` ->
 * `…/wiki/File:De-Ilsfeld.ogg`). Undefined for any other URL. The name stays
 * percent-encoded as the upload URL has it.
 */
export const commonsFilePage = (url: string): string | undefined => {
  if (!url.startsWith(COMMONS_UPLOAD)) return undefined;
  const parts = url.slice(COMMONS_UPLOAD.length).split("/");
  const transcoded = parts[0] === "transcoded";
  const [first, second, file, ...rest] = transcoded ? parts.slice(1) : parts;
  const hashed =
    first !== undefined &&
    second !== undefined &&
    /^[0-9a-f]$/.test(first) &&
    /^[0-9a-f]{2}$/.test(second) &&
    second.startsWith(first);
  if (!hashed || file === undefined || file === "") return undefined;
  if (transcoded ? rest.length !== 1 : rest.length !== 0) return undefined;
  return `${COMMONS.url}wiki/File:${file}`;
};
