import { assert, describe, it } from "@effect/vitest";
import { commonsFilePage, wiktionaryPageUrl } from "./sources.ts";

describe("commonsFilePage", () => {
  it("reads the file name after the two hash directories", () => {
    assert.strictEqual(
      commonsFilePage(
        "https://upload.wikimedia.org/wikipedia/commons/0/03/De-Mutter.ogg",
      ),
      "https://commons.wikimedia.org/wiki/File:De-Mutter.ogg",
    );
  });

  it("reads the original file of a transcoded one", () => {
    assert.strictEqual(
      commonsFilePage(
        "https://upload.wikimedia.org/wikipedia/commons/transcoded/7/7c/De-Ilsfeld.ogg/De-Ilsfeld.ogg.mp3",
      ),
      "https://commons.wikimedia.org/wiki/File:De-Ilsfeld.ogg",
    );
    // Lingua Libre recordings are .wav files, served transcoded.
    assert.strictEqual(
      commonsFilePage(
        "https://upload.wikimedia.org/wikipedia/commons/transcoded/0/07/LL-Q188_%28deu%29-Frank_C._M%C3%BCller-AM.wav/LL-Q188_%28deu%29-Frank_C._M%C3%BCller-AM.wav.ogg",
      ),
      "https://commons.wikimedia.org/wiki/File:LL-Q188_%28deu%29-Frank_C._M%C3%BCller-AM.wav",
    );
  });

  it("gives nothing for a URL it can't read", () => {
    for (const url of [
      "https://example.org/wikipedia/commons/0/03/De-Mutter.ogg",
      "https://upload.wikimedia.org/wikipedia/en/0/03/De-Mutter.ogg",
      "https://upload.wikimedia.org/wikipedia/commons/0/13/De-Mutter.ogg",
      "https://upload.wikimedia.org/wikipedia/commons/0/03/",
      "https://upload.wikimedia.org/wikipedia/commons/0/03/a/b.ogg",
      "https://upload.wikimedia.org/wikipedia/commons/transcoded/0/03/a.ogg",
    ]) {
      assert.strictEqual(commonsFilePage(url), undefined, url);
    }
  });
});

describe("wiktionaryPageUrl", () => {
  it("links the language's section of the page", () => {
    assert.strictEqual(
      wiktionaryPageUrl("Mutter", "German"),
      "https://en.wiktionary.org/wiki/Mutter#German",
    );
    assert.strictEqual(
      wiktionaryPageUrl("in Kraft treten", "German"),
      "https://en.wiktionary.org/wiki/in_Kraft_treten#German",
    );
    assert.strictEqual(
      wiktionaryPageUrl("собака", "Russian"),
      "https://en.wiktionary.org/wiki/%D1%81%D0%BE%D0%B1%D0%B0%D0%BA%D0%B0#Russian",
    );
    assert.strictEqual(
      wiktionaryPageUrl("Appendix:Polish pronouns", "Old Polish"),
      "https://en.wiktionary.org/wiki/Appendix:Polish_pronouns#Old_Polish",
    );
    assert.strictEqual(
      wiktionaryPageUrl("what?", "English"),
      "https://en.wiktionary.org/wiki/what%3F#English",
    );
  });
});
