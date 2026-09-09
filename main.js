const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const APP_TITLE = 'DeepSeek Harness';
const BOOT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

let win = null;
let dshProc = null;
let dshUrl = null;
let bootTimer = null;
let stopped = false;

function buildEnv() {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'Path';
  const npmGlobal = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null;
  if (npmGlobal && fs.existsSync(npmGlobal) && !String(env[pathKey] || '').includes(npmGlobal)) {
    env[pathKey] = `${npmGlobal};${env[pathKey] || ''}`;
  }
  return env;
}

function killDshTree() {
  if (!dshProc || dshProc.killed) return;
  const pid = dshProc.pid;
  try {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
  } catch {
    try { dshProc.kill(); } catch {}
  }
  dshProc = null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: APP_TITLE,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#f4f7fc',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, 'loading.html'));
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle(APP_TITLE);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (dshUrl && url.startsWith(new URL(dshUrl).origin)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (dshUrl && url.startsWith(new URL(dshUrl).origin)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  win.on('closed', () => {
    win = null;
  });
}

function waitForServer(url, onReady) {
  const retry = () => {
    if (stopped) return;
    const req = http.get(url, (res) => {
      res.resume();
      res.destroy();
      onReady();
    });
    req.setTimeout(2000, () => req.destroy());
    req.on('error', () => setTimeout(retry, POLL_INTERVAL_MS));
  };
  retry();
}

function clearBootTimer() {
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
}

function failBoot(title, detail) {
  if (stopped) return;
  stopped = true;
  clearBootTimer();
  killDshTree();
  dialog.showErrorBox(title, detail);
  app.exit(1);
}

function startDsh() {
  const env = buildEnv();
  const args = ['/c', 'dsh', 'web', '--no-open', '--port', '0'];
  dshProc = spawn(process.env.ComSpec || 'cmd.exe', args, {
    windowsHide: true,
    env
  });

  let output = '';
  const capture = (chunk) => {
    const text = chunk.toString();
    output = (output + text).slice(-8000);
    if (!dshUrl) {
      const match = text.match(/https?:\/\/[^\s"'<>]+/);
      if (match) {
        dshUrl = match[0].trim();
        clearBootTimer();
        waitForServer(dshUrl, () => {
          if (!win || win.isDestroyed()) return;
          win.webContents.once('did-finish-load', () => win.setTitle(APP_TITLE));
          win.loadURL(dshUrl);
        });
      }
    }
  };
  dshProc.stdout.on('data', capture);
  dshProc.stderr.on('data', capture);

  dshProc.on('error', (err) => {
    failBoot(
      '无法启动 dsh',
      `请确认已正确安装 dsh（npm install -g @deepseek-ai/dsh），且 dsh 命令在 PATH 中可用。\n\n错误信息：${err.message}`
    );
  });

  dshProc.on('exit', (code) => {
    if (stopped) return;
    stopped = true;
    clearBootTimer();
    if (!dshUrl) {
      dialog.showErrorBox(
        'dsh 启动失败',
        `dsh 进程意外退出（退出码 ${code}）。请确认已正确安装 dsh，可在终端执行 dsh web 验证。\n\n输出：\n${output || '（无）'}`
      );
      app.exit(1);
      return;
    }
    app.quit();
  });

  bootTimer = setTimeout(() => {
    failBoot(
      'dsh 启动超时',
      `等待 ${APP_TITLE} Web UI 就绪超时（${BOOT_TIMEOUT_MS / 1000} 秒）。\n\n输出：\n${output || '（无）'}`
    );
  }, BOOT_TIMEOUT_MS);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    startDsh();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    stopped = true;
    clearBootTimer();
    killDshTree();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

