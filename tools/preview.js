// 用法：npm run preview -- 輸出檔.png
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const out = path.resolve(process.argv[process.argv.length - 1].endsWith('.png') ? process.argv[process.argv.length - 1] : 'preview.png');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1040, height: 540, show: false, useContentSize: true });
  await w.loadFile(path.join(__dirname, 'preview.html'));
  await new Promise((r) => setTimeout(r, 300));
  const img = await w.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('preview saved:', out);
  app.quit();
});
