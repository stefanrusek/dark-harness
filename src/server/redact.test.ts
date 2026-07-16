import { describe, expect, test } from "bun:test";
import type { DhConfig } from "../contracts/index.ts";
import { collectConfigSecrets, redactSecrets } from "./redact.ts";

describe("redactSecrets — known-value (exact match)", () => {
  test("redacts an exact known secret occurrence", () => {
    expect(redactSecrets('{"a":"mysecretvalue123"}', ["mysecretvalue123"])).toBe(
      '{"a":"[REDACTED:config-secret]"}',
    );
  });

  test("matches the JSON-escaped form of a secret containing a quote", () => {
    const secret = 'val"ue1234567';
    const text = JSON.stringify({ a: `prefix ${secret} suffix` });
    const result = redactSecrets(text, [secret]);
    expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED:config-secret]");
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test("skips known secrets shorter than 8 characters (guard)", () => {
    expect(redactSecrets('{"a":"short1"}', ["short1"])).toBe('{"a":"short1"}');
  });

  test("redacts every occurrence, not just the first", () => {
    const result = redactSecrets('{"a":"dup12345","b":"dup12345"}', ["dup12345"]);
    expect(result).toBe('{"a":"[REDACTED:config-secret]","b":"[REDACTED:config-secret]"}');
  });

  test("no-op when no known secrets are given", () => {
    expect(redactSecrets('{"a":"anything"}')).toBe('{"a":"anything"}');
  });
});

describe("redactSecrets — pattern table", () => {
  test("anthropic key: sk-ant-...", () => {
    expect(redactSecrets("sk-ant-api03-abcdefghij1234567890")).toBe("[REDACTED:anthropic-key]");
  });

  test("generic api key: sk-... (adjacent negative: too short)", () => {
    expect(redactSecrets("sk-abcdefghijklmnopqrstuvwx")).toBe("[REDACTED:api-key]");
    expect(redactSecrets("sk-shortkey")).toBe("sk-shortkey");
  });

  test("AWS access key id: AKIA/ASIA prefix (adjacent negative: wrong prefix)", () => {
    expect(redactSecrets("AKIAABCDEFGHIJKLMNOP")).toBe("[REDACTED:aws-key-id]");
    expect(redactSecrets("ASIAABCDEFGHIJKLMNOP")).toBe("[REDACTED:aws-key-id]");
    expect(redactSecrets("AKXAABCDEFGHIJKLMNOP")).toBe("AKXAABCDEFGHIJKLMNOP");
  });

  test("aws_secret_access_key key=value: key name preserved, value redacted", () => {
    expect(redactSecrets("aws_secret_access_key=abcDEF123456789")).toBe(
      "aws_secret_access_key=[REDACTED:aws-secret]",
    );
    expect(redactSecrets("aws_session_token: abcDEF123456789")).toBe(
      "aws_session_token: [REDACTED:aws-secret]",
    );
  });

  test("Authorization header: scheme preserved, credential redacted (adjacent negative: no colon)", () => {
    expect(redactSecrets("Authorization: Bearer abc123xyz")).toBe(
      "Authorization: Bearer [REDACTED:auth-header]",
    );
    expect(redactSecrets("authorization_header_name is unrelated")).toBe(
      "authorization_header_name is unrelated",
    );
  });

  test("GitHub token: gh[pousr]_... (adjacent negative: too short)", () => {
    expect(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz1234567890AB")).toBe(
      "[REDACTED:github-token]",
    );
    expect(redactSecrets("ghp_tooshort")).toBe("ghp_tooshort");
  });

  test("JWT: three dot-separated base64url segments", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(redactSecrets(jwt)).toBe("[REDACTED:jwt]");
  });

  test("Slack token: xox[baprs]- prefix (adjacent negative: wrong letter)", () => {
    expect(redactSecrets("xoxb-1234567890-abcdefghij")).toBe("[REDACTED:slack-token]");
    expect(redactSecrets("xozb-1234567890-abcdefghij")).toBe("xozb-1234567890-abcdefghij");
  });

  test("Google API key: AIza prefix, 35 chars (adjacent negative: too short)", () => {
    expect(redactSecrets(`AIza${"A".repeat(35)}`)).toBe("[REDACTED:google-key]");
    expect(redactSecrets("AIzaShort")).toBe("AIzaShort");
  });

  test("ordinary source code identifiers are left untouched (no generic key=value matching)", () => {
    const code = "const token = getToken(); // password field, secret handling here";
    expect(redactSecrets(code)).toBe(code);
  });

  test("replacement tokens contain no characters requiring JSON escaping", () => {
    const line = JSON.stringify({ content: "sk-ant-api03-abcdefghij1234567890" });
    const result = redactSecrets(line);
    expect(() => JSON.parse(result)).not.toThrow();
  });
});

describe("collectConfigSecrets", () => {
  function config(overrides: Partial<DhConfig> = {}): DhConfig {
    return {
      options: { defaultModel: "sonnet" },
      models: [],
      provider: [],
      ...overrides,
    };
  }

  test("collects security.token", () => {
    expect(collectConfigSecrets(config({ security: { token: "tok12345" } }))).toEqual(["tok12345"]);
  });

  test("collects every provider apiKey", () => {
    const secrets = collectConfigSecrets(
      config({
        provider: [
          { name: "p1", type: "anthropic", apiKey: "key-one-abc" },
          { name: "p2", type: "bedrock", apiKey: "key-two-def" },
        ],
      }),
    );
    expect(secrets).toEqual(["key-one-abc", "key-two-def"]);
  });

  test("collects mcpServers header values", () => {
    const secrets = collectConfigSecrets(
      config({
        mcpServers: {
          svc: { url: "https://example.com", headers: { Authorization: "Bearer abc12345" } },
        },
      }),
    );
    expect(secrets).toEqual(["Bearer abc12345"]);
  });

  test("returns an empty array when config holds no secrets", () => {
    expect(collectConfigSecrets(config())).toEqual([]);
  });
});
