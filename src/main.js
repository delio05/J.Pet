// OrbPet 主程序：視窗、選單列/系統匣圖示、右鍵選單、游標追蹤、CPU、剪貼簿偵測、設定存檔
// 光球的繪圖、物理、互動都在 renderer（src/renderer/pet.js）
'use strict';

const { app, BrowserWindow, screen, Tray, Menu, ipcMain, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const claude = require('./claude');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const isMac = process.platform === 'darwin';

// ---------- 設定（存在使用者資料夾的 settings.json） ----------
const DEFAULT_SETTINGS = { theme: 'orange', clipboardReact: true, gravity: true, claudeCode: true };
let settings = { ...DEFAULT_SETTINGS };
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  delete settings.demoSessions; // 舊版留下的「模擬終端機」設定，已移除
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('save settings failed', e);
  }
}

// ---------- 狀態 ----------
let win = null;
let tray = null;
let hidden = false;
let displayId = null;
let orb = { x: 0, y: 0, r: 46, dragging: false };   // renderer 每幀回報
let petState = { pomo: null, cpu: 0, battery: null }; // renderer 每 250ms 回報（選單與圖示用）
let ignoring = null;

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// ---------- 視窗：覆蓋整個螢幕的透明視窗，只有光球本身可點擊 ----------
function createWindow() {
  const d = screen.getPrimaryDisplay();
  displayId = d.id;
  win = new BrowserWindow({
    ...d.bounds,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,          // 點光球不會搶走其他 App 的焦點
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 隱藏時番茄鐘也要繼續計時
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  setIgnore(true);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    send('settings', settings);
    sendDisplay(d);
    win.showInactive();
    // 除錯：ORBPET_DEMO_POMO=秒數 → 啟動後馬上開始一個很短的番茄鐘
    if (process.env.ORBPET_DEMO_POMO) send('action', `debugPomo:${process.env.ORBPET_DEMO_POMO}`);
  });

  // 除錯：ORBPET_DEBUG=1 把畫面錯誤印到終端機；ORBPET_CAPTURE=檔案.png 在 4 秒後把光球附近畫面存成圖片
  if (process.env.ORBPET_DEBUG) {
    setInterval(() => console.log('orb', JSON.stringify(orb), 'ignoring', ignoring), 3000);
    win.webContents.on('console-message', (_e, level, message, line, source) => {
      console.log(`[renderer ${level}] ${message} (${path.basename(source || '')}:${line})`);
    });
  }
  if (process.env.ORBPET_CAPTURE) {
    setTimeout(async () => {
      const bw = win.getBounds();
      const size = Number(process.env.ORBPET_CAPTURE_SIZE || 320); // 要連彈窗一起截時可以調大，例如 760
      const rect = {
        x: Math.max(0, Math.round(orb.x - bw.x - size / 2)), y: Math.max(0, Math.round(orb.y - bw.y - size / 2)),
        width: size, height: size,
      };
      const img = await win.webContents.capturePage(rect);
      fs.writeFileSync(process.env.ORBPET_CAPTURE, img.toPNG({ scaleFactor: win.webContents.getZoomFactor() * (screen.getDisplayMatching(bw).scaleFactor) }));
      console.log('captured', process.env.ORBPET_CAPTURE, JSON.stringify(orb));
    }, Number(process.env.ORBPET_CAPTURE_DELAY || 4000));
  }
}

function setIgnore(ignore) {
  if (ignore === ignoring || !win) return;
  ignoring = ignore;
  win.setIgnoreMouseEvents(ignore, { forward: true });
}

function sendDisplay(d) {
  send('display', { bounds: win.getBounds(), workArea: d.workArea });
}

