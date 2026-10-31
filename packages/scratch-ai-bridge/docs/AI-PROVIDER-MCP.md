# 本機模型 API 與 MCP

Scratch AI Bridge 提供兩種 AI 接入方式。兩種方式都只會產生待審 patch；Bridge 驗證 patch 後仍由使用者檢視差異並確認套用。

## Bridge 內使用本機模型 API

1. 在 Bridge 開啟作品；Canonical 作品展開「邊玩邊調整」，匯入的 SB3 展開「調整匯入作品的角色、舞台與變數」。
2. 展開「設定本機模型 API」，填入本機服務 URL 和 model ID。常見 URL 形式為 `http://localhost:1234/v1` 或 `http://127.0.0.1:11434/v1`，實際值依模型服務設定為準。
3. 本機服務若要求 API key 才填；不需要時留空。key 只存在目前頁面的記憶體，重整頁面即清除。
4. 輸入想做的調整，按「請本機 AI 提出修改」。回傳 patch 會先經格式、欄位、作品與 revision 驗證，再填入現有 patch 欄位。
5. 檢查差異後確認套用；原始 SB3 的 AI 候選按「確認套用 AI 修改」。模型呼叫不會替使用者套用 patch。

目前安全限制只允許 `localhost`、`127.0.0.1` 或 `::1`，因此不會將請求送到公開雲端 API。請在本機模型服務啟用允許 Bridge 網頁來源的 CORS。模型服務必須接受 OpenAI Chat Completions 相容格式；原生 tool calling 能力依模型而異。API 會最多執行 4 輪、8 次工具呼叫，單次請求最多 120 秒，傳送的 project prompt/request 合計最多 32 KB。

模型只會收到 Bridge 產生的精簡 Canonical 結構或原始 SB3 角色與變數摘要、允許修改的範圍和使用者本次輸入，不會收到 SB3 素材 bytes。Hosted 網頁可由瀏覽器直接連到 localhost，但瀏覽器、CSP/CORS 或模型 server 的設定可能拒絕連線；錯誤時仍可使用原本複製 prompt／貼回 patch 流程。

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

2. 在 Bridge 開啟作品，展開修改面板 →「連接外部 AI（MCP）」，按「連接 MCP」。Bridge 會向 localhost relay 配對 30 分鐘，無需複製或保存 token。瀏覽器若詢問是否允許本機連線，允許 Bridge 網頁連到自己的 localhost。
3. 回到 Codex 或其他 MCP host 對話。工具呼叫會直接檢查目前 Bridge 頁面的作品，並把候選 patch 與差異送回畫面。Bridge 必須保持開啟；關閉網頁、按「中斷 MCP」或 30 分鐘到期後，host 工具不能再操作該作品。

Server 提供三個工具：

- `inspect_project`：讀取目前 Bridge 頁面的精簡結構及可修改規則。
- `propose_live_patch`：讓 Bridge 依目前 revision 驗證外部模型提出的 live-patch JSON，並在頁面顯示差異。
- `get_patch_status`：查詢目前 Bridge 頁面的最近候選與 revision 狀態。

Server 不提供 apply tool，也不寫入檔案。AI 的候選會留在 Bridge 的差異審查區，由使用者確認套用。API 和 MCP 同時有待審 patch 時，Bridge 不會靜默互相覆蓋；需先處理目前候選。

Relay 只綁 loopback，使用 256-bit 隨機 token、30 分鐘到期、逐次 origin allowlist、Host 檢查、配對速率限制、每分鐘 20 次 MCP 工具呼叫限制、最多 4 筆等待中的請求和 20 秒請求逾時。預設允許 GitHub Pages 公開 origin 與 Vite localhost 開發 origin；其他部署需明確用 `--origin https://...` 加入。relay 不開放區網或公網 listener。

## 設計原則

- API 與 MCP 對 Canonical 共用 `tool-core.ts`；原始 SB3 共用 `raw-tool-core.ts`，目前每次提案限一項既有屬性或非雲端變數，不支援 AI 積木修改。
- 模型輸出經各作品類型的 validator 與 revision 檢查；未知工具、違規欄位與過期 revision 均被拒絕。
- 不在瀏覽器持久化 API key，不把 key 放到 URL、localStorage、IndexedDB、建置產物或 logs。
- API endpoint 限本機 loopback；MCP relay 讀取使用者配對的 Bridge 頁面目前開啟的作品。原始 SB3 的 AI 提案確認後會重載遊戲並重置進度。

## 連接區網中的自架模型

