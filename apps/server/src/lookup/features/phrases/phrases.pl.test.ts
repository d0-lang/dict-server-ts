import { assert, describe, it } from "@effect/vitest";
import { lemmas } from "../../testing/dictionary.ts";
import { polish } from "../../testing/polish.ts";

describe("lookup with context", () => {
  it("inflects only the verb of a phrase", () => {
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "miało", "To miało miejsce wczoraj."),
      ["mieć miejsce", "mieć"],
    );
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "niczego", "To niczego nie brakuje."),
      ["nic"],
    );
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "prostu", "To jest po prostu sensacja."),
      ["po prostu", "prosty"],
    );
  });

  it("allows one word between a verb and the rest of its phrase outside German", () => {
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "miało", "Niż miało to miejsce."),
      ["mieć miejsce", "mieć"],
    );
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "w", "Że jest to się w dupie poprzewracało."),
      ["w"],
    );
  });

  it("takes an interjection only as a clause of its own", () => {
    assert.deepStrictEqual(lemmas(polish, "pl_en", "być", "No, może być."), [
      "może być",
      "być",
    ]);
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "być", "On nie może być gorzki."),
      ["być"],
    );
  });

  it("puts a reflexive verb first when its particle stands near, before or after", () => {
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "bawię", "Dobrze się bawię."),
      ["bawić się", "bawić"],
    );
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "bawiliśmy", "Bardzo się dziś bawiliśmy."),
      ["bawić się", "bawić"],
    );
    assert.deepStrictEqual(
      lemmas(polish, "pl_en", "się", "Dobrze się bawię.")[0],
      "bawić się",
    );
    // without the particle, the verb's own entry comes first
    assert.deepStrictEqual(lemmas(polish, "pl_en", "bawię", "Bawię dzieci."), [
      "bawić",
      "bawić się",
    ]);
  });
});
