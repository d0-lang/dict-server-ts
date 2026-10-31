/** Universal Dependencies UPOS tags the lookup response is allowed to carry. */
const UD = {
  ADJ: "ADJ",
  ADP: "ADP",
  ADV: "ADV",
  AUX: "AUX",
  CCONJ: "CCONJ",
  DET: "DET",
  INTJ: "INTJ",
  NOUN: "NOUN",
  NUM: "NUM",
  PART: "PART",
  PRON: "PRON",
  PROPN: "PROPN",
  PUNCT: "PUNCT",
  SCONJ: "SCONJ",
  SYM: "SYM",
  VERB: "VERB",
  X: "X",
} as const;

export type UdPos = (typeof UD)[keyof typeof UD];

/**
 * Wiktextract `pos` values (English Wiktionary section headings, already
 * normalized by the extractor) to UD tags. Anything else becomes `X`.
 */
const POS_TO_UD: Readonly<Record<string, UdPos>> = {
  adj: UD.ADJ,
  adjective: UD.ADJ,
  adp: UD.ADP,
  adv: UD.ADV,
  adverb: UD.ADV,
  article: UD.DET,
  aux: UD.AUX,
  auxiliary: UD.AUX,
  cconj: UD.CCONJ,
  conj: UD.CCONJ,
  conjunction: UD.CCONJ,
  det: UD.DET,
  determiner: UD.DET,
  intj: UD.INTJ,
  interjection: UD.INTJ,
  name: UD.PROPN,
  noun: UD.NOUN,
  num: UD.NUM,
  numeral: UD.NUM,
  particle: UD.PART,
  postp: UD.ADP,
  postposition: UD.ADP,
  prep: UD.ADP,
  preposition: UD.ADP,
  pron: UD.PRON,
  pronoun: UD.PRON,
  prop: UD.PROPN,
  propn: UD.PROPN,
  "proper noun": UD.PROPN,
  "proper-noun": UD.PROPN,
  punct: UD.PUNCT,
  punctuation: UD.PUNCT,
  sconj: UD.SCONJ,
  sym: UD.SYM,
  symbol: UD.SYM,
  verb: UD.VERB,
};

export const toUdPos = (
  sourcePos: string,
): { readonly ud: UdPos; readonly mapped: boolean } => {
  const ud = POS_TO_UD[sourcePos.trim().toLowerCase()];
  if (ud === undefined) {
    return { ud: UD.X, mapped: false };
  }
  return { ud, mapped: true };
};