在執行 Bridge 的電腦啟動本機 gateway，將範例位址換成模型伺服器的私人 IPv4 和實際 port：

```sh
node packages/scratch-ai-bridge/scripts/scratch-ai-bridge-model-gateway.mjs --endpoint http://192.168.1.20:1234/v1
```

在作品的模型設定展開「配對區網模型 gateway」，使用預設 `http://127.0.0.1:43129` 配對，再填模型 ID 和要求。若 Bridge 網頁的 origin 非預設允許清單，啟動時加入 `--origin http://localhost:5178` 等實際 origin。預設清單是 GitHub Pages origin 與 localhost/127.0.0.1:5173；gateway 只監聽本機。停止程序或按中斷會撤銷配對。

gateway 僅允許啟動時指定的 RFC 1918 私人 IPv4，且不跟隨 redirect，不代理其他網址。它只把模型 API 請求轉送到該位置；需另有可用的 OpenAI-compatible 自架模型。HTTP 連線的作品文字與憑證會在區網明文傳輸；可用受信任 TLS 的 HTTPS 端點。瀏覽器可能要求允許此網站存取 loopback；如配對失敗，請檢查網站權限、防火牆和 gateway 是否仍在執行。端對端測試使用同一台電腦私人網卡上的模擬服務，尚未驗證另一台電腦或真實模型。

## 本機遊戲進度

展開預覽中的「本機遊戲進度」，輸入存檔名稱，可儲存、讀取、刪除或匯出/匯入 JSON。存檔包含原始角色的位置、方向、大小、可見狀態、造型、非雲端變數及清單，並依作品內容版本綁定；分身、執行緒及雲端資料不包含。舊版存檔僅恢復變數及清單。先執行作品再讀檔，遊戲腳本之後可能再次改寫資料。瀏覽器清除網站資料可能刪除本機存檔，需自行匯出備份；匯出檔可能包含玩家資料。

## 從另一台電腦使用 MCP（SSH）

如果 Bridge 網頁和 Node 專案在電腦 A、MCP host 在電腦 B，可讓 B 的 host 以 SSH 在 A 啟動 stdio server：

```toml
[mcp_servers.scratch_ai_bridge]
command = "ssh"
args = ["-T", "使用者@電腦A", "node", "/電腦A上的專案路徑/packages/scratch-ai-bridge/scripts/scratch-ai-bridge-mcp.mjs"]
```

A 需已啟用並設定 SSH，B 需能以 SSH 登入並驗證 A 的主機金鑰；A 的 Bridge 頁面仍要按「連接 MCP」。SSH 提供傳輸通道，不會自動安裝模型或開啟 Bridge。這是 stdio 的跨裝置使用方式；不等同遠端 Streamable HTTP MCP。尚未在兩台實體裝置上驗證此設定，且不需要付費雲端服務。

## 透過 SSH 通道使用 MCP HTTP

Bridge 所在電腦 A 可啟動只監聽 `127.0.0.1` 的 Streamable HTTP 接口，再由電腦 B 透過 SSH 轉送。此方式使用 SSH 驗證與加密，以及另一個獨立 bearer token；不提供 OAuth，也不適合直接公網部署。只支援 POST 與單一 Bridge 頁面，每次啟動的 HTTP 授權最多 30 分鐘。

在 A 以目前使用者建立本機 token 檔（妥善保存，不放進 Git 或聊天紀錄），並啟動服務：

```sh
umask 077
openssl rand -hex 32 > ~/.scratch-bridge-mcp-token
node packages/scratch-ai-bridge/scripts/scratch-ai-bridge-mcp-http.mjs --token-file ~/.scratch-bridge-mcp-token
```

在 A 的 Bridge 頁面按「連接 MCP」。在 B 建立 SSH 本機轉送，並將 MCP host 的 HTTP endpoint 設為 `http://127.0.0.1:43130/mcp`；host 的授權標頭需使用 A 的 token 檔內容作為 `Bearer` token。請透過安全方式把 token 交給 B 的 host；若 host 不支援自訂授權標頭，使用前節 SSH stdio 方式。

```sh
ssh -N -L 127.0.0.1:43130:127.0.0.1:43130 使用者@電腦A
```

HTTP 與瀏覽器 relay 都只監聽 A 的 loopback，請勿用反向代理或 SSH 設定將其公開。結束後停止 SSH 與服務；重新啟動服務前可重新產生 token。已用協定測試和本機 relay 驗證，尚未在兩台實體電腦上驗收。
