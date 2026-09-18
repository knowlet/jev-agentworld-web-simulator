# Jev AgentWorld Web Simulator

一個隨著瀏覽動作生成、並記住既有頁面的**虛構網際網路**。目標與 [Han Xiao 的 Qwen-AgentWorld simulator](https://github.com/hanxiao/qwen-agentworld-35b-a3b-web-simulator) 相同：搜尋 → 開啟結果 → 點擊連結 → 持續探索 → 重訪同一個世界。

技術改用 **Jev 決策 + OpenAI-compatible API 生成 + json-render 渲染**。不是搜尋引擎、爬蟲或可靠事實來源；模擬網址不會被實際抓取。

```text
搜尋字串 ─→ Jev 搜尋意圖 ─→ Generator SearchDocument ─┐
URL / 來源 / 錨點 ─→ Jev 頁型與配色 ─→ PageDocument ─┤
                                                     ↓
                                Zod validation → SQLite world
                                                     ↓
                         deterministic compiler → json-render → React
                                                     ↓
                                  local link → 下一個模擬頁面
```

第一版刻意不做 agent autoplay、購物車或複雜表單；先讓完整瀏覽循環可運作、可驗證。實際使用 `@json-render/core` / `@json-render/react`，不是自行渲染 JSON 後掛上套件名稱。

## 本機啟動

需要 **Node.js 22.16+**、npm、瀏覽器。SQLite 使用 Node 內建 `node:sqlite`；Node 22 的 experimental warning 不代表啟動失敗。

```bash
git clone https://github.com/knowlet/jev-agentworld-web-simulator.git
cd jev-agentworld-web-simulator
npm ci
cp .env.example .env
npm run build
npm start
```

開啟 **http://127.0.0.1:3000**。範例 `.env` 明確設為 `APP_MODE=mock`，可以不放金鑰先檢查 UI。右上角會顯示 **MOCK · NO MODEL CALLS**；這些固定測試內容不是 Jev 或 LLM 的輸出。

程式在沒有設定覆寫時預設 `live`；缺少 Jev 金鑰會失敗，**不會偷偷 fallback 到 mock**。

### 切換真實 API

修改 `.env`：

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

`OPENAI_MODEL` 請填 endpoint 實際提供的 model ID。`deepseek-flash` 是預期 DeepSeek endpoint 的範例，**不保證任何特定帳號一定映射到 V4.1**。這個 repo 沒有硬編碼 DS4.1 專用 adapter。

`OPENAI_THINKING=disabled` 是 DeepSeek 擴充參數；使用其他相容服務時設定 `omit`，避免傳送不支援的欄位。`OPENAI_JSON_MODE` 可選 `json_object`、`json_schema`、`off`；`off` 只省略 provider 的 response_format，**仍保留本地 Zod 驗證**。不會自動切換模式。相容服務未必支援完整嚴格 schema，建議先用 `json_object`。

`OPENAI_BASE_URL` 不要包含 `/chat/completions`；是否需要 `/v1` 取決於服務。本地免驗證 endpoint 可以不填 `OPENAI_API_KEY`。Jev 金鑰也接受 `TYPESAFE_API_KEY` 別名。

生成使用完整 JSON response，**第一版沒有 token streaming / progressive rendering**，會顯示載入狀態，失敗可 Retry。不沿用原專案的 Qwen assistant prefill、seed 或 reasoning 拼接。

`npm run dev` 會先建置 UI，再監看後端程式。修改 UI 後需重新執行 `npm run build` 並刷新；沒有另外引入 HMR server。

## MVP 已包含

- 虛構搜尋結果、相關搜尋、直接輸入 URL、頁面內連結繼續生成。
- Jev 搜尋意圖 Choice；每個新頁面以單一 Jev request 同時決定 layout / palette。
- 五種受限版型：article、docs、forum、product、home；四組配色。
- 語意文件經 Zod 驗證後，確定性編譯為 json-render spec。模型不能新增任意 component 或 handler。
- SQLite 持久化、同站品牌／配色、來源頁摘要與連結文字上下文、重訪快取、同一請求生成去重。
- 瀏覽器上一頁／下一頁／重新載入；mock/live 標示；本地導覽和圖片占位。

**Cache 就是世界的持久化資料。** Reload 不會重新生成已存在的頁面。修改 `WORLD_EPOCH` 可開一個新世界而不刪除舊資料。模式、provider/model、schema/prompt 版本與 generation 設定也會隔離 namespace，因此 mock 資料不會混進 live。

失敗不會寫入 cache；並行首次造訪以第一個成功保存的 observation 為準。同站首次頁面生成會序列化以建立穩定品牌。瀏覽器離線不會中止其他請求共用的生成工作，但 provider 呼叫有 timeout。

## 測試與 GitHub Actions

```bash
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:e2e
# 以下會呼叫真實 API；.env 必須填好 credentials：
npm run test:live
```

`package-lock.json` 已納入版本控制，來自實際 CI 的 npm 安裝結果；CI 使用 `npm ci`。不以 mock 測試通過宣稱 real-provider 整合已通過。

### Offline CI：不需要 secrets

`CI (offline fixtures)` 在 push、PR 或手動觸發時執行：TypeScript、production build、27 個單元／契約測試，以及 2 個 Chromium 瀏覽測試。涵蓋 provider request/response contract、拒絕非法 URL、文字安全渲染、SQLite 跨重啟持久化、cache 隔離、並行失敗重試，以及搜尋 → 頁面 → 下一個連結 → 返回 → 刷新。

Artifact **`offline-validation-<run_id>`** 包含 `unit.tap`、Playwright HTML report、mock 首頁／搜尋／頁面截圖、失敗時的 traces，以及 lockfile。截圖以 `mock-` 命名，不當成 live model 品質證據。

初次驗證記錄：[CI #2](https://github.com/knowlet/jev-agentworld-web-simulator/actions/runs/35391369860) 在 commit `b1dd6d7` 通過。最新版本請看對應 commit 的 Actions 狀態。

### Live smoke：手動觸發、使用真實模型

在 **Settings → Secrets and variables → Actions** 設定：

| 類型 | 名稱 | 值／用途 |
|---|---|---|
| Secret | `JEV_API_KEY` | TypeSafe API key；也接受 `TYPESAFE_API_KEY` |
| Secret | `OPENAI_API_KEY` | 生成模型 API key；託管 DeepSeek 需要 |
| Variable | `OPENAI_BASE_URL` | 例如 `https://api.deepseek.com/v1` |
| Variable | `OPENAI_MODEL` | 服務實際提供的 model ID；預設 `deepseek-flash` |
| Variable | `OPENAI_THINKING` | DeepSeek 可設 `disabled`；一般相容服務設 `omit` |
| Variable，選填 | `OPENAI_JSON_MODE` | 預設 `json_object`；也可 `json_schema` / `off` |
| Variable，選填 | `JEV_BASE_URL` / `JEV_MODEL` | 預設 `https://api.typesafe.ai/v1` / `jev-latest` |
| Variable，選填 | `OPENAI_MAX_TOKENS` / `REQUEST_TIMEOUT_MS` | 預設 `4096` / `120000` |

前往 **Actions → Live smoke (Jev + generator) → Run workflow**，選 `develop`。也能在本機執行 `npm run test:live`。這個 workflow **不會在 PR 自動消耗 API 額度**。

每次以全新世界驗證：真實 Jev 搜尋判斷、generator 搜尋文件、兩個互相連結的頁面、cache 重訪零新增呼叫，再用 Chromium 渲染 live page。

正常預算為 **3 次 Jev + 3 次 generator**。遇到 429/502/503/504/529 時，每個 HTTP request 最多再試一次；不會無限重試、偷偷換模型或自行進入 schema repair loop。認證錯誤不重試。

Artifact **`live-validation-<run_id>`** 包含 `live.json`、`live.md`，成功渲染時另有 `live-page.png`。JSON 記錄虛構 observation、耗時、數字型 token usage；不保存 API key、Authorization header 或原始 upstream error body。失敗仍上傳已產生報告。

**Live smoke 是整合測試，不是事實正確性、Jev confidence 校準或長期世界一致性的 benchmark。初版交付時尚未執行真實 provider 驗證。**

## 安全與限制

預設 bind loopback。這是**單人本機 MVP，沒有 authentication / tenant isolation**，不要直接公開到網際網路或共用網路。Credentials 只留後端，沒有瀏覽器金鑰儲存或 `/settings` API。

Provider URL 是可信任管理者環境設定，不接受 client 覆寫；模擬網頁 URL 只是識別資料，永遠不拿去 fetch。Provider redirect 被拒絕；有 response/body 大小限制、timeout、bounded retry、並行數量限制、Origin/Host 檢查及 CSP，但這些不等於已可公開部署。

模型內容以 React text escaping 渲染，不解讀 HTML / Markdown，不載入外部圖片、字体、CSS 或 script。實際連結只通往本站 `/view` 或 `/search`。元件名稱、結構與導航 handler 由程式控制。

未實作：agent autoplay、任意表單互動、購物車／登入／付款狀態、Jev 搜尋 reranking、一致性 verifier、實體知識圖、progressive patches、真實圖片、像素級網站重現，以及跨 process generation lock。同站 profile 與 referrer summary 只提供有限一致性，不等於 native world model 的行為保證。

`GET /api/health` 只回報本地狀態，明示 `upstreamConnectivity: not-probed`，不是模型連線成功證明。

## API / 程式配置

```text
POST /api/search  {"query":"deep sea exploration"}
POST /api/page    {"url":"https://atlas.test/ocean","from":"...","ctx":"..."}
GET  /api/health

src/domain.ts     語意 schema / URL 處理
src/providers.ts  Jev / OpenAI-compatible HTTP adapter
src/world.ts      決策、生成、持久化協調與去重
src/store.ts      SQLite namespace store
src/server.ts     HTTP API / static UI
ui/catalog.ts     PageDocument → json-render spec
ui/registry.tsx   可信任 React components
scripts/live.ts   真實 provider smoke report
```

## References / License

本專案借鑑 [qwen-agentworld-35b-a3b-web-simulator](https://github.com/hanxiao/qwen-agentworld-35b-a3b-web-simulator) 的瀏覽概念，是新的精簡實作，不移植其 HTML renderer 或 Qwen-specific 程式碼。

API 契約：[TypeSafe HTTP API](https://docs.typesafe.ai/api)、[json-render catalog](https://json-render.dev/docs/catalog)、[React renderer](https://json-render.dev/docs/api/react)、[DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)。

專案程式碼採 MIT；相依套件保留各自授權，json-render 為 Apache-2.0。
