import { Context, Layer } from "effect";

export type AppConfigValues = {
  readonly port: number;
  readonly name: string;
  readonly languages: ReadonlyArray<string>;
  readonly includeLegal: boolean;
  readonly verificationUrls: ReadonlyArray<string>;
  readonly privacyShort: string;
  readonly tosShort: string;
  readonly privacyLink: string;
  readonly tosLink: string;
  readonly privacyChange: string | undefined;
  readonly tosChange: string | undefined;
  readonly identityFile: string;
};

const env = (name: string): string | undefined => {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const envString = (name: string, fallback: string): string =>
  env(name) ?? fallback;

const envList = (
  name: string,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const value = env(name);
  if (value === undefined) {
    return fallback;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : fallback;
};

const envBool = (name: string, fallback: boolean): boolean => {
  const value = env(name)?.toLowerCase();
  if (value === undefined) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  return fallback;
};

export const loadConfig = (): AppConfigValues => ({
  port: Number(envString("PORT", "3000")),
  name: envString("SERVER_NAME", "dict poc"),
  languages: envList("LANGUAGES", ["de_en"]),
  includeLegal: envBool("INCLUDE_LEGAL", true),
  verificationUrls: envList("VERIFICATION_URLS", [
    "https://example.invalid/verify",
  ]),
  privacyShort: envString(
    "PRIVACY_SHORT",
    "PoC privacy policy. Do not use in production.",
  ),
  tosShort: envString(
    "TOS_SHORT",
    "PoC terms of service. Do not use in production.",
  ),
  privacyLink: envString("PRIVACY_LINK", "https://example.invalid/privacy"),
  tosLink: envString("TOS_LINK", "https://example.invalid/tos"),
  privacyChange: env("PRIVACY_CHANGE"),
  tosChange: env("TOS_CHANGE"),
  identityFile: envString("IDENTITY_FILE", "data/identity.json"),
});

export class AppConfig extends Context.Service<AppConfig, AppConfigValues>()(
  "server/config/AppConfig",
) {
  static readonly layer = Layer.sync(AppConfig, () =>
    AppConfig.of(loadConfig()),
  );
}
