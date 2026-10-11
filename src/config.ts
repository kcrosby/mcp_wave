import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { TOOLS } from "./tools.js";

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

export const ConfigSchema = z
  .object({
    /** readonly: read tools only. readwrite: plus create/update. full: plus delete/archive/send. */
    mode: z.enum(["readonly", "readwrite", "full"]).default("readonly"),
    /** Per-tool overrides. They win over mode in both directions. */
    tools: z.record(z.enum(["allow", "deny"])).default({}),
    /** If non-empty, only these Wave business ids may be touched. */
    businessIds: z.array(z.string()).default([]),
    /** Generic GraphQL passthrough tool. Forced off when businessIds is set. */
    rawGraphql: z.enum(["off", "read", "full"]).default("off"),
    maxPageSize: z.number().int().min(1).max(200).default(100),
    requestTimeoutMs: z.number().int().min(1000).default(30000),
  })
  /** Unknown keys are errors, so a typo cannot silently drop a restriction. */
  .strict()
  .superRefine((c, ctx) => {
    for (const name of Object.keys(c.tools)) {
      if (!TOOL_NAMES.has(name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tools", name], message: `Unknown tool "${name}"` });
      }
    }
    // Full passthrough can run any mutation, so it would bypass mode and every per-tool deny.
    if (c.rawGraphql === "full" && c.mode !== "full") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rawGraphql"], message: 'rawGraphql "full" requires mode "full"' });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): { config: Config; source: string } {
  const flag = argv.indexOf("--config");
  const explicit = flag >= 0 ? argv[flag + 1] : env.WAVE_MCP_CONFIG;
  const path = resolve(explicit ?? "wave-mcp.config.json");
  if (!existsSync(path)) {
    if (explicit) throw new Error(`Config file not found: ${path}`);
    return { config: ConfigSchema.parse({}), source: "defaults (no config file found)" };
  }
  const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`Invalid config ${path}: ${parsed.error.message}`);
  return { config: parsed.data, source: path };
}
