import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";

/**
 * A language's settings, from `languages/<code>/language.toml`: what the
 * importer and the server do differently for it. Every key but `code`,
 * `name` and `target` may be left out; the default is what a language that
 * doesn't need the setting gets. `spec/language.schema.json` is generated
 * from this schema (`bun run spec`).
 */

const strings = Schema.Array(Schema.String);
const doc = <S extends Schema.Top>(schema: S, description: string): S =>
  schema.annotate({ description }) as S;
/** A key that may be left out, decoding to `value` when it is. */
const orDefault = <S extends Schema.Top>(schema: S, value: S["Encoded"]) =>
  Schema.withDecodingDefaultKey<S>(Effect.succeed(value))(schema);

const LetterPair = doc(
  Schema.Tuple([Schema.String, Schema.String]),
  "[letter, plain]: running text may write `letter` as `plain` (`ё` as `е`).",
);

/** A grammar feature's name, as in `packages/core/src/features.ts`. */
const FeatureName = Schema.Literals([
  "Gender",
  "Animacy",
  "Aspect",
  "Number",
  "VerbClass",
  "Subcat",
  "AdjClass",
]);

const Import = doc(
  Schema.Struct({
    historicalStages: orDefault(
      doc(
        Schema.Array(strings),
        'Historical stages of the language. A sense, form or pronunciation is dropped when its tags contain every tag of a stage. Each stage is a list because wiktextract splits "Middle Polish" into the tags "Middle" and "Polish".',
      ),
      [],
    ),
    standardPronNotes: orDefault(
      doc(
        strings,
        "`note` values on `sounds` that still mean the standard pronunciation; other notes are regional variants, kept only when nothing else exists.",
      ),
      [],
    ),
    untrustedFormTags: orDefault(
      doc(
        strings,
        "Form tags that mark a misparsed table in this language's data; such rows are dropped.",
      ),
      [],
    ),
    reflexive: Schema.optionalKey(
      doc(
        Schema.Literals(["before", "after"]),
        "Senses Wiktionary labels `reflexive with <particle>` become an entry of their own, with the particle before or after the lemma (`after`: Polish `bawić się`, `wyobrażać sobie`). Learners learn these as words of their own.",
      ),
    ),
    reflexiveSuffix: Schema.optionalKey(
      doc(
        Schema.Struct({
          infinitive: doc(
            Schema.Struct({ ending: Schema.String, reflexive: Schema.String }),
            "How the reflexive infinitive is spelled from the verb's: Latvian `t` becomes `ties` (`sākt`, `sākties`).",
          ),
          rules: doc(
            Schema.Array(
              Schema.Struct({
                tags: strings,
                ending: Schema.String,
                reflexive: Schema.String,
              }),
            ),
            "Each table row with all of `tags` that ends in `ending` gives the reflexive form with `reflexive` in its place; the first rule that fits a row applies, and an empty `ending` adds `reflexive` (`sākam` + `ies`). A row no rule fits gives none.",
          ),
        }),
        'A reflexive verb is the verb with a suffix (Latvian `sākt` "to begin", `sākties` "to begin, intransitive": `sākās`, `sākas`; Lithuanian works alike), and Wiktionary has a page for few of them. A verb with a table and no reflexive entry in the dump gets one, "reflexive of sākt" with the verb\'s meanings, found by the forms the rules spell from its table that no other entry has.',
      ),
    ),
    participleDeclension: Schema.optionalKey(
      doc(
        Schema.Struct({
          tags: orDefault(
            doc(
              strings,
              "The tags a table's participle row has, all of them (Polish: the masculine singular adjectival participle; German: any participle).",
            ),
            ["adjectival", "participle", "masculine", "singular"],
          ),
          ending: Schema.String,
          endings: strings,
          onlyNew: orDefault(
            doc(
              Schema.Boolean,
              'Add a declined form only where no other entry has it, so a participle Wiktionary lists as an adjective keeps its forms (German `bestehende` stays `bestehend`\'s). Off where those adjectives carry only figurative senses and the verb is needed (Polish `zniszczony` "beat-up" for `zniszczonych` "destroyed").',
            ),
            false,
          ),
          sharedWithParticiple: orDefault(
            doc(
              Schema.Boolean,
              "With `onlyNew`: a form the participle's own adjective or noun has is added to the verb too, since only another word's form blocks it. French `adopté` \"male adoptee\" has `adoptés`, which is also `adopter`'s, and the noun `arrivée` \"arrival\" is `arrivé` + `e`, so it is `arriver`'s too, while `plus` the adverb stays out of `plu` (of `plaire`) + `s`.",
            ),
            false,
          ),
        }),
        "Adjectival participles decline like adjectives, but verb tables list only one form (`wymagany`, `ausgelegt`). A participle row with all of `tags` that ends in `ending` also gets its stem with each of `endings` as forms of the verb (`wymaganego`, `wymaganej`; `ausgelegte`, `ausgelegten`).",
      ),
    ),
    ownEntryForms: orDefault(
      doc(
        strings,
        'Form glosses that describe a word a reader meets on its own, so the word keeps an entry with its base\'s meaning ("passive of використовувати: to use") instead of only linking to the base. Each item is a set of words, all of which must open the gloss before its "of": `passive` matches "passive of" and "adjectival past passive participle of", `active participle` matches "past active participle of". Ukrainian sets them because its participles are also adjectives (`поширений` "widespread"), which a link to the verb would rank behind it.',
      ),
      [],
    ),
    pointerWords: orDefault(
      doc(
        strings,
        "Words that may make up the opening of a gloss that only names another word's form, before \"of\" and the linked word: `Yang-vowel form of -어서 (-eoseo)`, `topic-marked form of 나 (na)`, `Post-vowel and post-liquid allomorphic form of -으면`. Every word of the opening must be one of these, compared in lower case. wiktextract reads no `form-of` link there, so without this the reader gets the form's name and not its meaning: the sense becomes a link to the word, as a `form-of` sense is.",
      ),
      [],
    ),
    readingTags: orDefault(
      doc(
        strings,
        "Form tags that mark a headword's reading in a script the reader can sound out, shown as `pron.reading` where the headword has no ruby: Korean `romanization`, the Revised Romanization (`먹다`: `meokda`). The first form with one of these tags is the reading. Japanese takes its reading from the headword's ruby instead.",
      ),
      [],
    ),
    otherScriptTags: orDefault(
      doc(
        strings,
        'Form tags that name the word in the language\'s other script, for a language written in two whose dump keeps each word under one: Chinese `Simplified-Chinese`, on the traditional page (`學習` lists `学习`), whose own page is a soft redirect there. Such a form, and a soft redirect of a word written in that script, is the word\'s lemma too, as the lemma is found and ranked, even where the spelling is also a word of its own (`后` "empress", and `后` for `後` "after"). A form also tagged `alternative` is a variant, not the word in the other script.',
      ),
      [],
    ),
    markedAlternatives: orDefault(
      doc(
        Schema.Boolean,
        'Every alternative form on a headword line is a marked spelling, not a form: it reaches the word only when it reaches nothing else. Chinese lists variant characters there, which are often other words (`悅` "joy" lists `說` "to say" and `兌`).',
      ),
      false,
    ),
    varieties: Schema.optionalKey(
      doc(
        Schema.Struct({
          others: doc(
            strings,
            "Tags of varieties a reader of this language doesn't read (Chinese `Cantonese`, `Hokkien`, `Wu`).",
          ),
          keep: doc(
            strings,
            'Tags that keep a sense with one of `others`: it is used in this language too (`Mandarin`; `literary`, as in "(literary or Hakka) my" for `吾`).',
          ),
          later: Schema.optionalKey(
            doc(
              strings,
              "Tags of a variety that is this language but not its main one (Chinese `Taiwanese-Mandarin`): such a sense stays, also with one of `others` (`喬` \"to negotiate\", tagged Hokkien too), after the word's other senses, and an entry of only such senses after the word's other entries.",
            ),
          ),
          laterNotWith: Schema.optionalKey(
            doc(
              strings,
              "Tags of `others` with which a `later` tag doesn't keep a sense: the pair notes a spelling, not a sense (Chinese `Jin`: `著` zhù \"famous\" is tagged Jin and Taiwanese Mandarin, the varieties that spell it so, though `着` doesn't mean it).",
            ),
          ),
        }),
        "Varieties written under this language's header that its readers don't use: a sense tagged with one of `others` and none of `keep` is dropped, and so is a form tagged with one of `others`. A word left with no sense has no entry (Cantonese `咩`), unlike a historical stage's.",
      ),
    ),
    readingSounds: orDefault(
      doc(
        Schema.Array(strings),
        'Tag sets of the `sounds` that give the headword\'s reading, each a sound\'s whole set of tags (Chinese `["Mandarin", "Pinyin"]`, and the same with `Standard-Chinese`; not `["Mandarin", "Chengdu", "Sichuanese", "Pinyin"]`): their text (`zh_pron`), without a respelling in brackets (`shuō (shuo¹)`), is `pron.reading`, several joined with `, ` (`le, liǎo`).',
      ),
      [],
    ),
    standardPronTags: orDefault(
      doc(
        strings,
        "Tags the standard pronunciation has, all of them (Chinese `Mandarin`, `Standard-Chinese`), where every sound has tags: a sound without them, or tagged `variant`, is regional, kept only when there is no standard one. Left empty, the standard sound has no tags but `standard`.",
      ),
      [],
    ),
    glossLabels: orDefault(
      doc(
        strings,
        "Sense tags shown in brackets before the gloss, hyphens as spaces (`(literary) to go`, `(Taiwan) potato`): where the sense is used, which the reader needs to know and the gloss doesn't say.",
      ),
      [],
    ),
    stressedLemmas: orDefault(
      doc(
        Schema.Boolean,
        "Show the lemma with its stress marks: the headword's `canonical` form, when it spells the same word. Lookups still match unstressed text.",
      ),
      false,
    ),
    headwordGenders: orDefault(
      doc(
        Schema.Boolean,
        'With `headwordInflections`, an adjective or determiner also has the genders its headword line gives as forms (Italian `bancario`, feminine `bancaria`, `bancari`, `bancarie`), where Wiktionary often has no page for them or only a noun\'s (`piccole` "plural of piccola", a small beer). A noun\'s other gender stays another word (`attore`, `attrice`). Off where most of those forms have pages of their own: a form both reach then opens on the adjective, by dump order (French `journaux` on "daily").',
      ),
      false,
    ),
    unmarkedStressForms: orDefault(
      doc(
        Schema.Boolean,
        "Forms carry stress marks texts don't write: an accented vowel before another letter of the word (Italian tables write `bisógna`, `dàto`; texts `bisogna`, `dato`). Each such form is also indexed without those marks, unless a form with the same tags is written without any (`vuoi` beside the variant `vòi`). An accent on a word's last letter is spelling and stays (`città`, `perché`).",
      ),
      false,
    ),
    headwordInflections: orDefault(
      doc(
        Schema.Boolean,
        "A word without an inflection table has the cases and numbers its headword line gives as its forms: French nouns and adjectives have no tables (`structure`, plural `structures`), and Wiktionary often has no page of its own for a regular plural. Off where headword lines also name other words (German `der` for `CIA`).",
      ),
      false,
    ),
    verbChainsThroughEntries: orDefault(
      doc(
        Schema.Boolean,
        'A verb form\'s chain of links goes on through a word with entries but no verb entry, by that word\'s own verb links: French `partie` is "feminine singular of parti", whose entries are an adjective and a noun and whose verb line is "past participle of partir", so `partie` also reaches `partir`. Otherwise a chain stops at any word with an entry. Off where a participle used as an adjective is mostly read as one: the verb it reaches then ranks with the adjective, and often first (German `naheliegende`, Russian `удаленный`).',
      ),
      false,
    ),
    skippedPos: orDefault(
      doc(
        strings,
        'wiktextract parts of speech whose lines are not imported. Japanese `syllable` is a kana\'s own line ("The hiragana syllable は"), which names no word a reader looks up.',
      ),
      [],
    ),
    formlessPos: orDefault(
      doc(
        strings,
        "wiktextract parts of speech whose inflection tables are not indexed. Japanese `suffix` lines conjugate endings that the analyzer splits off and finds by their base form (`た`, `ます`), and their tables, Classical forms included, spell short words: `な` as a form of `ず`, `は` of the Old Japanese `ふ`.",
      ),
      [],
    ),
    featureTags: orDefault(
      doc(
        Schema.Record(
          Schema.String,
          Schema.Tuple([FeatureName, Schema.String]),
        ),
        'This language\'s wiktextract tags that give a headword feature, besides the shared ones (`masculine`, `perfective`), for a line all of whose senses have the tag: `godan = ["VerbClass", "Godan"]`. They apply to nouns, verbs and adjectives (`-na` on a Japanese な-adjective), not to suffixes, where a tag may mean something else. The value must be one of the feature\'s values in `packages/core/src/features.ts`.',
      ),
      {},
    ),
    lemmaSuffixes: orDefault(
      doc(
        Schema.Record(Schema.String, Schema.String),
        "Head templates whose words a reader learns with something added, by template name: the lemma gets it (`ja-verb-suru` = `する`: the verb on the page `勉強` is `勉強する`, its reading `べんきょうする`), the bare word stays a form, and table forms without the word are dropped (Wiktionary's tables of katakana する-verbs give `し` and `しろ` for `カール`).",
      ),
      {},
    ),
  }),
  "How the importer reads this language's wiktextract data.",
);

