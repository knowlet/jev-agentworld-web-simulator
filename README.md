# Jev AgentWorld Web Simulator

一個隨瀏覽動作生成、並記住已探索頁面的**虛構網際網路**。目標與 [hanxiao/qwen-agentworld-35b-a3b-web-simulator](https://github.com/hanxiao/qwen-agentworld-35b-a3b-web-simulator) 相同：搜尋 → 開啟結果 → 點擊連結 → 持續探索 → 重訪同一個世界。

本版技術路線是：

- **OpenAI-compatible API**（預計 DeepSeek V4.1 Flash）只生成結構化搜尋／頁面內容。
- **Jev** 負責 bounded decisions，包括 search intent、page policy，以及 UI composition。
- **json-render 官方 experimental Jev integration** (`experimental_createEvaluator` + `experimental_composeSpec`) 直接把 app-owned component candidates 組成正式 `Spec`。
- **React + @json-render/react** 只渲染 server 已驗證、已 cache 的 `Spec`。

```text
query / URL / click context
        │
        ├─→ official experimental_createEvaluator (typesafe-ai/jev)
        │        └─→ world policy: intent / page type / palette
        │
        └─→ OpenAI-compatible generator
                 └─→ SearchDocument / PageDocument
                              │
                         Zod validation
                              │
                  atomic component candidates
                              │
                    experimental_composeSpec
                              │
                    validated json-render Spec
                              │
                   SQLite persistent world
                              │
                    @json-render/react UI
```

這不是搜尋引擎、爬蟲或可靠事實來源；模擬 URL 不會被實際抓取。

## 官方 json-render Jev preview

`experimental_composeSpec` / `experimental_createEvaluator` 目前仍未發佈到 npm。依官方 [Jev (Experimental)](https://json-render.dev/docs/jev) 指引，本 repo 使用 **source-built + pnpm pack** 的 `@json-render/core`，並固定到：

- upstream: `vercel-labs/json-render`
- commit: `3ad381881194e7011ad3ccd6d668033495a06c29`
- package version: `0.21.0`
- vendored archive: `vendor/json-render-core-3ad38188.tgz`
- SHA256: `0b002467614c0ade41e18ef6b15c116e9cf41fbe44cd49c6d93a49fe5adf73e6`

`vendor/json-render-core-3ad38188.json` 保存 provenance。`npm run verify:json-render` 會驗證 archive checksum，並確認安裝後確實 export 兩個官方 experimental API。renderer 仍固定 `@json-render/react@0.21.0`，與該 checkout package version 相同。

不要把 `@json-render/core` 改回 npm `0.21.0`：npm 發佈版目前沒有這兩個 experimental exports。

## 架構重點

### 1. 不再有 deterministic `compilePage()` / `compileSearch()`

Generator 只寫資料，例如：

```json
{
  "title": "Deep sea",
  "summary": "...",
  "sections": [...],
  "links": [...]
}
```

server 將資料轉成受 catalog 約束的 atomic candidates：

```text
Surface variants
Header
Section #1..N
optional image placeholder
Links container
Link #1..N
```

candidate 的 props 已經是具體資料；Jev **不能寫 prose、URL、CSS、JS 或任意 props**。它只決定 candidate membership、root、parent/slot 與 order。這正是 json-render 官方 Jev composer 的模型。

### 2. Jev policy 也走官方 Gateway evaluator

已移除自行實作的 TypeSafe `/systemone` HTTP client。search intent 與 page policy 直接重用 `experimental_createEvaluator` 回傳的 Choice evaluator。

官方 adapter 使用 Vercel AI Gateway v4 evaluation transport，預設 model ID：

```text
typesafe-ai/jev
```

因此 live 模式需要 **`AI_GATEWAY_API_KEY`**，不需要另一把 TypeSafe API key。

### 3. Cache 保存內容 + UI tree

一次成功 materialization 會一起保存：

```text
semantic document
json-render Spec
composition metadata
```

Reload／重訪同一 observation 不會重新呼叫 generator 或 Jev。`WORLD_EPOCH`、模型與 composition budget 都會進 namespace；換模型或 composer 設定不會污染舊世界。

### 4. 安全邊界

- Generator output 必須通過 Zod schema。
- Jev 只看到 candidate descriptions / explicit context，不會自動收到 raw props/state。
- candidate props 由 server 建立，navigation URL 只會編譯成 `/view?...` / `/search?...`。
- catalog 不允許 generated script 或 arbitrary action handler。
- composed spec 會再經 catalog validation 和最低語意 postcondition；失敗不寫 cache。
- UI renderer 最後仍拒絕任意外部 `href`。

## 本機啟動

需要 **Node.js 24+**。

```bash
git clone https://github.com/knowlet/jev-agentworld-web-simulator.git
cd jev-agentworld-web-simulator
npm ci
cp .env.example .env
npm run build
npm start
```

開啟 `http://127.0.0.1:3000`。

`.env.example` 預設：

```dotenv
APP_MODE=mock
```

mock 模式不會做任何外部 model call；但 UI tree 仍走**同一個官方 `experimental_composeSpec` 程式碼**，只是 evaluator 換成本地 deterministic fixture evaluator，供 CI 驗證 composer/candidate/renderer integration。

## Live 設定

```dotenv
APP_MODE=live

AI_GATEWAY_API_KEY=your_vercel_ai_gateway_key
JEV_MODEL=typesafe-ai/jev
JEV_EVALUATION_TIMEOUT_MS=10000
JEV_COMPOSE_TIMEOUT_MS=45000
JEV_COMPOSE_MAX_STEPS=4
JEV_COMPOSE_MAX_ELEMENTS=32
JEV_COMPOSE_MAX_DEPTH=4

OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-flash
OPENAI_API_KEY=your_generator_key
OPENAI_JSON_MODE=json_object
OPENAI_THINKING=disabled
OPENAI_MAX_TOKENS=4096
REQUEST_TIMEOUT_MS=120000
```

`OPENAI_MODEL=deepseek-flash` 只是預設示例；請填你 endpoint 真正提供的 DeepSeek V4.1 Flash model ID。本 repo 只依賴 OpenAI-compatible `/chat/completions`。

`OPENAI_JSON_MODE` 支援 `json_object` / `json_schema` / `off`。所有模式最後都還會跑本地 Zod validation。

## MVP 功能

- 虛構搜尋結果與 related searches。
- 直接輸入 URL。
- 頁面內 link 持續 materialize 下一頁。
- search intent / page type / palette 使用 Jev Choice。
- 官方 json-render Jev composer 選 component membership、root、grouping、placement、order。
- 五種 Surface layout：article / docs / forum / product / home。
- 四組 palette。
- SQLite 世界持久化、同站品牌／palette、來源摘要與 anchor context。
- 同一 observation request deduplication。
- browser back / forward / reload。
- mock/live 明確標示。

第一版刻意不做 agent autoplay、表單 mutation、購物車或 progressive spec streaming；先驗證完整 world loop 與官方 Jev composition。

## 測試

```bash
npm run verify:json-render
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

真實 API：

```bash
npm run test:live
```

### Offline CI

`CI (offline fixtures)` 在 push / PR / manual dispatch 執行：

- pinned source-built json-render archive + export verification
- TypeScript
- production build
- provider / Gateway transport contract tests
- official `experimental_composeSpec` candidate composition tests
- SQLite persistence / dedup / retry behavior
- XSS-safe rendering
- Chromium 搜尋 → 頁面 → link → back → reload

不使用 secrets、不呼叫外部模型。

### Live smoke

在 GitHub **Settings → Secrets and variables → Actions** 設定：

| 類型 | 名稱 | 用途 |
|---|---|---|
| Secret | `AI_GATEWAY_API_KEY` | Vercel AI Gateway；Jev official evaluator |
| Secret | `OPENAI_API_KEY` | generator API key |
| Variable | `OPENAI_BASE_URL` | 例如 `https://api.deepseek.com/v1` |
| Variable | `OPENAI_MODEL` | endpoint 真正的 DS4.1 Flash model ID |
| Variable, optional | `JEV_MODEL` | 預設 `typesafe-ai/jev` |
| Variable, optional | `OPENAI_JSON_MODE` | 預設 `json_object` |
| Variable, optional | `OPENAI_THINKING` | generic provider 建議 `omit`；DeepSeek 可用 `disabled` |
| Variable, optional | `JEV_*_TIMEOUT_MS` / compose limits | 調整 evaluator/composer budget |

然後：

**Actions → Live smoke (official json-render Jev + generator) → Run workflow**

live smoke 會驗證：Gateway Jev world policy、OpenAI-compatible content generation、官方 json-render Jev select/layout composition、兩個連續頁面、cache 零新增 provider call，以及 Chromium 實際渲染。

這仍是 integration smoke，不是 factuality、Jev confidence calibration 或長期 world-consistency benchmark。
