# @sitesurge/mcp

A stdio **Model Context Protocol** server that exposes the entire SiteSurge CMS
authoring surface — pages, posts, every content-block type, block styles,
appearance (colors/swatches/fonts/layout), the site header + footer, navigation,
media, and settings/features — as **66 curated tools** an AI agent can call to
design and build a whole site. It is a thin wrapper over the `@sitesurge/client` SDK
using a scoped `ssk_…` API key, and adds authoritative block schemas
(`describe_block_types`) plus workflow ergonomics (group nesting,
single-post-block edits, media-from-path-or-URL, style templates).

## Run

```bash
npm run build -w packages/cms-mcp
CMS_BASE_URL=http://localhost:3001 CMS_API_KEY=ssk_… cms-mcp
# or: node packages/cms-mcp/dist/index.js
```

**Env vars:** `CMS_BASE_URL` (required), `CMS_API_KEY` (required, `ssk_…`;
write/admin scope to author, read scope for read-only), `CMS_MCP_READONLY`
(`"true"` → read tools only), `CMS_MCP_TIMEOUT_MS` (optional timeout override).

## MCP-client config

```json
{
  "mcpServers": {
    "sitesurge-cms": {
      "command": "node",
      "args": ["/abs/path/to/rw-cms/packages/cms-mcp/dist/index.js"],
      "env": { "CMS_BASE_URL": "http://localhost:3001", "CMS_API_KEY": "ssk_…" }
    }
  }
}
```

## Full reference

See [`../../docs/MCP.md`](../../docs/MCP.md) for the complete tool reference, the
content-authoring guide (pages vs posts, group nesting, block styles, wiring),
behavior/gotchas, and verification.