const Context = doc(
  Schema.Struct({
    verbBracket: orDefault(
      doc(
        Schema.Boolean,
        "The rest of a verb phrase goes to the end of the clause (German `tritt morgen in Kraft`).",
      ),
      false,
    ),
    hyphenWords: orDefault(
      doc(
        Schema.Boolean,
        "Some words are hyphen-joined parts (`что-нибудь`), which the segmenter splits; with context the parts are joined back into one word.",
      ),
      false,
    ),
    reflexive: Schema.optionalKey(
      doc(
        Schema.String,
        "The reflexive pronoun phrases are written with (German `sich` in `sich vorstellen`), which stands for any of `reflexives` in a sentence (`ich stelle mich vor`).",
      ),
    ),
    reflexives: orDefault(
      doc(strings, "Reflexive pronouns a phrase's `reflexive` stands for."),
      [],
    ),
    negation: Schema.optionalKey(
      doc(
        Schema.String,
        "The particle that negates a verb, where negation changes the case of the verb's object (`не имеет значения` for `иметь значение`).",
      ),
    ),
    maxGap: orDefault(
      doc(
        Schema.Int,
        "Words allowed between a verb and the rest of its phrase.",
      ),
      1,
    ),
    separableVerbs: orDefault(
      doc(
        Schema.Boolean,
        "Separable verbs: the finite verb with its particle at the end of the clause (`fand ... statt` -> `stattfinden`).",
      ),
      false,
    ),
    clauseConjunctions: orDefault(
      doc(
        strings,
        "Conjunctions that end a clause without punctuation, where the verb bracket and separable verbs look for the clause's end.",
      ),
      [],
    ),
    reflexiveParticles: orDefault(
      doc(
        strings,
        "Words that make a verb reflexive (`się` in `bawić się`). In a verb phrase they may stand on either side of the verb, apart from it, though they are no content word (`Dobrze się bawię`).",
      ),
      [],
    ),
    capitalNouns: orDefault(
      doc(
        Schema.Boolean,
        "Nouns are written with a capital letter (German), so a capitalised word of two or more letters inside a sentence ranks entries with a capitalised lemma first (`In wenigen Tagen`: `der Tag` before `tagen`).",
      ),
      false,
    ),
    nominalizers: orDefault(
      doc(
        strings,
        "With `capitalNouns`: words after which a capitalised infinitive is likely the verb used as a noun (`zum Binden`, `das Tragen`), so the verb keeps its place among the capitalised lemmas.",
      ),
      [],
    ),
    contractions: orDefault(
      doc(
        Schema.Record(Schema.String, Schema.String),
        "Forms a phrase's last word takes when it merges with the word after it, by form: a preposition with the article (French `du` for `de`, so `à partir du siècle` is `à partir de`; Spanish `del` for `de`), or an elided word written onto the next one, keyed by its apostrophe form, which stands for any word starting with it (`qu'` for `que`: `parce qu'il` is `parce que`).",
      ),
      {},
    ),
    verbAfter: orDefault(
      doc(
        strings,
        "Words a verb follows (subject and object pronouns, the negation): after one, in its clause, a word's one-word verb and auxiliary entries come before its others (French `je passe` opens on `passer`, not the noun `passe`), a verb whose lemma is the word itself after the verbs it is a form of (`dire` before `dit` \"called\"). With `elision`, an elided word counts in either place: the host of `n'oublie` follows `n'`, and the word after `qu'il` follows `il`.",
      ),
      [],
    ),
    verbBeforeJoined: orDefault(
      doc(
        strings,
        "Words a hyphen joins to the verb before them (French inverted subjects and imperative objects: `dit-il`, `donne-moi`, `vas-y`): before one, a word's verb and auxiliary entries come before its others, as after `verbAfter`.",
      ),
      [],
    ),
    noVerbAfter: orDefault(
      doc(
        strings,
        "Words no verb follows (determiners that are never a pronoun: French `des`, `ces`, `mon`): after one, in its clause, a word's one-word verb entries come after its others (`des mesures` opens on the noun, not `mesurer`).",
      ),
      [],
    ),
    participleEndings: orDefault(
      doc(
        strings,
        "Endings of past participles (French `é`, `i`, `it`). After a word that can be an auxiliary (it has an `AUX` entry), with at most two adverbs between, a word shaped like a past participle of a verb it is a form of shows that verb before its first noun entry, passing no adjective or adverb (`elle est partie`: `partir` before `partie` \"part\"). Shaped like one: the word, with one of `import.participleDeclension.endings` or nothing taken off, ends in one of these and is itself a form of that verb, so `j'ai envie` keeps the noun (`envi` is no form of `envier`). These hints apply with `context` only, to the word's own entries: a participle after an auxiliary first, then a verb after `verbAfter` or before `verbBeforeJoined`, then `noVerbAfter`.",
      ),
      [],
    ),
    abbreviationLeads: orDefault(
      doc(
        strings,
        "Words that may stand before an abbreviation as part of it (`и` in `и т. д.`).",
      ),
      [],
    ),
    analyzer: Schema.optionalKey(
      doc(
        Schema.Struct({
          dictionary: doc(
            Schema.Literals([
              "unidic",
              "ipadic",
              "ko-dic",
              "cc-cedict",
              "kiwi",
              "words",
            ]),
            "The morphological analyzer and its dictionary. Lindera's: `unidic` or `ipadic` for Japanese, `ko-dic` for Korean, `cc-cedict` for Chinese. `words`: no analyzer, the dictionary's own words, for a script whose words don't inflect (Chinese): a run of Han letters is cut into the fewest words with an entry, reverse maximum matching breaking ties; each letter is a morpheme, tagged `B` where a word starts and `I` inside one (a `join` rule with `pos = [\"I\"]` makes the words of them, and a word's letters are its parts), and the settings that name other parts of speech don't apply. `kiwi`: Kiwi, a Korean analyzer with a language model (npm `kiwi-nlp`), whose model files `bun run kiwi:model` fetches into `KIWI_MODEL_DIR` (default `models/kiwi`); it reads Korean better than ko-dic, which lacks `이`, and takes about 0.75 GB of memory alone, against ko-dic's 0.35 GB.",
          ),
          baseFields: orDefault(
            doc(
              Schema.Array(Schema.Int),
              "Which of the dictionary's detail fields hold a morpheme's base forms, looked up in this order (UniDic: 10, the written base form `いる`; 7, the lemma `要る`). Lindera's only; Kiwi gives each morpheme's base form itself.",
            ),
            [],
          ),
          baseSpellings: orDefault(
            doc(
              Schema.Array(
                Schema.Struct({
                  pos: doc(
                    strings,
                    "Parts of speech of the morpheme, as in `join`; of a fused morpheme, of the part.",
                  ),
                  spellings: doc(
                    strings,
                    "The base forms, `*` standing for the analyzer's (`*다`, `-*`).",
                  ),
                  affix: orDefault(
                    doc(
                      Schema.Boolean,
                      "A particle or ending: in a fused morpheme, its base forms come after the stem's (`걸` is `거` + `-ㄹ`: `거` first).",
                    ),
                    false,
                  ),
                }),
              ),
              "How the dictionary spells base forms the analyzer gives otherwise, by part of speech, the first rule that matches: Kiwi gives a verb's stem (`먹`) where Wiktionary lists `먹다` (`*다`), and particles and endings bare where Wiktionary writes them with hyphens (`-에서`, `-었-`).",
            ),
            [],
          ),
          baseLetters: orDefault(
            doc(
              Schema.Record(Schema.String, Schema.String),
              "Letters the analyzer writes in base forms otherwise than the dictionary, replaced in them: Kiwi writes a final consonant ending with the jamo that ends a syllable (`ᆯ` in `가` + `ᆯ`), Wiktionary with the letter (`-ㄹ`).",
            ),
            {},
          ),
          stemSuffixes: orDefault(
            doc(
              strings,
              "Parts of speech of suffixes that make a verb or adjective of the word before them, as in `join` (Kiwi's `XSV`, `XSA`: `공부` + `했어요`): the word is looked up as its head written with the suffix's base forms first (`공부하다`), then by the head's own.",
            ),
            [],
          ),
          readingField: Schema.optionalKey(
            doc(
              Schema.Int,
              "Which detail field holds the reading of a morpheme's lemma (UniDic: 6, `ニン` for `人` after a number). Entries with that reading rank first among those the morpheme finds (`人` as にん, not ひと). Katakana and hiragana compare alike.",
            ),
          ),
          numbers: orDefault(
            doc(
              strings,
              'Parts of speech of numerals, as in `pos` (`名詞-数詞`). A run of them is one number (`1|0` is `10`), shown by one entry or none, and the word after it is read as a counter (`人` "counter for people" in `3人`).',
            ),
            [],
          ),
          numerals: Schema.optionalKey(
            doc(
              Schema.Struct({
                digits: doc(
                  Schema.String,
                  "The characters for 0 to 9, in order (`〇一二三四五六七八九`).",
                ),
                units: doc(
                  strings,
                  "The characters for ten, a hundred and a thousand (`十`, `百`, `千`), written without a 1 before them.",
                ),
                myriads: doc(
                  strings,
                  "The characters for each fourth power of ten from 10,000 on (`万`, `億`, `兆`), written with a 1 before them.",
                ),
              }),
              "How the language writes a number in characters, to find a number written in digits under its entry (`10` as `十`, `10月` as `十月`).",
            ),
          ),
          counters: orDefault(
            doc(
              strings,
              'Wiktionary\'s parts of speech for a counter (`counter`: `人` "counter for number of people"). For the word after a number, entries of these come before its other entries (`年` "years" before `年` "a year").',
            ),
            [],
          ),
          join: orDefault(
            doc(
              Schema.Array(
                Schema.Struct({
                  pos: doc(
                    strings,
                    "Parts of speech of the morpheme, as the dictionary tags them, each a prefix of its tags joined with `-` (`助動詞`, `動詞-非自立可能`).",
                  ),
                  surface: Schema.optionalKey(
                    doc(strings, "Only these spellings of it (`て`, `で`)."),
                  ),
                  base: Schema.optionalKey(
                    doc(strings, "Only these base forms of it (`する`)."),
                  ),
                  after: Schema.optionalKey(
                    doc(
                      strings,
                      "Parts of speech of the morpheme before it, as in `pos`; left out, any morpheme with letters.",
                    ),
                  ),
                  afterSurface: Schema.optionalKey(
                    doc(strings, "Only after these spellings (`て`)."),
                  ),
                }),
              ),
              "Rules that join a morpheme to the word before it: a word is a morpheme and what the rules join to it (`食べ` + `まし` + `た`).",
            ),
            [],
          ),
          reread: orDefault(
            doc(
              Schema.Array(
                Schema.Struct({
                  pos: doc(
                    strings,
                    "Parts of speech the analyzer gives the morpheme, as in `join`.",
                  ),
                  surface: Schema.optionalKey(
                    doc(strings, "Only these spellings of it (`よ`)."),
                  ),
                  after: Schema.optionalKey(
                    doc(
                      strings,
                      "Only after a morpheme of these parts of speech, as read by the rules before; left out, after anything.",
                    ),
                  ),
                  before: Schema.optionalKey(
                    doc(
                      strings,
                      "Only before a morpheme of these parts of speech; left out, before anything.",
                    ),
                  ),
                  as: doc(
                    Schema.Struct({
                      pos: doc(
                        Schema.String,
                        "Its part of speech instead (`助詞-終助詞`).",
                      ),
                      base: Schema.optionalKey(
                        doc(
                          Schema.String,
                          "Its base form instead (`よ`); left out, it keeps its own.",
                        ),
                      ),
                    }),
                    "How to read it.",
                  ),
                }),
              ),
              "Rules for morphemes the analyzer misreads in a known place, applied in order from the sentence's start, before `join`: `よ` between two nouns is the particle, not the stem of `よい` (`鏡|よ|鏡|よ`). A reread morpheme has no reading.",
            ),
            [],
          ),
          constructions: orDefault(
            doc(
              Schema.Array(
                Schema.Struct({
                  line: doc(
                    Schema.String,
                    "The grammar-file line shown for it, by its word (`お…する`).",
                  ),
                  before: doc(
                    strings,
                    "Spellings of the morpheme before the slot (`お`, `ご`).",
                  ),
                  slot: doc(
                    strings,
                    "Parts of speech of the one morpheme in the slot, as in `join` (`動詞`, `名詞-普通名詞-サ変可能`).",
                  ),
                  after: doc(
                    strings,
                    "What follows the slot, its last morpheme written or in its base form (`する`, `になる`, `ください`).",
                  ),
                }),
              ),
              "Constructions with a word in them, which no fixed spelling finds: `お` + a verb's stem + `する` is humble (`お待ちします`, `ご案内します`). The run shows `line` first, then the clicked word's entries. Phrases the dictionary spells out come first (`お願いします`).",
            ),
            [],
          ),
          formEndings: orDefault(
            doc(
              Schema.Array(
                Schema.Struct({
                  pos: doc(
                    strings,
                    "Parts of speech of the ending, as in `join`.",
                  ),
                  surface: Schema.optionalKey(
                    doc(strings, "Only these spellings of it (`て`, `で`)."),
                  ),
                  label: doc(
                    Schema.String,
                    "The label on the entries of the piece it ends (`て form`), explained in the language's `labels.toml`.",
                  ),
                }),
              ),
              "Endings that make a form of the piece before them, as a reader takes it: the ending closes that piece's segment, whose entries get `label`, with the ending's own line after them (`並んで`: `並ぶ` [て form] and `て`). What follows starts a segment that runs to the word's end or the next such ending (`並んで|います`, `作って|みました`).",
            ),
            [],
          ),
          prefixes: orDefault(
            doc(
              strings,
              "Parts of speech of morphemes that join the word after them (`接頭辞`: `お` + `茶`).",
            ),
            [],
          ),
          suffixes: orDefault(
            doc(
              strings,
              'Parts of speech of morphemes that make a new word of the word before them (`接尾辞`: `機械` + `屋` "mechanic"). Such a word without an entry of its own is shown by its parts, each with its own entries, not as its head.',
            ),
            [],
          ),
          auxiliaries: orDefault(
            doc(
              strings,
              "Parts of speech of auxiliary verbs that a `join` rule writes onto the verb before them (Kiwi's `VX`): the word is looked up as its text up to the auxiliary with the auxiliary's base forms first (`전해` + `지다`: `전해지다` \"to be passed down\"; `도와주다`), then by the head's own.",
            ),
            [],
          ),
          compoundPos: orDefault(
            doc(
              strings,
              'Parts of speech of morphemes that make a compound when a `join` rule writes them together (Korean `NNG`, `NNP`: `양자` + `역학`, "quantum mechanics"). Such a word without an entry of its own is shown by its parts, as a word made with `suffixes` is, the longest the dictionary has first (`발색|단`).',
            ),
            [],
          ),
          compoundPiece: orDefault(
            doc(
              Schema.Int,
              'Fewest letters a piece of a `compoundPos` morpheme the dictionary lacks may have when it is cut into nouns the dictionary has: shorter pieces match by chance (Korean `2`: not `간` "liver" in the name `간송`).',
            ),
            2,
          ),
          spacedWords: orDefault(
            doc(
              Schema.Boolean,
              'The language writes a space after each word with its particles and endings (Korean eojeols), so the piece the segmenter gives is a whole word. A headword spelled as it is written, other than a noun, verb or adjective, is that word, even where the analyzer cuts it into a stem and endings: it comes first (`하지만` "but", cut `하` + `-지만`). A word the analyzer reads as a verb with endings is no noun spelled alike (`하지` "summer solstice", for `하` + `-지`). Off for Japanese, written without spaces, where `だったら` after a noun is the copula, not the conjunction.',
            ),
            false,
          ),
          ranksByPos: orDefault(
            doc(
              Schema.Boolean,
              'A word\'s or part\'s entries of the parts of speech `upos` gives the analyzer\'s reading come before its others, which keep their order (Korean `우리` the pronoun "we" before `우리` "cage"; the particle `-는` before the ending). Off for Japanese, whose kana words are ranked by reading instead.',
            ),
            false,
          ),
          upos: orDefault(
            doc(
              Schema.Record(Schema.String, strings),
              "The dictionary's parts of speech (a prefix of its tags, as in `pos`) as Universal Dependencies tags (`名詞`: `NOUN`), to tell which entries fit the analyzer's reading of a word.",
            ),
            {},
          ),
        }),
        "A morphological analyzer finds the word around the clicked piece, for a script without spaces whose segmenter cuts words short (`食|べ|ま|した`). With context, the word is returned as `match` and its morphemes as `segments`, each looked up by its base form. Leave the table out for no analyzer.",
      ),
    ),
  }),
  "What the sentence around a word (`context`) adds to its lookup.",
);