// 光球跑到另一個螢幕時，把視窗搬過去
let lastFollow = { x: -1e9, y: -1e9 };
function followDisplay() {
  if (Math.hypot(orb.x - lastFollow.x, orb.y - lastFollow.y) < 20) return;
  lastFollow = { x: orb.x, y: orb.y };
  const d = screen.getDisplayNearestPoint({ x: Math.round(orb.x), y: Math.round(orb.y) });
  if (d.id !== displayId) {
    displayId = d.id;
    win.setBounds(d.bounds);
    sendDisplay(d);
  }
}

// ---------- 游標：推給 renderer，並決定滑鼠是否穿透 ----------
let lastCursor = { x: NaN, y: NaN };
function cursorLoop() {
  if (win && !hidden) {
    const p = screen.getCursorScreenPoint();
    if (p.x !== lastCursor.x || p.y !== lastCursor.y) { send('cursor', p); lastCursor = p; }
    const dist = Math.hypot(p.x - orb.x, p.y - orb.y);
    // 彈窗（終端機通知）也要能點
    const onPopup = (orb.rects || []).some((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    setIgnore(!(dist <= orb.r || orb.dragging || onPopup));
    // 滑鼠靠近光球時每 16ms 檢查，遠離時放慢，省電
    setTimeout(cursorLoop, dist < 500 || orb.dragging ? 16 : 60);
  } else {
    setTimeout(cursorLoop, 250);
  }
}

// ---------- CPU 使用率 ----------
let prevCpu = null;
function cpuLoop() {
  let busy = 0, total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    busy += t.user + t.nice + t.sys + t.irq;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  if (prevCpu && total > prevCpu.total) {
    send('cpu', (busy - prevCpu.busy) / (total - prevCpu.total));
  }
  prevCpu = { busy, total };
}

// ---------- 剪貼簿：只比對雜湊，不保存內容 ----------
let clipSig = null;
function clipboardSignature() {
  const formats = clipboard.availableFormats();
  const h = crypto.createHash('sha1');
  h.update(formats.join('|'));
  h.update(clipboard.readText() || '');
  if (formats.some((f) => f.startsWith('image/'))) {
    const img = clipboard.readImage();
    const s = img.getSize();
    h.update(`${s.width}x${s.height}:${img.toBitmap().length}`);
  }
  return h.digest('hex');
}
function clipboardLoop() {
  let sig;
  try { sig = clipboardSignature(); } catch { return; }
  if (clipSig !== null && sig !== clipSig && settings.clipboardReact && !hidden) send('clipboard');
  clipSig = sig;
}

// ---------- 隱藏 / 顯示 ----------
function setHidden(h) {
  if (h === hidden || !win) return;
  hidden = h;
  if (h) {
    orb.dragging = false;
    win.hide();
  } else {
    win.showInactive();
    win.setAlwaysOnTop(true, 'floating');
  }
  send('hidden', hidden);
  updateTray();
}

// ---------- 選單（右鍵與選單列/系統匣共用） ----------
function fmt(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function buildMenu() {
  const act = (type) => () => send('action', type);
  const tpl = [
    { label: hidden ? 'Show orb' : 'Hide orb', click: () => setHidden(!hidden) },
    { type: 'separator' },
  ];
  if (petState.pomo) {
    tpl.push({ label: `${petState.pomo.isBreak ? 'Break' : 'Focus'} · ${fmt(petState.pomo.remain)} left`, enabled: false });
    tpl.push({ label: 'Stop Pomodoro', click: act('stopPomodoro') });
  } else {
    tpl.push({ label: 'Start focus (25 min)', click: act('startFocus') });
    tpl.push({ label: 'Start break (5 min)', click: act('startBreak') });
  }
  const bat = petState.battery;
  const batText = bat ? ` · Battery ${Math.round(bat.level * 100)}%${bat.charging ? ' (charging)' : ''}` : '';
  tpl.push(
    { type: 'separator' },
    { label: `CPU ${Math.round(petState.cpu * 100)}%${batText}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Color',
      submenu: [
        { label: 'Orange orb', type: 'radio', checked: settings.theme === 'orange', click: () => setSetting('theme', 'orange') },
        { label: 'Blue ring', type: 'radio', checked: settings.theme === 'blue', click: () => setSetting('theme', 'blue') },
      ],
    },
    { label: 'Clipboard reaction', type: 'checkbox', checked: settings.clipboardReact, click: () => setSetting('clipboardReact', !settings.clipboardReact) },
    { label: 'Gravity', type: 'checkbox', checked: settings.gravity, click: () => setSetting('gravity', !settings.gravity) },
    claudeMenuItem(),
    { label: 'Back to center', click: act('recenter') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  );
  return Menu.buildFromTemplate(tpl);
}

function setSetting(key, value) {
  settings[key] = value;
  saveSettings();
  if (key === 'claudeCode') claude.setEnabled(value);
  send('settings', settings);
}

// ---------- Claude Code 連線（細節在 src/claude.js） ----------
function claudeMenuItem() {
  if (!claude.supported) return { label: 'Claude Code (not available on Windows yet)', enabled: false };
  if (!claude.claudeInstalled()) return { label: 'Claude Code (not installed)', enabled: false };
  const note = settings.claudeCode && claude.getStatus() === 'error' ? ' (could not set up)' : '';
  return { label: `Connect to Claude Code${note}`, type: 'checkbox', checked: settings.claudeCode, click: () => setSetting('claudeCode', !settings.claudeCode) };
}

function startClaude() {
  claude.setListener((msg) => send('sessions', msg));
  if (settings.claudeCode) claude.setEnabled(true);
  // 之後才裝 Claude Code 的話，不用重開 OrbPet 也會接上
  setInterval(() => {
    if (settings.claudeCode && claude.getStatus() === 'absent' && claude.claudeInstalled()) claude.setEnabled(true);
  }, 60000);
}

// ---------- 選單列（macOS）/ 系統匣（Windows）圖示 ----------
function createTray() {
  if (isMac) {
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle('J.');
  } else {
    tray = new Tray(path.join(__dirname, '..', 'assets', 'tray.png'));
  }
  tray.setToolTip('OrbPet');
  const pop = () => tray.popUpContextMenu(buildMenu());
  tray.on('click', pop);
  tray.on('right-click', pop);
}

let lastTrayText = '';
function updateTray() {
  if (!tray) return;
  const text = petState.pomo ? `J. ${fmt(petState.pomo.remain)}` : 'J.';
  if (text === lastTrayText) return;
  lastTrayText = text;
  if (isMac) tray.setTitle(text);
  tray.setToolTip(petState.pomo ? `OrbPet ${fmt(petState.pomo.remain)}` : 'OrbPet');
}

// ---------- renderer 訊息 ----------
ipcMain.on('orb', (_e, o) => {
  orb = o;
  followDisplay();
});
ipcMain.on('state', (_e, s) => {
  petState = s;
  updateTray();
});
ipcMain.on('menu', () => {
  buildMenu().popup({ window: win });
});
ipcMain.on('requestShow', () => setHidden(false));
ipcMain.on('sessionsSync', () => claude.resend());
ipcMain.on('openTerminal', (_e, id) => { if (typeof id === 'string') claude.openTerminal(id); });

// ---------- 啟動 ----------
app.whenReady().then(() => {
  if (isMac && app.dock) app.dock.hide();
  loadSettings();
  createWindow();
  createTray();
  startClaude();
  cursorLoop();
  setInterval(cpuLoop, 2000);
  setInterval(clipboardLoop, 400);
  screen.on('display-metrics-changed', () => {
    if (!win) return;
    const d = screen.getDisplayNearestPoint({ x: Math.round(orb.x), y: Math.round(orb.y) });
    displayId = d.id;
    win.setBounds(d.bounds);
    sendDisplay(d);
  });
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => claude.shutdown());
// 從終端機按 Ctrl+C 或關掉視窗結束時，也要走正常的結束流程（刪掉 port 檔）
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => app.quit());
