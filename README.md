# Jev AgentWorld Web Simulator

A fictional internet that materializes as you browse. Same core experiment as [Han Xiao's Qwen-AgentWorld simulator](https://github.com/hanxiao/qwen-agentworld-35b-a3b-web-simulator): search → open a result → follow links → revisit the same persisted world. **Not a search engine, scraper, or source of verified facts.**

This MVP splits the implementation into **Jev decisions + OpenAI-compatible content generation + actual json-render rendering**. No generated HTML, CSS, JavaScript, external images, or real-site requests.

```text
search query ─→ Jev intent ─→ generator SearchDocument ─┐
URL + referrer ─→ Jev layout/palette ─→ PageDocument ──┤
                                                     ↓
                              Zod validation → SQLite world
                                                     ↓
                             deterministic compiler → json-render → React
                                                     ↓
                                  local link click → another observation
```

Jev uses the documented `POST /v1/systemone` Choice API, not a fictitious chat-completions adapter. The generator uses `POST {OPENAI_BASE_URL}/chat/completions`. The model ID is configurable; `deepseek-flash` is an example for the intended DeepSeek endpoint, not a guarantee of any particular V4.1 deployment.

## Run locally

Requires **Node.js 22.16+**, npm, and a browser. SQLite uses Node's built-in `node:sqlite` (an experimental warning on Node 22 is expected).

```bash
git clone https://github.com/knowlet/jev-agentworld-web-simulator.git
cd jev-agentworld-web-simulator
npm install
cp .env.example .env
npm run build
npm start
```

Open **http://127.0.0.1:3000**. The example env explicitly uses `APP_MODE=mock`, providing deterministic fixtures with **zero model calls** and a conspicuous MOCK badge. Missing credentials never silently activate this mode. Without an env override the application defaults to live mode and requires a Jev key.

For the real pipeline, edit `.env`:

```dotenv
APP_MODE=live
JEV_API_KEY=your-typesafe-key
JEV_MODEL=jev-latest
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-flash
OPENAI_API_KEY=your-generator-key
OPENAI_JSON_MODE=json_object
OPENAI_THINKING=disabled
```

Use the model ID your endpoint actually exposes. `OPENAI_THINKING=disabled` is a **DeepSeek-specific** extension; set `omit` for other compatible providers. `OPENAI_JSON_MODE` supports `json_object`, `json_schema`, or `off`; off only omits the provider option, **never local schema validation**. There is no automatic fallback between modes. Some compatible endpoints do not support strict schema constraints; start with `json_object`. An empty generator API key is allowed for local endpoints that do not require authentication. `TYPESAFE_API_KEY` is also accepted as an alias for `JEV_API_KEY`.

The base URL must omit `/chat/completions`; include `/v1` only when required by that provider. No Qwen assistant-prefill, `seed`, or reasoning-channel stitching is used. Generation is whole-document JSON in this MVP, not token-streamed UI. Loading and error states are explicit; retry a failed observation with Reload/Retry.

`npm run dev` builds the frontend once and watches the server. After changing UI code, rerun `npm run build` and reload the browser. This intentionally avoids a second development server/HMR dependency.

## What works

- Fictional search results and related searches; direct URL navigation; recursively clickable pages.
- Jev search-intent choice; one batched Jev call for layout and palette on each new page.
- Five bounded layouts: article, documentation, forum, product and homepage; four palettes.
- React/json-render catalog and registry, compiled from a validated semantic document. The generator cannot invent components or action handlers.
- Persistent SQLite observations, same-site branding, referrer summary/anchor context, stable revisits, concurrent request de-duplication.
- Separate worlds by mode, provider/model configuration, schema/prompt version and `WORLD_EPOCH`.
- Browser back/forward/reload, explicit mock/live provenance, local-only navigation, safe image placeholders.

Cache is the world's persistence, not just a speed optimization. Refresh **does not regenerate an existing page**. Change `WORLD_EPOCH` to explore a new world without deleting old data. Errors are not cached. For simultaneous first visits, the first successful observation wins. One disconnected browser does not cancel a shared generation; provider requests are bounded by `REQUEST_TIMEOUT_MS`.

## Tests and GitHub Actions

```bash
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:e2e
# Explicitly calls real providers; .env must contain your configuration:
npm run test:live
```

### Offline CI

`CI (offline fixtures)` runs on push, pull request and manual dispatch. It needs **no secrets**. It checks TypeScript, the actual frontend build, provider request/response contracts, rejected URLs, safe rendering, SQLite persistence, cache isolation, concurrent failure/retry handling, and Chromium search → page → next link → back → reload. Mock screenshot filenames are prefixed `mock-`.

The artifact **`offline-validation-<run_id>`** includes the test log, Playwright report, screenshots/failure traces and dependency lock. During initial bootstrapping, CI creates a lock with `npm install` when none is present; once `package-lock.json` is committed it uses `npm ci`. Top-level versions are pinned, but transitive resolution is not fully reproducible until the lock is committed.

### Live smoke CI

Under **Settings → Secrets and variables → Actions**, add:

| Type | Name | Value |
|---|---|---|
| Secret | `JEV_API_KEY` | TypeSafe key (`TYPESAFE_API_KEY` alias also accepted) |
| Secret | `OPENAI_API_KEY` | Generator key; needed for hosted DeepSeek |
| Variable | `OPENAI_BASE_URL` | e.g. `https://api.deepseek.com/v1` |
| Variable | `OPENAI_MODEL` | model ID supported by your endpoint |
| Variable | `OPENAI_THINKING` | `disabled` for DeepSeek; `omit` for generic endpoints |
| Variable, optional | `OPENAI_JSON_MODE` | `json_object` (default), `json_schema`, or `off` |
| Variable, optional | `JEV_BASE_URL` / `JEV_MODEL` | defaults `https://api.typesafe.ai/v1` / `jev-latest` |
| Variable, optional | `OPENAI_MAX_TOKENS` / `REQUEST_TIMEOUT_MS` | defaults `4096` / `120000` |

Then manually run **Actions → Live smoke (Jev + generator) → Run workflow** on `develop`. Live calls never run automatically on pull requests. This starts a fresh world, requires actual Jev provenance, creates a search and two linked pages, confirms a revisit makes zero extra calls, and renders a cached live page in Chromium. Nominal budget: **3 Jev calls + 3 generator calls**, with at most one retry per request for 429/502/503/504/529 responses. No automatic schema repair/regeneration loop.

Artifact **`live-validation-<run_id>`** contains `live.json`, `live.md` and `live-page.png` when rendering succeeds. JSON includes fictional observations, elapsed times and numeric provider token usage; it does not contain API keys, request headers or raw upstream error bodies. Failed executions still upload available reports. These are integration checks, **not a benchmark of factual accuracy, calibrated policy confidence, or long-horizon consistency**.

## Security and scope

Bind to loopback by default. This is a **single-user local MVP with no authentication or tenant isolation**; do not expose it to the internet or a shared network as-is. Secrets stay on the server; there is no browser-side key storage/settings endpoint. Provider URLs are trusted operator configuration, not client inputs. Simulated page URLs are identifiers only and are never fetched. Redirects from provider endpoints are rejected. Response/body size limits, bounded retry/timeouts, concurrency limits, origin/host checks and CSP reduce common failure modes but do not make a public service production-ready.

Generated strings are escaped React text, not interpreted HTML/Markdown. All actual anchors point to local `/view` or `/search` routes; no external assets, fonts, stylesheets or scripts are loaded. The UI compiler owns component names and hierarchy.

**Not implemented:** agent autoplay, arbitrary form submissions, carts/login/payment state, search reranking, Jev consistency verifier, entity knowledge graph, progressive JSON patches, real images, pixel-identical site cloning, and multi-process generation locking. Same-site palette/name and referrer summaries improve continuity but are not a proof of a consistent world model. Jev confidence is shown in the API document; no uncalibrated confidence threshold is treated as a correctness guarantee.

`GET /api/health` reports local mode/store status only; it explicitly says `upstreamConnectivity: not-probed`. It is not a successful model-call assertion.

## API / layout

```text
POST /api/search  {"query":"deep sea exploration"}
POST /api/page    {"url":"https://atlas.test/ocean","from":"...","ctx":"..."}
GET  /api/health

src/domain.ts     bounded semantic schemas and URL handling
src/providers.ts  Jev and OpenAI-compatible HTTP contracts
src/world.ts      persistence, policy/generation orchestration, cache sharing
src/store.ts      SQLite namespace store
src/server.ts     HTTP API and static UI
ui/catalog.ts     semantic document → json-render spec
ui/registry.tsx   trusted component implementations
scripts/live.ts   real-provider smoke report
```

## References / license

Inspired by [qwen-agentworld-35b-a3b-web-simulator](https://github.com/hanxiao/qwen-agentworld-35b-a3b-web-simulator). This is a new, smaller implementation of that project's browsing concept, not a port of its HTML renderer or Qwen-specific code.

API contracts: [TypeSafe HTTP API](https://docs.typesafe.ai/api), [json-render catalog](https://json-render.dev/docs/catalog), [React renderer](https://json-render.dev/docs/api/react), [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/). Dependencies retain their own licenses; json-render is Apache-2.0. Project code is MIT.