const Headword = doc(
  Schema.Struct({
    labels: orDefault(
      doc(
        Schema.Array(FeatureName),
        "Grammar features shown as labels next to the headword (`f`, `anim`, `pf`), in this order. Features an article already shows are left out.",
      ),
      ["Gender", "Animacy", "Aspect", "Number"],
    ),
    otherSpellings: orDefault(
      doc(
        Schema.Boolean,
        "Show the lemma's other spelling beside it (`import.otherScriptTags`): the spelling the text uses first, the other in brackets (`学习 (學習)` in simplified text, `學習 (学习)` in traditional).",
      ),
      false,
    ),
    articles: Schema.optionalKey(
      doc(
        Schema.Struct({
          Masc: Schema.optionalKey(Schema.String),
          Fem: Schema.optionalKey(Schema.String),
          Neut: Schema.optionalKey(Schema.String),
          Com: Schema.optionalKey(Schema.String),
          Ptan: Schema.optionalKey(Schema.String),
        }),
        "The article a noun's lemma starts with, by gender (`Ptan`: plural-only nouns), for languages whose learners learn nouns with it (German `der Hund`). Several genders give `der/das Bonbon`. The gender is then not a label.",
      ),
    ),
  }),
  "How the headword shows its grammar.",
);

const Compounds = doc(
  Schema.Struct({
    linkers: doc(
      strings,
      'Linking elements between a modifier and the next part, tried in order; "" is a plain join.',
    ),
    nounLinkers: orDefault(
      doc(
        strings,
        "Of `linkers`, those that join a modifier to any noun (German `s`, `es`: `Arbeit|s|zeit`), so a modifier that is a noun's lemma scores with them as with a plain join; other linkers mostly mark a plural (`n`, `en`). For compounds of words, not of stems (no `stemEndings`).",
      ),
      [],
    ),
    stemEndings: Schema.optionalKey(
      doc(
        strings,
        "Endings a modifier drops before its linker, when modifiers are stems rather than words.",
      ),
    ),
    adjectiveEndings: Schema.optionalKey(
      doc(
        strings,
        "With `stemEndings`: endings of adjective forms, which a verb form needs to be a compound's head.",
      ),
    ),
  }),
  "Compound splitting, for words without an entry. Leave the table out for no splitting.",
);

