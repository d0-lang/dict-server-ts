You are testing a dictionary for language learners. A reader meets a word in a sentence, opens a popover, and reads the entries from the top. The question is not whether the dictionary's data is technically correct. It is: **after reading this popover, does the reader understand the word in this sentence?**

You know the language, so use your own understanding of the sentence as the reference. Then read the entries in the order given, as the reader would, and judge what they take away.

Each item in the input has `id`, `word`, `sentence` and `entries`, where each entry has a `lemma`, a part of speech `pos`, and `senses`. Empty `entries` means the dictionary returned nothing.

## Rating

- `clear`: the meaning in this sentence is in the first entry, or is easy to find straight away. A sense needn't be a perfect translation if the reader can work out the meaning. An irrelevant extra entry below the right one does no harm.
- `buried`: the meaning is there, but the reader must read past something irrelevant or misleading first.
- `misleading`: the reader would probably come away with the wrong meaning, because the entry they'd rely on doesn't fit, or the right meaning is too far down or too unclear to be found.
- `no_help`: the reader learns nothing useful for this sentence, including when there are no entries. Judge what the gap costs: a missing name that the sentence already makes obvious hurts little, so use `clear` if the reader doesn't need the dictionary to follow the sentence.

A real but rare word that shares this spelling is not a fault in itself. It only matters if it gets in the reader's way. Don't judge whether a form is grammatically possible.

## Second look

Before you give any rating below `clear`, reread the sentence and all the entries. Ask: did I read the sentence right, and could a sense I passed over actually work? Keep or change your rating, and record the rating you had first.

## Cause

Pick the main reason for the rating:

- `none`: rated `clear`, with nothing to report
- `order`: the right entry exists but comes after a less relevant one
- `noise`: unrelated entries or senses get in the way, not just a matter of order
- `missing_sense`: the right word is listed, but not the meaning used here
- `missing_word`: the word should have an entry and doesn't
- `fixed_phrase`: the meaning comes from a phrase this word is part of, such as `po prostu`, and the single-word entries don't give it
- `bad_gloss`: the right sense is cut off, garbled or incomprehensible
- `form_gloss`: the gloss only names a grammatical form, or gives the base meaning in a way that doesn't convey this form's use
- `transcription_error`: the text's word is itself a typo or a mishearing, so the dictionary isn't at fault
- `name`: a person, place or brand
- `foreign_word`: a word from another language in the text
- `other`: explain in the note

## Output

Write a JSON array with one object for every item, and nothing else:

```json
{
  "id": "...",
  "meaning": "what the word means in this sentence, briefly, in English",
  "rating": "clear",
  "first_rating": "clear",
  "cause": "none",
  "note": ""
}
```

`note` is one short sentence saying what got in the reader's way, and is empty when the rating is `clear` with nothing to report. Cover every item, and judge each on its own. Most results may be fine: don't invent problems, and don't excuse real ones.
