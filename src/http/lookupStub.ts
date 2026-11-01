import type { LookupEntry } from "../domain/schemas.ts";

const mutterPron = {
  ipa: ["/ˈmʊtər/", "[ˈmʊtɐ]"],
  audio: ["https://upload.wikimedia.org/wikipedia/commons/0/03/De-Mutter.ogg"],
};

const pies: LookupEntry = {
  lemma: "pies",
  pos: "NOUN",
  pron: { ipa: ["/pjɛs/"] },
  senses: [{ translations: ["dog"] }],
};

const nauczycielka: LookupEntry = {
  lemma: "nauczycielka",
  pos: "NOUN",
  senses: [
    {
      translations: [
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
      senses: [{ translations: ["mother"] }],
    },
    {
      lemma: "Mutter",
      pos: "NOUN",
      pron: mutterPron,
      senses: [{ translations: ["nut (for a bolt)"] }],
    },
  ],
  matka: [
    {
      lemma: "matka",
      pos: "NOUN",
      pron: { ipa: ["/ˈmat.ka/"] },
      senses: [{ translations: ["mother"] }, { translations: ["queen bee"] }],
    },
    {
      lemma: "matka",
      pos: "NOUN",
      senses: [{ translations: ["diminutive of mata: mat (floor pad)"] }],
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
        { translations: ["castle (fortified building)"] },
        { translations: ["lock (fastening device)"] },
        { translations: ["zipper", "zip"] },
        { translations: ["bolt (of a firearm)"] },
        { translations: ["keystone (top stone of an arch)"] },
        { translations: ["joint (in carpentry)"] },
        { translations: ["fortress (historical)"] },
        { translations: ["palace (of a ruler)"] },
      ],
    },
  ],
  robić: [
    {
      lemma: "robić",
      pos: "VERB",
      senses: [{ translations: ["to do"] }, { translations: ["to make"] }],
    },
  ],
  // `reading` and a script without case.
  母: [
    {
      lemma: "母",
      pos: "NOUN",
      pron: { ipa: ["[ha̠ha̠]"], reading: "はは" },
      senses: [{ translations: ["mother"] }],
    },
  ],
};

export const lookupStub = (word: string): ReadonlyArray<LookupEntry> =>
  SAMPLES[word.toLowerCase()] ?? [];
