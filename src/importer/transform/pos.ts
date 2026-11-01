import type { UdPos } from "../../dictionary/schema.ts";

/**
 * wiktextract `pos` label -> Universal Dependencies tag. Anything missing
 * becomes `X`, as the protocol requires.
 *
 * wiktextract has a single `conj` label; most Polish conjunctions on
 * Wiktionary are coordinating, so `conj` maps to CCONJ. `name` is
 * wiktextract's label for proper nouns.
 */
const POS_MAP: Readonly<Record<string, UdPos>> = {
  noun: "NOUN",
  name: "PROPN",
  verb: "VERB",
  adj: "ADJ",
  adv: "ADV",
  adv_phrase: "ADV",
  pron: "PRON",
  det: "DET",
  article: "DET",
  num: "NUM",
  prep: "ADP",
  postp: "ADP",
  conj: "CCONJ",
  intj: "INTJ",
  particle: "PART",
  punct: "PUNCT",
  symbol: "SYM",
};

export const toUdPos = (sourcePos: string): UdPos => POS_MAP[sourcePos] ?? "X";
