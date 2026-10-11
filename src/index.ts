#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { WaveClient } from "./wave.js";
import { TOOLS, isEnabled, checkBusiness, hasWriteOperation, enabledWriteTools } from "./tools.js";

const log = (m: string) => process.stderr.write(`[mcp-wave] ${m}\n`);
const result = (data: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  isError,
});

async function main() {
  const token = process.env.WAVE_ACCESS_TOKEN;
  if (!token) throw new Error("WAVE_ACCESS_TOKEN is not set");
  const { config, source } = loadConfig(process.argv.slice(2), process.env);
  const wave = new WaveClient(token, config.requestTimeoutMs);
  const server = new McpServer({ name: "mcp-wave", version: "0.1.0" });

  const enabled: string[] = [];
  for (const spec of TOOLS) {
    if (!isEnabled(spec, config)) continue;
    enabled.push(spec.name);
    server.tool(spec.name, spec.description, spec.shape, async (args: Record<string, any>) => {
      try {
        checkBusiness(spec, args, config);
        const { query, variables } = spec.build(args, config);
        return result(await wave.request(query, variables));
      } catch (e) {
        return result(String((e as Error).message), true);
      }
    });
  }

  const raw = config.businessIds.length > 0 ? "off" : config.rawGraphql;
  if (raw !== "off") {
    enabled.push("wave_graphql");
    server.tool(
      "wave_graphql",
      `Run an arbitrary GraphQL document against Wave (${raw === "read" ? "queries only" : "queries and mutations"}). Use introspection to explore the schema.`,
      { query: z.string(), variables: z.record(z.any()).optional() },
      async ({ query, variables }) => {
        if (raw === "read" && hasWriteOperation(query)) return result("rawGraphql is read-only in this config", true);
        try {
          return result(await wave.request(query, variables));
        } catch (e) {
          return result(String((e as Error).message), true);
        }
      },
    );
  }

  log(`config: ${source}; mode=${config.mode}; ${enabled.length} tools enabled`);
  const writes = enabledWriteTools(config);
  if (raw === "full") writes.push("wave_graphql (mutations allowed)");
  log(`write tools enabled: ${writes.length ? writes.join(", ") : "none"}`);
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  log(String(e.message ?? e));
  process.exit(1);
});
