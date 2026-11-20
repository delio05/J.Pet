# OrbPet：桌面光球寵物

一個常駐在桌面上的光球桌寵，支援 **macOS 與 Windows**。有橙色光球和藍色光環兩種外觀，會呼吸、可以拖拽甩動，也有一些小互動。

> **本專案僅供個人娛樂與學習使用，非商業用途。**
> 詳見文末的[免責聲明](#免責聲明)。

![橙色光球](orange_preview.png) ![藍色光環](blue_preview.png)

---

## 快速開始

需求：已安裝 [Node.js](https://nodejs.org) 18 以上（建議 LTS 版）。macOS 和 Windows 都一樣。

```bash
git clone https://github.com/delio05/J.Pet.git
```

```bash
cd J.Pet
```

```bash
npm install
```

```bash
npm start
```

`npm install` 只需要第一次執行，會下載 Electron，大約 100 MB。之後每次只要 `npm start`。

### 用 Claude Code 啟動

在專案資料夾裡打開 Claude Code，對它說：

> 幫我安裝並啟動 OrbPet

Claude 會讀取 [`CLAUDE.md`](CLAUDE.md)，自動檢查 Node.js、安裝相依套件並啟動。之後想調整效果，也可以直接跟它說，例如「光球大一點」「拖拽手感輕一點」。

### 常見問題

| 狀況 | 處理方式 |
|---|---|
| `node: command not found` 或 `npm` 找不到 | 先到 https://nodejs.org 安裝 LTS 版，重新開終端機再試 |
| 找不到「J.」圖示 | macOS 在選單列右上角；Windows 在右下角系統匣，可能收在 `^` 裡 |
| 想關掉 | 「J.」圖示或光球右鍵 →「退出」 |
| 想重設設定 | 刪除設定檔：macOS 的 `~/Library/Application Support/orbpet/settings.json`；Windows 的 `%APPDATA%\orbpet\settings.json` |

---

## 功能

| 類別 | 內容 |
|---|---|
| 外觀 | 程式即時繪製的粒子光球（橙色）與 HUD 光環（藍色），右鍵「顏色」切換，會記住選擇 |
| 待機 | 依呼吸節奏縮放；外殼與光環慢速自轉 |
| 拖拽 | 拖動時朝前進方向變形並灑出碎片；放開可甩出，有重力、反彈、落地擠壓 |
| 互動 | 內核注視滑鼠、撫摸變亮、用力撞牆會頭暈、雙擊跳一下 |
| 閒置 | 沒人理時只會東張西望，不移動；90 秒後睡著（變暗、飄出小光點），滑鼠靠近即醒 |
| 系統狀態 | CPU 越忙越紅、呼吸越快；低電量時變暗 |
| 番茄鐘 | 專注 25 分鐘、休息 5 分鐘，中央顯示七段數碼管倒數；計時中光球鎖定；結束時蹦跳，跳到最高點時爆出碎片 |
| 剪貼簿 | 複製東西時，碎片被吸進光球，接著光球「吞」一下並閃光（可關閉，不保存內容） |
| 圖示 | macOS 選單列或 Windows 系統匣的「J.」：顯示或隱藏光球、番茄鐘、換色等；macOS 計時中會顯示剩餘時間 |

所有功能都**不需要任何系統權限**（不需要輔助使用、螢幕錄製、麥克風等）。

## 操作

| 動作 | 效果 |
|---|---|
| 拖拽、甩出 | 移動光球（番茄鐘計時中鎖定） |
| 雙擊 | 跳一下 |
| 滑鼠在球上來回滑 | 撫摸，光球變亮、微微顫動 |
| 右鍵，或點「J.」圖示 | 選單：隱藏光球、番茄鐘、系統狀態、顏色、剪貼簿反應、重力、回到中央、退出 |

## 自訂

參數集中在 `src/renderer/pet.js` 開頭，改完存檔，重新執行 `npm start` 即可：

- **`Cfg`**：外觀與物理，例如 `orbDiameter`（大小）、`gravity`、`floorRestitution`（彈性）、`dragStiffness`（拖拽跟手程度）、`throwScale`（甩出力道）。
- **`Behave`**：互動與行為，例如 `sleepAfter`、`focusMinutes`、`breakMinutes`、`dotGather`、`innerArcPeriod`、`brandText`（藍色光環中央文字）。

圖案本身（線條、顏色、圖形）在 `src/renderer/art.js`。改完可以執行 `npm run preview -- out.png`，輸出一張兩種主題的大張預覽圖。

## 專案結構

| 檔案 | 說明 |
|---|---|
| `src/main.js` | Electron 主程序：透明視窗、圖示、選單、游標、CPU、剪貼簿、設定 |
| `src/preload.js` | 主程序與畫面之間的訊息通道 |
| `src/renderer/` | 畫面：`art.js` 負責圖案，`pet.js` 負責物理、互動和繪製 |
| `assets/` | Windows 系統匣圖示 |
| `tools/` | 預覽圖工具（`npm run preview`） |
| `legacy-swift/` | 舊版 macOS 原生實作（Swift），僅供參考 |
| `CLAUDE.md` | 給 Claude Code 的說明 |

## 已知限制

- 作者只在 macOS 上實際測試過；Windows 版使用相同的跨平台程式碼，但尚未實機驗證。遇到問題歡迎回報。
- Electron 版比原生版吃資源：平靜時大約佔 10% 到 15% 的單核 CPU、記憶體約 300 MB。

---

## 授權

程式碼以 [MIT License](LICENSE) 授權。這份授權只涵蓋本專案的程式碼，不包含任何第三方名稱或商標，請見下方免責聲明。

## 免責聲明

- 本專案為**個人娛樂與學習用途的非商業作品**，不販售、不收費、不用於任何商業推廣。
- 藍色光環主題中出現的「J.A.R.V.I.S.」文字僅作為致敬（fan tribute）。「J.A.R.V.I.S.」及相關角色名稱、標誌與商標屬於其各自的權利人（如 Marvel / The Walt Disney Company）。
- 本專案與上述權利人**沒有任何隸屬、授權、贊助或背書關係**，也不代表其官方產品。
- 本專案所有圖形皆由程式自行繪製，未使用任何官方素材。
- 若要公開散佈、商業使用，或將本專案用於公司產品，請先把 `Behave.brandText` 改成自己的名稱，並自行確認相關的法律風險。
- 本軟體依「現狀」提供，不附帶任何明示或默示的保證；使用本軟體所產生的任何後果由使用者自行承擔。
