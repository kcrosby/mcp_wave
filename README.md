# mcp-wave

A lightweight MCP server for the Wave (waveapps.com) GraphQL API. Two runtime dependencies (the MCP SDK and zod), no GraphQL library. A JSON config file controls which Wave actions the AI client is allowed to take.

## Contents

- [Requirements](#requirements)
- [Install and build](#install-and-build)
- [Connecting to Wave](#connecting-to-wave)
- [Environment variables](#environment-variables)
- [Permissions config file](#permissions-config-file)
- [Adding the server to an AI app](#adding-the-server-to-an-ai-app)
- [Tools](#tools)
- [Troubleshooting](#troubleshooting)
- [Status](#status)

## Requirements

- Node.js 20 or newer (the server uses the built-in `fetch`).
- A Wave account with at least one business.
- A Wave API full access token (see [Connecting to Wave](#connecting-to-wave)).

## Install and build

```bash
git clone https://github.com/kcrosby/mcp_wave.git   # or use your local copy
cd mcp_wave
npm install
npm run build        # compiles src/ to dist/
npm test             # optional: runs the policy tests in dist/test
```

The server entry point is `dist/index.js`. It speaks MCP over stdio, so it is started by your AI app, not run by hand.

## Connecting to Wave

| Item | Value |
|---|---|
| API | Wave public GraphQL API |
| Endpoint | `https://gql.waveapps.com/graphql/public` (set in `src/wave.ts`) |
| Method | `POST` with a JSON body `{ "query": ..., "variables": ... }` |
| Auth header | `Authorization: Bearer <WAVE_ACCESS_TOKEN>` |
| Timeout | `requestTimeoutMs` from the config file (default 30000 ms) |

To get a token:

1. Sign in at https://developer.waveapps.com with your Wave account.
2. Open **Manage Applications** and create an application (any name).
3. In the application, create a **full access token** and copy it. Wave shows it once.

The token acts as you on every business your Wave login can see, so treat it like a password. The server reads it only from the `WAVE_ACCESS_TOKEN` environment variable, never from the config file, so the config file is safe to commit.

### Finding your business id

Most tools take a `businessId`. There is no environment variable for it; the AI passes it on each call. To find it, ask your AI app to run `wave_list_businesses`, which returns each business's `id` and `name`. If you want to lock the server to specific businesses, put those ids in `businessIds` in the config file (see below).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `WAVE_ACCESS_TOKEN` | Yes | Wave full access token. The server exits with `WAVE_ACCESS_TOKEN is not set` if it is missing. |
| `WAVE_MCP_CONFIG` | No | Path to the permissions config file. Used when `--config` is not passed. |

Command-line flag: `--config <path>` points at the config file and takes priority over `WAVE_MCP_CONFIG`.

## Permissions config file

Copy `wave-mcp.config.example.json` to `wave-mcp.config.json` and edit it:

```json
{
  "mode": "readonly",
  "tools": {
    "wave_invoice_send": "deny"
  },
  "businessIds": [],
  "rawGraphql": "off",
  "maxPageSize": 100,
  "requestTimeoutMs": 30000
}
```

### Options

| Key | Values | Default | Meaning |
|---|---|---|---|
| `mode` | `readonly`, `readwrite`, `full` | `readonly` | `readonly`: read tools only. `readwrite`: plus create, update, clone, approve, mark sent, and money transactions. `full`: plus delete, archive, and send (emailing an invoice). |
| `tools` | `{ "tool_name": "allow" \| "deny" }` | `{}` | Per-tool override. Wins over `mode` in both directions, so you can deny one tool in `full` mode or allow one write tool in `readonly` mode. Tool names must match a tool in [Tools](#tools); an unknown name stops the server at startup. |
| `businessIds` | list of business id strings | `[]` | If non-empty, only these businesses can be read or changed. Calls for any other business are rejected. Tools that cannot be tied to a business id (patch, delete, archive, approve, clone, send, mark sent) are disabled even if allowed in `tools`, and `rawGraphql` is forced off. `wave_get_user`, `wave_list_businesses` and `wave_list_currencies` stay available. |
| `rawGraphql` | `off`, `read`, `full` | `off` | Enables `wave_graphql`, a passthrough that runs any GraphQL document, which covers the whole Wave API. `read` allows queries only (mutations and subscriptions are rejected); `full` allows mutations too, and requires `mode` to be `full`, because it can run any mutation regardless of `mode` or `tools`. In `read`, the check skips comments and strings the way GraphQL does, and rejects a document with an unterminated string. |
| `maxPageSize` | integer 1 to 200 | `100` | Cap on `pageSize` for list tools, whatever the AI asks for. |
| `requestTimeoutMs` | integer, at least 1000 | `30000` | Timeout for each request to Wave. |

The example file is read-only: it enables no write tools. Unknown keys (for example a misspelled `Mode` or `tool`) and unknown tool names are errors, so a typo cannot silently drop a restriction. An invalid config stops the server at startup with `Invalid config <path>: ...`.

### Full Wave Graph API coverage

The public Wave GraphQL API exposes more than the curated MCP wrapper set. This server intentionally ships a focused set of high-value tools for the common read/write operations, but it is not limited to those wrappers. The `wave_graphql` passthrough is the authoritative escape hatch for the full API surface: if `rawGraphql` is enabled and `mode` is `full`, the server can run any GraphQL document accepted by Wave, including operations not represented by a dedicated MCP tool.

This matches the official Wave Rust client coverage, which includes queries for `user`, businesses, customers, vendors, invoices, products, accounts, sales taxes, currencies, countries, account types, and account subtypes, plus mutations for customer/account/product/invoice/sales-tax changes, invoice approval and sending, and money-transaction creation. In other words, the MCP can reach the full Wave Graph API through the passthrough tool even when a specific wrapper is not implemented.

For a full-access test configuration, copy `wave-mcp.config.full.example.json` and adjust the `businessIds` list as needed:

```json
{
  "mode": "full",
  "tools": {},
  "businessIds": [],
  "rawGraphql": "full",
  "maxPageSize": 200,
  "requestTimeoutMs": 30000
}
```

This should be used only for a test business or a sandbox account, because it allows raw GraphQL mutations across the full API surface.

### How the config file is found

1. `--config <path>` on the command line.
2. The `WAVE_MCP_CONFIG` environment variable.
3. `wave-mcp.config.json` in the current working directory.
4. Built-in defaults (read-only, no raw GraphQL) if none of the above exists.

If a path is given explicitly (steps 1 or 2) and the file does not exist, the server fails rather than silently falling back to defaults. AI apps often start servers from an unpredictable working directory, so always pass an absolute `--config` path in client setup.

On startup the server logs to stderr which config it loaded and how many tools are enabled, then every write or destructive tool that is enabled (or `none`), for example:

```
[mcp-wave] config: C:\code\mcp_wave\wave-mcp.config.json; mode=readonly; 14 tools enabled
[mcp-wave] write tools enabled: none
```

### Example policies

Read-only bookkeeping assistant for one business:

```json
{ "mode": "readonly", "businessIds": ["QnVzaW5lc3M6..."] }
```

Read-only raw GraphQL access, but no write tools or mutations:

```json
{
  "mode": "readonly",
  "rawGraphql": "read",
  "businessIds": []
}
```

Can draft invoices and customers but cannot approve, email, or delete anything:

```json
{
  "mode": "readwrite",
  "tools": { "wave_invoice_approve": "deny", "wave_invoice_mark_sent": "deny" }
}
```

Full access including raw GraphQL (use with a test business first):

```json
{ "mode": "full", "rawGraphql": "full" }
```

> Important: `rawGraphql: "full"` is only allowed when `mode` is `"full"`. In read-only or readwrite mode, the highest raw GraphQL level is `"read"`.

## Adding the server to an AI app

Every client below needs the same three things:

- **command**: `node`
- **args**: the absolute path to `dist/index.js`, then `--config` and the absolute path to your config file
- **env**: `WAVE_ACCESS_TOKEN`

The examples use `C:/code/mcp_wave`. Replace it with your own path. Forward slashes work on Windows in JSON; if you use backslashes, double them (`C:\\code\\mcp_wave`). On macOS or Linux use a path like `/Users/you/mcp_wave`. Restart or reload the app after changing its config.

### Claude Desktop

1. Open Claude Desktop, go to **Settings > Developer > Edit Config**. This opens `claude_desktop_config.json`:
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the server under `mcpServers`:

```json
{
  "mcpServers": {
    "wave": {
      "command": "node",
      "args": [
        "C:/code/mcp_wave/dist/index.js",
        "--config",
        "C:/code/mcp_wave/wave-mcp.config.json"
      ],
      "env": { "WAVE_ACCESS_TOKEN": "your-token" }
    }
  }
}
```

3. Fully quit Claude Desktop (including the tray icon on Windows) and reopen it. The Wave tools appear under the tools (connectors) menu in the chat box.

Logs, if it fails to start: `%APPDATA%\Claude\logs\mcp-server-wave.log` (Windows) or `~/Library/Logs/Claude/mcp-server-wave.log` (macOS).

### Claude Code

Add it with the CLI. `--scope user` makes it available in every project; leave it off to add it to the current project only.

```bash
claude mcp add wave --scope user \
  -e WAVE_ACCESS_TOKEN=your-token \
  -- node C:/code/mcp_wave/dist/index.js --config C:/code/mcp_wave/wave-mcp.config.json
```

On Windows PowerShell, put the command on one line (or use a backtick instead of `\` for line continuation).

Check it with `claude mcp list`, or run `/mcp` inside a Claude Code session to see its status and tools.

To share the setup with a project instead, add a `.mcp.json` at the project root. Claude Code expands `${VAR}` from your environment, so the token stays out of the file:

```json
{
  "mcpServers": {
    "wave": {
      "command": "node",
      "args": ["C:/code/mcp_wave/dist/index.js", "--config", "C:/code/mcp_wave/wave-mcp.config.json"],
      "env": { "WAVE_ACCESS_TOKEN": "${WAVE_ACCESS_TOKEN}" }
    }
  }
}
```

### Cursor

Open **Cursor Settings > MCP > Add new global MCP server**, which edits `~/.cursor/mcp.json` (all projects). For one project, create `.cursor/mcp.json` in that project instead. Use the same block as Claude Desktop:

```json
{
  "mcpServers": {
    "wave": {
      "command": "node",
      "args": ["C:/code/mcp_wave/dist/index.js", "--config", "C:/code/mcp_wave/wave-mcp.config.json"],
      "env": { "WAVE_ACCESS_TOKEN": "your-token" }
    }
  }
}
```

The server should show a green dot in the MCP settings page. The tools are used by Cursor's Agent.

### VS Code (GitHub Copilot)

VS Code uses a `servers` key and supports prompting for secrets, so the token is not stored in the file. Create `.vscode/mcp.json` in a workspace, or run **MCP: Open User Configuration** from the Command Palette for all workspaces:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "wave-token",
      "description": "Wave full access token",
      "password": true
    }
  ],
  "servers": {
    "wave": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/code/mcp_wave/dist/index.js", "--config", "C:/code/mcp_wave/wave-mcp.config.json"],
      "env": { "WAVE_ACCESS_TOKEN": "${input:wave-token}" }
    }
  }
}
```

Click **Start** above the server entry in the file (or run **MCP: List Servers**), enter the token when asked, then open Copilot Chat in **Agent** mode and pick the Wave tools from the tools button.

### Windsurf

Open **Windsurf Settings > Cascade > MCP Servers > View raw config** (or edit `~/.codeium/windsurf/mcp_config.json` directly) and add:

```json
{
  "mcpServers": {
    "wave": {
      "command": "node",
      "args": ["C:/code/mcp_wave/dist/index.js", "--config", "C:/code/mcp_wave/wave-mcp.config.json"],
      "env": { "WAVE_ACCESS_TOKEN": "your-token" }
    }
  }
}
```

Click **Refresh** in the MCP panel. The tools are available to Cascade.

### Other MCP clients

Any client that supports local (stdio) MCP servers works, including Cline, Continue, Zed, and LM Studio. Most use the same `mcpServers` block shown for Claude Desktop; give it `command`, `args` and `env` as above.

### Testing without an AI app

The MCP Inspector lets you list and call the tools directly:

```bash
WAVE_ACCESS_TOKEN=your-token npx @modelcontextprotocol/inspector node dist/index.js --config ./wave-mcp.config.json
```

In PowerShell, set the token first with `$env:WAVE_ACCESS_TOKEN = "your-token"`, then run the `npx` part.

## Tools

Which tools are visible depends on the config. Disabled tools are not registered at all, so the AI never sees them.

**Read** (always available unless denied): `wave_get_user`, `wave_list_businesses`, `wave_get_business`, `wave_list_currencies`, `wave_list_accounts`, `wave_list_customers`, `wave_list_vendors`, `wave_list_products`, `wave_list_sales_taxes`, `wave_list_invoices`, `wave_get_customer`, `wave_get_invoice`, `wave_get_product`, `wave_get_account`.

**Write** (`readwrite` or `full`): `wave_customer_create`, `wave_customer_patch`, `wave_product_create`, `wave_product_patch`, `wave_account_create`, `wave_account_patch`, `wave_sales_tax_create`, `wave_sales_tax_patch`, `wave_invoice_create`, `wave_invoice_clone`, `wave_invoice_approve`, `wave_invoice_mark_sent`, `wave_money_transaction_create`.

**Destructive** (`full` only): `wave_invoice_send` (emails the customer), `wave_invoice_delete`, `wave_customer_delete`, `wave_product_archive`, `wave_account_archive`, `wave_sales_tax_archive`.

**Passthrough** (`rawGraphql` set to `read` or `full`): `wave_graphql`.

Mutation tools take an `input` object passed straight to Wave, so any field in Wave's input types works. Wave reports validation problems in `didSucceed` and `inputErrors`, which the tools return as-is.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `WAVE_ACCESS_TOKEN is not set` | The `env` block is missing from the client config, or the variable name is misspelled. |
| `Config file not found: ...` | The `--config` or `WAVE_MCP_CONFIG` path is wrong. Use an absolute path. |
| Only read tools appear | No config file was found (defaults are read-only), or `mode` is `readonly`. Check the startup log line for which config was loaded. |
| A tool you allowed is missing | `businessIds` is set, which disables tools that cannot be tied to a business. |
| `Business ... is not permitted` | The business id is not in `businessIds`. |
| `Wave error (HTTP 401)` | The token is wrong, expired, or was revoked. |
| Server does not start in the client | Run `node C:/code/mcp_wave/dist/index.js --config ...` in a terminal with the token set to see the error, and confirm `npm run build` has been run. |