export const Language = doc(
  Schema.Struct({
    code: doc(
      Schema.String,
      "wiktextract `lang_code`, and the locale for word segmentation.",
    ),
    name: doc(
      Schema.String,
      "The language's English name, as in the `#Polish` anchors of wiktextract links.",
    ),
    target: doc(
      Schema.String,
      "Target (gloss) language; always `en` for the English Wiktionary dump.",
    ),
    optionalLetters: orDefault(
      doc(
        Schema.Array(LetterPair),
        "Letters running text may write as another letter. Every form with `letter` is also indexed with `plain`, and compound stems may be written without it.",
      ),
      [],
    ),
    elision: orDefault(
      doc(
        Schema.Boolean,
        "Elided words are written onto the next word with an apostrophe (French `l'homme`, `qu'il`; Italian `dell'anno`), and segmenters keep the two as one word. A word without an entry of its own is split after its first apostrophe when both parts have entries: the word after it comes first, then the elided word, each with its segment. Words with an entry of their own stay whole (`aujourd'hui`, `d'abord`).",
      ),
      false,
    ),
    import: orDefault(Import, {}),
    context: orDefault(Context, {}),
    compounds: Schema.optionalKey(Compounds),
    headword: orDefault(Headword, {}),
  }),
  "A language record, languages/<code>/language.toml. Every key but code, name and target may be left out.",
);
export type Language = typeof Language.Type;

