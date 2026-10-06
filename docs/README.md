# Surge CMS documentation

| Folder / file | What it holds |
|---|---|
| `API.md`, `api-manifest.json` | The REST API reference. **Generated** by `npm run docs:api` — do not edit by hand. |
| [`how-it-works/`](how-it-works/) | Guides and runbooks: deployment, publishing releases, plugins, shop and its providers, social, SEO, mail (SES), DNS, MCP. |
| [`sdk/`](sdk/) | Headless/SDK reference (entities, feature modules, permissions). Mirrored in the admin help at `/admin/help/sdk`. |
| [`components/`](components/) | Ready-made component snippets (HTML + JS) to paste into Components. |
| [`plans/`](plans/) | Active audits and implementation plans. |
| [`plans/completed/`](plans/completed/) | Finished audits and plans, kept for history. |
| [`plans/superpowers/`](plans/superpowers/) | Design specs (`specs/`) and implementation plans (`plans/`) written with the superpowers skills. |
| `assets/` | Source design files. |

Ops scripts are not here: see `scripts/` (`release.mjs`, `backup-to-r2.sh`) and `deploy/`.
