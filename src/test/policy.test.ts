import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigSchema } from "../config.js";
import { TOOLS, isEnabled, hasWriteOperation, checkBusiness } from "../tools.js";

const names = (c: object) => TOOLS.filter((t) => isEnabled(t, ConfigSchema.parse(c))).map((t) => t.name);

test("default config is read-only", () => {
  const n = names({});
  assert.ok(n.includes("wave_list_invoices"));
  assert.ok(!n.includes("wave_customer_create"));
  assert.ok(!n.includes("wave_invoice_send"));
});

test("readwrite excludes destructive; full includes it", () => {
  assert.ok(!names({ mode: "readwrite" }).includes("wave_invoice_delete"));
  assert.ok(names({ mode: "full" }).includes("wave_invoice_delete"));
});

test("overrides win in both directions", () => {
  assert.ok(names({ tools: { wave_customer_create: "allow" } }).includes("wave_customer_create"));
  assert.ok(!names({ mode: "full", tools: { wave_invoice_send: "deny" } }).includes("wave_invoice_send"));
});

test("business allowlist removes unscoped mutations and enforces ids", () => {
  const cfg = ConfigSchema.parse({ mode: "full", businessIds: ["b1"] });
  assert.ok(!names({ mode: "full", businessIds: ["b1"] }).includes("wave_invoice_delete"));
  const list = TOOLS.find((t) => t.name === "wave_list_customers")!;
  assert.throws(() => checkBusiness(list, { businessId: "b2" }, cfg));
  checkBusiness(list, { businessId: "b1" }, cfg);
});

test("write detection ignores strings and comments", () => {
  assert.equal(hasWriteOperation('query{a(x:"mutation")} # mutation'), false);
  assert.equal(hasWriteOperation('query{a(x:"""mutation \\""" mutation""")}'), false);
  assert.equal(hasWriteOperation("mutation{x}"), true);
  assert.equal(hasWriteOperation("subscription{x}"), true);
});

test("write detection cannot be hidden by a quote inside a comment", () => {
  assert.equal(hasWriteOperation('# "\nmutation{customerDelete(input:{id:"x"}){didSucceed}} # "'), true);
  assert.equal(hasWriteOperation('"""\nmutation{x}'), true);
  assert.equal(hasWriteOperation('query{a(x:"open)}\nmutation{x}'), true);
});

test("no write tool is enabled by default", () => {
  const enabled = names({});
  for (const t of TOOLS.filter((t) => t.kind !== "read")) assert.ok(!enabled.includes(t.name), t.name);
});

test("config rejects typos", () => {
  assert.throws(() => ConfigSchema.parse({ tools: { wave_invoice_sned: "deny" } }), /Unknown tool/);
  assert.throws(() => ConfigSchema.parse({ Mode: "full" }));
});

test("rawGraphql full requires mode full", () => {
  assert.throws(() => ConfigSchema.parse({ rawGraphql: "full" }), /requires mode/);
  assert.throws(() => ConfigSchema.parse({ mode: "readwrite", rawGraphql: "full" }), /requires mode/);
  ConfigSchema.parse({ mode: "full", rawGraphql: "full" });
  ConfigSchema.parse({ rawGraphql: "read" });
});

test("example config is read-only", async () => {
  const { readFileSync } = await import("node:fs");
  const example = JSON.parse(readFileSync(new URL("../../wave-mcp.config.example.json", import.meta.url), "utf8"));
  const cfg = ConfigSchema.parse(example);
  assert.deepEqual(TOOLS.filter((t) => t.kind !== "read" && isEnabled(t, cfg)).map((t) => t.name), []);
  assert.equal(cfg.rawGraphql, "off");
});

test("every tool builds a query", () => {
  const cfg = ConfigSchema.parse({});
  for (const t of TOOLS) assert.match(t.build({ page: 1, pageSize: 10, businessId: "b", input: {} }, cfg).query, /^(query|mutation)/);
});
