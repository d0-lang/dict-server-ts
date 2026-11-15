import { describe, expect, it } from "vitest";

const workflow = Bun.YAML.parse(
  await Bun.file(
    new URL("workflows/language-label.yml", import.meta.url),
  ).text(),
) as {
  permissions: unknown;
  jobs: {
    label: {
      permissions: unknown;
      steps: Array<{ env: Record<string, string>; with: { script: string } }>;
    };
  };
};
const step = workflow.jobs.label.steps[0]!;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/** Runs the workflow's script as actions/github-script does, and returns the labels it adds. */
const labelsFor = async (body: string | undefined) => {
  const added: Array<Array<string>> = [];
  const github = {
    rest: {
      issues: {
        addLabels: async (args: { labels: Array<string> }) =>
          void added.push(args.labels),
      },
    },
  };
  const context = { repo: { owner: "o", repo: "r" }, issue: { number: 1 } };
  await new AsyncFunction("github", "context", "process", step.with.script)(
    github,
    context,
    { env: { ISSUE_BODY: body } },
  );
  return added.flat();
};

/** An issue body as GitHub writes the "Wrong or missing word" form. */
const form = (lang: string) =>
  `### Language\n\n${lang}\n\n### The word you looked up\n\nHund\n\n### The sentence it was in\n\n_No response_\n\n### What the popover showed\n\nnothing\n\n### What you expected\n\ndog\n\n### App and version\n\ndadict/0.6.0`;

describe("language-label workflow", () => {
  it.each([
    ["de_en", "German"],
    ["ja_en", "Japanese"],
    ["jp", "Japanese"],
    ["pl", "Polish"],
    ["RU", "Russian"],
    ["uk_en", "Ukrainian"],
    ["German", "German"],
    ["german", "German"],
    ["  ukrainian  ", "Ukrainian"],
    ["`de_en`", "German"],
  ])("labels %j as %s", async (lang, label) => {
    expect(await labelsFor(form(lang))).toEqual([label]);
  });

  it("reads Windows line endings", async () => {
    expect(await labelsFor(form("pl_en").replaceAll("\n", "\r\n"))).toEqual([
      "Polish",
    ]);
  });

  it.each([
    ["an unknown language", form("French")],
    ["an unknown code", form("fr_en")],
    ["a name inside other text", form("I think German")],
    ["a prototype key", form("constructor")],
    ["no Language heading", "### The word you looked up\n\nde_en"],
    [
      "the language only under another heading",
      "### What you expected\n\nGerman",
    ],
    ["an empty body", ""],
    ["no body", undefined],
  ])("adds nothing for %s", async (_, body) => {
    expect(await labelsFor(body)).toEqual([]);
  });

  it("does not read the next field when Language is empty", async () => {
    expect(
      await labelsFor("### Language\n\n### The word you looked up\n\nGerman"),
    ).toEqual([]);
  });

  it("gets the body only through the environment, with issues: write alone", () => {
    expect(step.env).toEqual({ ISSUE_BODY: "${{ github.event.issue.body }}" });
    expect(step.with.script).not.toContain("${{");
    expect(workflow.permissions).toEqual({});
    expect(workflow.jobs.label.permissions).toEqual({ issues: "write" });
  });
});
