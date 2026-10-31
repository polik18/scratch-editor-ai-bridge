# 本機模型 API 與 MCP

Scratch AI Bridge 提供兩種 AI 接入方式。兩種方式都只會產生待審 patch；Bridge 驗證 patch 後仍由使用者檢視差異並確認套用。

## Bridge 內使用本機模型 API

1. 在 Bridge 開啟作品並展開「執行作品」下方的「邊玩邊調整」。
2. 展開「設定本機模型 API」，填入本機服務 URL 和 model ID。常見 URL 形式為 `http://localhost:1234/v1` 或 `http://127.0.0.1:11434/v1`，實際值依模型服務設定為準。
3. 本機服務若要求 API key 才填；不需要時留空。key 只存在目前頁面的記憶體，重整頁面即清除。
4. 輸入想做的調整，按「請本機 AI 提出修改」。回傳 patch 會先經格式、欄位、作品與 revision 驗證，再填入現有 patch 欄位。
5. 按「檢查修改」看差異，再由使用者按「套用到執行中的遊戲」。模型呼叫不會替使用者套用 patch。

目前安全限制只允許 `localhost`、`127.0.0.1` 或 `::1`，因此不會將請求送到公開雲端 API。請在本機模型服務啟用允許 Bridge 網頁來源的 CORS。模型服務必須接受 OpenAI Chat Completions 相容格式；原生 tool calling 能力依模型而異。API 會最多執行 4 輪、8 次工具呼叫，單次請求最多 120 秒，傳送的 project prompt/request 合計最多 32 KB。

模型只會收到 Bridge 產生的精簡 Canonical 結構、允許修改的範圍和使用者本次輸入，不會收到 SB3 素材 bytes。Hosted 網頁可由瀏覽器直接連到 localhost，但瀏覽器、CSP/CORS 或模型 server 的設定可能拒絕連線；錯誤時仍可使用原本複製 prompt／貼回 patch 流程。

## 外部 AI 透過 MCP

MCP server 使用 stdio；外部 AI host 提供模型與對話。MCP 啟動時也會開一個只綁 `127.0.0.1` 的短程 relay，讓它把工具請求轉給目前 Bridge 頁面。需要 Node.js 及已安裝的 workspace dependencies。

1. 在 MCP host 設定 stdio server：

```sh
node /path/to/scratch-editor-ai-bridge/packages/scratch-ai-bridge/scripts/scratch-ai-bridge-mcp.mjs
```

Codex MCP 設定範例：

```toml
[mcp_servers.scratch_ai_bridge]
command = "node"
args = [
  "/path/to/scratch-editor-ai-bridge/packages/scratch-ai-bridge/scripts/scratch-ai-bridge-mcp.mjs",
]
```

若 Bridge 網頁使用自訂網域，額外加上該頁面的 origin：

```toml
args = [
  "/path/to/scratch-editor-ai-bridge/packages/scratch-ai-bridge/scripts/scratch-ai-bridge-mcp.mjs",
  "--origin",
  "https://你的Bridge網域",
]
```

2. 在 Bridge 開啟 Canonical IR 作品，展開「邊玩邊調整」→「連接外部 AI（MCP）」，按「連接 MCP」。Bridge 會向 localhost relay 配對 30 分鐘，無需複製或保存 token。瀏覽器若詢問是否允許本機連線，允許 Bridge 網頁連到自己的 localhost。
3. 回到 Codex 或其他 MCP host 對話。工具呼叫會直接檢查目前 Bridge 頁面的作品，並把候選 patch 與差異送回畫面。Bridge 必須保持開啟；關閉網頁、按「中斷 MCP」或 30 分鐘到期後，host 工具不能再操作該作品。

Server 提供三個工具：

- `inspect_project`：讀取目前 Bridge 頁面的精簡結構及可修改規則。
- `propose_live_patch`：讓 Bridge 依目前 revision 驗證外部模型提出的 live-patch JSON，並在頁面顯示差異。
- `get_patch_status`：查詢目前 Bridge 頁面的最近候選與 revision 狀態。

Server 不提供 apply tool，也不寫入檔案。AI 的候選會留在 Bridge 的差異審查區，由使用者確認套用。API 和 MCP 同時有待審 patch 時，Bridge 不會靜默互相覆蓋；需先處理目前候選。

Relay 只綁 loopback，使用 256-bit 隨機 token、30 分鐘到期、逐次 origin allowlist、Host 檢查、配對速率限制、每分鐘 20 次 MCP 工具呼叫限制、最多 4 筆等待中的請求和 20 秒請求逾時。預設允許 GitHub Pages 公開 origin 與 Vite localhost 開發 origin；其他部署需明確用 `--origin https://...` 加入。relay 不開放區網或公網 listener。

## 設計原則

- API 和 MCP 都使用同一個 `src/core/ai/tool-core.ts`：`inspectProjectForAi` 與 `proposeLivePatch`。
- 模型輸出都先通過既有 `parseLiveVariablePatch`。未知工具、違規欄位、過期 revision 與不合法 script 都會被拒絕。
- 不在瀏覽器持久化 API key，不把 key 放到 URL、localStorage、IndexedDB、建置產物或 logs。
- API endpoint 限本機 loopback；MCP server 只讀取使用者啟動時明確指定的 Canonical IR 路徑。
