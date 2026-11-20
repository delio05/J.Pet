// OrbPet 主程序：視窗、選單列/系統匣圖示、右鍵選單、游標追蹤、CPU、剪貼簿偵測、設定存檔
// 光球的繪圖、物理、互動都在 renderer（src/renderer/pet.js）
'use strict';

const { app, BrowserWindow, screen, Tray, Menu, ipcMain, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const isMac = process.platform === 'darwin';

// ---------- 設定（存在使用者資料夾的 settings.json） ----------
const DEFAULT_SETTINGS = { theme: 'orange', clipboardReact: true, gravity: true };
let settings = { ...DEFAULT_SETTINGS };
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
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
      const rect = {
        x: Math.max(0, Math.round(orb.x - bw.x - 160)), y: Math.max(0, Math.round(orb.y - bw.y - 160)),
        width: 320, height: 320,
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
    setIgnore(!(dist <= orb.r || orb.dragging));
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
    { label: hidden ? '顯示光球' : '隱藏光球', click: () => setHidden(!hidden) },
    { type: 'separator' },
  ];
  if (petState.pomo) {
    tpl.push({ label: `${petState.pomo.isBreak ? '休息' : '專注'}中・剩餘 ${fmt(petState.pomo.remain)}`, enabled: false });
    tpl.push({ label: '停止番茄鐘', click: act('stopPomodoro') });
  } else {
    tpl.push({ label: '開始專注 25 分鐘', click: act('startFocus') });
    tpl.push({ label: '開始休息 5 分鐘', click: act('startBreak') });
  }
  const bat = petState.battery;
  const batText = bat ? `・電量 ${Math.round(bat.level * 100)}%${bat.charging ? '（充電中）' : ''}` : '';
  tpl.push(
    { type: 'separator' },
    { label: `CPU ${Math.round(petState.cpu * 100)}%${batText}`, enabled: false },
    { type: 'separator' },
    {
      label: '顏色',
      submenu: [
        { label: '橙色光球', type: 'radio', checked: settings.theme === 'orange', click: () => setSetting('theme', 'orange') },
        { label: '藍色光環', type: 'radio', checked: settings.theme === 'blue', click: () => setSetting('theme', 'blue') },
      ],
    },
    { label: '剪貼簿反應', type: 'checkbox', checked: settings.clipboardReact, click: () => setSetting('clipboardReact', !settings.clipboardReact) },
    { label: '重力', type: 'checkbox', checked: settings.gravity, click: () => setSetting('gravity', !settings.gravity) },
    { label: '回到螢幕中央', click: act('recenter') },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  );
  return Menu.buildFromTemplate(tpl);
}

function setSetting(key, value) {
  settings[key] = value;
  saveSettings();
  send('settings', settings);
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

// ---------- 啟動 ----------
app.whenReady().then(() => {
  if (isMac && app.dock) app.dock.hide();
  loadSettings();
  createWindow();
  createTray();
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