export class LanguageError extends Schema.TaggedError<LanguageError>()(
  "LanguageError",
  {
    file: Schema.String,
    message: Schema.String,
  },
) {}

/** The repo's `languages/` directory: one folder per language. */
export const LANGUAGES_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "languages",
);

export const languageFile = (code: string, dir = LANGUAGES_DIR): string =>
  join(dir, code, "language.toml");

/** Codes of the languages that have a `language.toml`, sorted. */
export const languageCodes = (dir = LANGUAGES_DIR): ReadonlyArray<string> =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((code) => existsSync(languageFile(code, dir)))
        .sort()
    : [];

const decode = Schema.decodeUnknownSync(Language);

/** Decode a language record; unknown keys are an error, so a typo can't pass unnoticed. */
export const decodeLanguage = (input: unknown): Language =>
  decode(input, { onExcessProperty: "error" });

/** Read `languages/<code>/language.toml`; throws a `LanguageError` when it is missing or invalid. */
export const readLanguage = (code: string, dir = LANGUAGES_DIR): Language => {
  const file = languageFile(code, dir);
  if (!existsSync(file)) {
    throw new LanguageError({
      file,
      message: `no language record for "${code}" (known: ${languageCodes(dir).join(", ")})`,
    });
  }
  try {
    const language = decodeLanguage(Bun.TOML.parse(readFileSync(file, "utf8")));
    if (language.code !== code) {
      throw new Error(`code is "${language.code}", expected "${code}"`);
    }
    return language;
  } catch (cause) {
    throw new LanguageError({
      file,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

/** `readLanguage` as an Effect. */
export const loadLanguage = (
  code: string,
  dir = LANGUAGES_DIR,
): Effect.Effect<Language, LanguageError> =>
  Effect.try({
    try: () => readLanguage(code, dir),
    catch: (cause) =>
      cause instanceof LanguageError
        ? cause
        : new LanguageError({
            file: languageFile(code, dir),
            message: String(cause),
          }),
  });

/**
 * The source language of a pair (`ru_en` -> `ru`): its record, or every
 * default when it has none, so a server can serve a pair before anyone
 * writes its record. Throws a `LanguageError` when the record is invalid.
 */
export const readPairLanguage = (
  pair: string,
  dir = LANGUAGES_DIR,
): Language => {
  const [code = pair, target = "en"] = pair.split("_");
  return existsSync(languageFile(code, dir))
    ? readLanguage(code, dir)
    : decodeLanguage({ code, name: code, target });
};

/** `readPairLanguage` as an Effect. */
export const pairLanguage = (
  pair: string,
  dir = LANGUAGES_DIR,
): Effect.Effect<Language, LanguageError> =>
  Effect.try({
    try: () => readPairLanguage(pair, dir),
    catch: (cause) =>
      cause instanceof LanguageError
        ? cause
        : new LanguageError({ file: pair, message: String(cause) }),
  });
