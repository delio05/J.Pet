// 只開放 renderer 需要的訊息通道
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const IN = ['cursor', 'cpu', 'clipboard', 'settings', 'display', 'action', 'hidden', 'sessions'];
const OUT = ['orb', 'state', 'menu', 'requestShow', 'sessionsSync', 'openTerminal'];

contextBridge.exposeInMainWorld('orbpet', {
  on: (channel, cb) => {
    if (IN.includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
  send: (channel, data) => {
    if (OUT.includes(channel)) ipcRenderer.send(channel, data);
  },
});
