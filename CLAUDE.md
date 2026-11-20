# CLAUDE.md

給 Claude Code 的專案說明。使用者通常會說「幫我啟動」或「幫我改某個效果」。

## 專案是什麼

OrbPet：桌面光球寵物，支援 **macOS 與 Windows**。用 Electron 寫成：一個覆蓋整個螢幕的透明視窗，只有光球本身可以點擊。不需要任何系統權限。介面文字為繁體中文。

| 檔案 | 內容 |
|---|---|
| `src/main.js` | 主程序：透明視窗、選單列（macOS）或系統匣（Windows）圖示、右鍵選單、游標追蹤與點擊穿透、CPU、剪貼簿偵測、設定存檔 |
| `src/claude.js` | 和 Claude Code 連線：在 `~/.claude/settings.json` 安裝 hooks、開本機伺服器（127.0.0.1）收事件、維護工作階段狀態 |
| `src/preload.js` | 主程序與畫面之間允許使用的訊息通道 |
| `src/renderer/art.js` | 光球圖案（程式繪製，固定亂數種子）、主題、七段數碼管 |
| `src/renderer/pet.js` | 物理、互動、番茄鐘、碎片、繪製；開頭的 `Cfg`、`Behave` 是可調參數 |
| `src/renderer/sessions.js` | 終端機工作階段的畫面：光球上的分段弧線、懸浮彈窗；開頭的 `SessCfg`、`LOOK` 是可調參數 |
| `tools/` | `npm run preview`：把圖案輸出成大張預覽圖 |
| `legacy-swift/` | 舊版 macOS 原生 Swift 實作，僅供參考，已不再維護 |

## 幫使用者啟動（照順序做）

0. 如果使用者只給了 repo 網址：先確認有 `git`（`git --version`），再執行 `git clone https://github.com/delio05/J.Pet.git`，接下來的步驟都在 `J.Pet` 資料夾裡進行。
1. 確認有 Node.js 18 以上：`node -v`
   - 沒有的話，請使用者到 https://nodejs.org 下載 LTS 版安裝，或用他們慣用的套件管理工具安裝（macOS 可用 `brew install node`，Windows 可用 `winget install OpenJS.NodeJS.LTS`）。安裝需要使用者自己同意，不要代為操作。
2. 在專案根目錄執行 `npm install`，會下載 Electron，約 100 MB。
   - Windows PowerShell 如果出現「已停用指令碼執行」（execution policy），改用 `npm.cmd install` 和 `npm.cmd start`。不要修改系統的執行原則。
   - 下載 Electron 失敗或逾時（例如連不到 GitHub）：設定環境變數 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 後重跑 `npm install`。
   - 如果 `node_modules/electron/dist` 不存在（之前安裝中斷），刪掉 `node_modules` 後重新安裝。
3. 執行 `npm start`。這個指令會一直佔著終端機，請在背景執行，或請使用者另開終端機。
4. 告訴使用者：
   - 光球會從螢幕上方掉下來。
   - macOS 在選單列右上角有「J.」，Windows 在右下角系統匣有橙色「J.」圖示（可能收在 ^ 裡面）。從這裡可以隱藏或退出。
   - 右鍵點光球可以換顏色、開番茄鐘。
   - 程式沒有 Dock 或工作列視窗。

關閉：從選單選「退出」，或結束 `npm start` 的行程。

## 修改與驗證

- 先執行 `npm run check` 做語法檢查。
- 改了圖案（`art.js`）後，執行 `npm run preview -- /絕對路徑/out.png`，會在深色背景上把兩種主題畫大，方便檢查。這個指令不會啟動桌寵。
- 看不到使用者螢幕時，用除錯環境變數驗證（macOS／Linux 的寫法如下；Windows PowerShell 用 `$env:ORBPET_DEBUG=1; npm start`）：
  - `ORBPET_DEBUG=1 npm start`：把畫面端的錯誤印到終端機，每 3 秒印一次光球狀態。
  - `ORBPET_CAPTURE=/絕對路徑/out.png npm start`：4 秒後把光球附近 320×320 的畫面存成 PNG。用 `ORBPET_CAPTURE_DELAY=毫秒` 可以調整等待時間。截圖是透明背景。
  - `ORBPET_DEMO_POMO=10 npm start`：一啟動就開始 10 秒的番茄鐘，可以搭配截圖檢查倒數與慶祝效果。
  - `ORBPET_DEMO_ACTION=debugScan npm start`（或 `debugSay`、`debugThink`）：啟動 2 秒後觸發一次掃描、自言自語，或思考 6 秒。
  - `ORBPET_DEMO_SLEEP=6 npm start`：一啟動就睡著（會戴上聖誕帽），6 秒後叫醒，可以搭配截圖檢查帽子掉落。
- 拖拽、手感這類動態效果，無法從截圖判斷，改完請使用者實際試。
- 效能：平靜時以 `CALM_FPS`（預設 20）更新，動起來才用 60fps。不要改回全螢幕每幀重畫（GPU 會吃很重）。光球畫在小畫布 `#orb` 上，用 CSS 位移；碎片畫在全螢幕畫布 `#fx` 上，沒有碎片時不重畫。

## 注意事項

- 不要新增需要系統權限的功能（輔助使用、螢幕錄製、麥克風、日曆），除非使用者明確要求並了解要授權什麼。
- Claude Code 連線會修改使用者的 `~/.claude/settings.json`（只增減自己的 hooks，第一次會備份）。改 `src/claude.js` 時維持三件事：沒裝 Claude Code 就什麼都不做；OrbPet 沒開時 hook 立刻結束；事件內容不存檔、不外傳。測試時請把 `HOME` 指到暫存資料夾，不要動到真的設定。
- 剪貼簿只比對雜湊判斷「有沒有變」，不保存、不傳送內容；請維持這個做法。
- 點擊穿透靠主程序的 `setIgnoreMouseEvents`：游標在光球半徑內、或正在拖拽時，視窗才接收滑鼠。
- 設定存在 Electron 的 userData 資料夾裡的 `settings.json`（macOS：`~/Library/Application Support/orbpet/`；Windows：`%APPDATA%\orbpet\`）。
- 藍色主題中央文字是 `Behave.brandText`、思考動畫的摩斯電碼句子是 `Behave.morsePhrases`，兩者都和鋼鐵俠相關，見 README 的免責聲明。
- Windows 版是用 Electron 跨平台 API 寫的，但作者只在 macOS 上實測過。Windows 使用者回報問題時，優先檢查三件事：系統匣圖示、透明視窗、點擊穿透。
