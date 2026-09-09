import assert from "node:assert/strict";
import test from "node:test";
import {
  configurationProblems,
  premiumDistributionConfigurationProblems,
} from "../lib/env";

const PREMIUM_KEYS = [
  "ANPOS_PRIVATE_PREMIUM_REPO",
  "ANPOS_PREMIUM_RELEASE_REF",
  "ANPOS_PREMIUM_MANIFEST_SHA256",
  "ANPOS_PREMIUM_CONTENT_SET_SHA256",
] as const;

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const original = new Map<string, string | undefined>();
  for (const [key, next] of Object.entries(values)) {
    original.set(key, process.env[key]);
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try { fn(); }
  finally {
    for (const [key, previous] of original) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
}

function premiumMissing(problems: string[]): string[] {
  return problems.filter((problem) => PREMIUM_KEYS.some((key) => problem === `missing:${key}`));
}

test("Developer-only plan mapping does not require premium distribution configuration", () => {
  withEnv({
    ANPOS_MARKETPLACE_PLAN_MAP: '{"101":"developer"}',
    ANPOS_PRIVATE_PREMIUM_REPO: undefined,
    ANPOS_PREMIUM_RELEASE_REF: undefined,
    ANPOS_PREMIUM_MANIFEST_SHA256: undefined,
    ANPOS_PREMIUM_CONTENT_SET_SHA256: undefined,
  }, () => {
    assert.deepEqual(premiumMissing(configurationProblems()), []);
  });
});

test("Pro Team or Enterprise plan mapping requires all premium distribution evidence", () => {
  for (const planId of ["pro", "team", "enterprise"]) {
    withEnv({
      ANPOS_MARKETPLACE_PLAN_MAP: JSON.stringify({ "201": planId }),
      ANPOS_PRIVATE_PREMIUM_REPO: undefined,
      ANPOS_PREMIUM_RELEASE_REF: undefined,
      ANPOS_PREMIUM_MANIFEST_SHA256: undefined,
      ANPOS_PREMIUM_CONTENT_SET_SHA256: undefined,
    }, () => {
      assert.deepEqual(
        premiumMissing(configurationProblems()).sort(),
        PREMIUM_KEYS.map((key) => `missing:${key}`).sort(),
      );
    });
  }
});

test("valid premium configuration satisfies conditional premium checks", () => {
  withEnv({
    ANPOS_PRIVATE_TEMPLATE_REPO: "Vertex-Systems-Network/anpos-commercial-template",
    ANPOS_PRIVATE_PREMIUM_REPO: "Vertex-Systems-Network/anpos-premium-pro",
    ANPOS_PREMIUM_RELEASE_REF: "a".repeat(40),
    ANPOS_PREMIUM_MANIFEST_SHA256: "b".repeat(64),
    ANPOS_PREMIUM_CONTENT_SET_SHA256: "c".repeat(64),
  }, () => {
    assert.deepEqual(premiumDistributionConfigurationProblems(), []);
  });
});

test("premium configuration rejects template-repo reuse mutable refs and malformed digests", () => {
  withEnv({
    ANPOS_PRIVATE_TEMPLATE_REPO: "Vertex-Systems-Network/anpos-commercial-template",
    ANPOS_PRIVATE_PREMIUM_REPO: "Vertex-Systems-Network/anpos-commercial-template",
    ANPOS_PREMIUM_RELEASE_REF: "main",
    ANPOS_PREMIUM_MANIFEST_SHA256: "bad",
    ANPOS_PREMIUM_CONTENT_SET_SHA256: "c".repeat(64),
  }, () => {
    const problems = premiumDistributionConfigurationProblems();
    assert.ok(problems.includes("unsafe:ANPOS_PREMIUM_REPOSITORY_MUST_BE_DISTINCT"));
    assert.ok(problems.includes("invalid:ANPOS_PREMIUM_RELEASE_REF"));
    assert.ok(problems.includes("invalid:ANPOS_PREMIUM_MANIFEST_SHA256"));
  });
});
