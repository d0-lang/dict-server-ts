import type { LookupBody, LookupEntry } from "../domain/schemas.ts";

const mutterPron = {
  ipa: ["/ˈmʊtər/", "[ˈmʊtɐ]"],
  audio: [
    {
      url: "https://upload.wikimedia.org/wikipedia/commons/0/03/De-Mutter.ogg",
      source: "https://commons.wikimedia.org/wiki/File:De-Mutter.ogg",
    },
  ],
};
const mutterSources = ["https://en.wiktionary.org/wiki/Mutter#German"];

const pies: LookupEntry = {
  lemma: "pies",
  pos: "NOUN",
  pron: { ipa: ["/pjɛs/"] },
  senses: [{ glosses: ["dog"] }],
};

const nauczycielka: LookupEntry = {
  lemma: "nauczycielka",
  pos: "NOUN",
  senses: [
    {
      glosses: [
        "female equivalent of nauczyciel: teacher (person who teaches, especially one employed in a school)",
      ],
    },
  ],
};

/**
 * Hardcoded responses for tests that need no dictionary file, chosen to
 * cover what a client has to render. Keys are lowercase surface words; anything
 * else is not found.
 */
const SAMPLES: Readonly<Record<string, ReadonlyArray<LookupEntry>>> = {
  // Same lemma and pos, different origin: the client groups these.
  mutter: [
    {
      lemma: "Mutter",
      pos: "NOUN",
      pron: mutterPron,
      senses: [{ glosses: ["mother"] }],
      sources: mutterSources,
    },
    {
      lemma: "Mutter",
      pos: "NOUN",
      pron: mutterPron,
      senses: [{ glosses: ["nut (for a bolt)"] }],
      sources: mutterSources,
    },
  ],
  matka: [
    {
      lemma: "matka",
      pos: "NOUN",
      pron: { ipa: ["/ˈmat.ka/"] },
      senses: [{ glosses: ["mother"] }, { glosses: ["queen bee"] }],
    },
    {
      lemma: "matka",
      pos: "NOUN",
      senses: [{ glosses: ["diminutive of mata: mat (floor pad)"] }],
    },
  ],
  // An inflected form returns its base form, without saying which form matched.
  pies: [pies],
  psa: [pies],
  nauczycielka: [nauczycielka],
  nauczycielki: [nauczycielka],
  // A long list of senses, to stress the layout.
  zamek: [
    {
      lemma: "zamek",
      pos: "NOUN",
      pron: { ipa: ["/ˈza.mɛk/"] },
      senses: [
        { glosses: ["castle (fortified building)"] },
        { glosses: ["lock (fastening device)"] },
        { glosses: ["zipper", "zip"] },
        { glosses: ["bolt (of a firearm)"] },
        { glosses: ["keystone (top stone of an arch)"] },
        { glosses: ["joint (in carpentry)"] },
        { glosses: ["fortress (historical)"] },
        { glosses: ["palace (of a ruler)"] },
      ],
    },
  ],
  robić: [
    {
      lemma: "robić",
      pos: "VERB",
      senses: [{ glosses: ["to do"] }, { glosses: ["to make"] }],
    },
  ],
  // `reading` and a script without case.
  母: [
    {
      lemma: "母",
      pos: "NOUN",
      pron: { ipa: ["[ha̠ha̠]"], reading: "はは" },
      senses: [{ glosses: ["mother"] }],
    },
  ],
};

/** A compound split into segments. The pieces spell the word as sent. */
const gemuesefonds: LookupBody = {
  entries: [
    {
      lemma: "Gemüse",
      pos: "NOUN",
      senses: [{ glosses: ["vegetable; vegetables"] }],
    },
    { lemma: "Fonds", pos: "NOUN", senses: [{ glosses: ["fund"] }] },
    {
      lemma: "Fond",
      pos: "NOUN",
      senses: [{ glosses: ["stock (broth)"] }],
    },
  ],
  segments: [
    { text: "Gemüse", entries: [0] },
    { text: "fonds", entries: [1, 2] },
  ],
};

export const lookupStub = (word: string): LookupBody =>
  word.toLowerCase() === "gemüsefonds"
    ? gemuesefonds
    : { entries: SAMPLES[word.toLowerCase()] ?? [] };
