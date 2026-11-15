import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A subset of GitHub's issue form schema: what a typo here would break without a CI error.
const dir = new URL("ISSUE_TEMPLATE/", import.meta.url);
const read = async (name: string) =>
  Bun.YAML.parse(await Bun.file(new URL(name, dir)).text()) as Record<
    string,
    any
  >;
const forms = readdirSync(dir).filter(
  (name) => name.endsWith(".yml") && name !== "config.yml",
);

describe("issue forms", () => {
  it.each(forms)("%s matches GitHub's form schema", async (name) => {
    const form = await read(name);
    expect(typeof form.name).toBe("string");
    expect(typeof form.description).toBe("string");
    expect(Array.isArray(form.body)).toBe(true);
    const ids = form.body.flatMap((field: Record<string, any>) =>
      field.id === undefined ? [] : [field.id],
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const field of form.body) {
      expect([
        "input",
        "textarea",
        "dropdown",
        "markdown",
        "checkboxes",
      ]).toContain(field.type);
      if (field.type === "markdown") {
        expect(typeof field.attributes.value).toBe("string");
        continue;
      }
      expect(field.id).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(typeof field.attributes.label).toBe("string");
      if (field.type === "dropdown")
        expect(field.attributes.options.length).toBeGreaterThan(0);
      if (field.validations !== undefined)
        expect(typeof field.validations.required).toBe("boolean");
    }
  });

  it("names the word form's fields as report links fill them", async () => {
    const form = await read("word.yml");
    const fields = Object.fromEntries(
      form.body.map((field: Record<string, any>) => [field.id, field.type]),
    );
    // GitHub only fills text fields from a link, so `lang` is an input, not a dropdown.
    expect(fields).toEqual({
      lang: "input",
      word: "input",
      sentence: "textarea",
      shown: "textarea",
      expected: "textarea",
      client: "input",
    });
    expect(
      form.body.find((field: Record<string, any>) => field.id === "lang")
        .attributes.label,
    ).toBe("Language");
  });

  it("config.yml keeps blank issues and links the extension's forms", async () => {
    const config = await read("config.yml");
    expect(config.blank_issues_enabled).toBe(true);
    expect(config.contact_links).toEqual([
      expect.objectContaining({
        url: "https://github.com/d0-lang/extension/issues/new/choose",
      }),
    ]);
  });
});
