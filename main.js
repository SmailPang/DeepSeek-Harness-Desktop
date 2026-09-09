const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron');
const { spawn, execFile } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { consumeLines, findLocalUrl, isSameOrigin, parseHttpUrl } = require('./lib/runtime-utils');

const APP_TITLE = 'DeepSeek Harness';
const BOOT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

let win = null;
let tray = null;
let isQuiting = false;
let dshProc = null;
let dshUrl = null;
let fixedPort = 0;
let bootTimer = null;
let bootAttempt = 0;
let stopped = false;
let restarting = false;
let trayHintShown = false;

const RESTART_FETCH_PATCH = `(() => {
  if (window.__dshFetchPatched) return;
  window.__dshFetchPatched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const target = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || (input && input.method) || 'GET';
      if (target.includes('/dsh-market/restart') && method.toUpperCase() === 'POST') {
        if (window.__dshShell && window.__dshShell.requestRestart) window.__dshShell.requestRestart();
        return Promise.resolve(new Response(JSON.stringify({ ok: true, boot: 'shell', pid: 0, helperPid: 0 }), {
          status: 202,
          headers: { 'content-type': 'application/json' }
        }));
      }
    } catch (_) {}
    return originalFetch(input, init);
  };
})();`;

function buildEnv() {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'Path';
  const npmGlobal = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null;
  if (npmGlobal && fs.existsSync(npmGlobal) && !String(env[pathKey] || '').includes(npmGlobal)) {
    env[pathKey] = `${npmGlobal};${env[pathKey] || ''}`;
  }
  return env;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function killDshTree() {
  if (!dshProc || dshProc.killed) {
    dshProc = null;
    return Promise.resolve();
  }
  const proc = dshProc;
  const pid = dshProc.pid;
  dshProc = null;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve();
    }, 5000);
    try {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {
        clearTimeout(timeout);
        resolve();
      });
    } catch {
      clearTimeout(timeout);
      try { proc.kill(); } catch {}
      resolve();
    }
  });
}

function isSameDshOrigin(value) {
  return Boolean(dshUrl && isSameOrigin(value, dshUrl));
}

function openExternalUrl(value) {
  const parsed = parseHttpUrl(value);
  if (parsed) shell.openExternal(parsed.href).catch(() => {});
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.ico'));
  if (icon.isEmpty()) return;
  tray = new Tray(icon);
  tray.setToolTip(APP_TITLE);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWindow },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuiting = true;
        app.quit();
      }
    }
  ]));
  tray.on('double-click', showWindow);
  tray.on('click', showWindow);
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, 'loading.html'));
  win.once('ready-to-show', () => win.show());

  win.on('close', (event) => {
    if (isQuiting || stopped) return;
    event.preventDefault();
    win.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      if (tray) tray.displayBalloon({
        iconType: 'info',
        title: APP_TITLE,
        content: '应用仍在后台运行，点击托盘图标可重新打开窗口。'
      });
    }
  });

  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle(APP_TITLE);
  });

  win.webContents.on('dom-ready', () => {
    if (!dshUrl) return;
    win.webContents.executeJavaScript(RESTART_FETCH_PATCH, true).catch(() => {});
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameDshOrigin(url)) return { action: 'allow' };
    openExternalUrl(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isSameDshOrigin(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  });

  win.on('closed', () => {
    win = null;
  });
}

function waitForServer(url, attempt, onReady) {
  const retry = () => {
    if (stopped || attempt !== bootAttempt) return;
    const req = http.get(url, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 500) {
        onReady();
      } else {
        setTimeout(retry, POLL_INTERVAL_MS);
      }
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

const WEB_ALL_BUNDLE = '@linxin666/dsh-web-all';
const WEB_ALL_EMBEDDED_BUNDLES = new Set([
  'dsh-better-sidebar',
  '@linxin666/dsh-remote-web-ui'
]);

function sanitizeProfileBundles() {
  try {
    const manifestPath = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'package.json');
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const bundles = manifest?.dsh?.profile?.bundles;
    if (!Array.isArray(bundles) || !bundles.includes(WEB_ALL_BUNDLE)) return;

    const deduped = bundles.filter((name) => !WEB_ALL_EMBEDDED_BUNDLES.has(name));
    if (deduped.length === bundles.length) return;

    manifest.dsh.profile.bundles = deduped;
    const backupPath = `${manifestPath}.dsh-desktop-backup`;
    const tempPath = `${manifestPath}.${process.pid}.tmp`;
    if (!fs.existsSync(backupPath)) fs.copyFileSync(manifestPath, backupPath);
    fs.writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, manifestPath);
    console.log(`[dsh-desktop] Removed duplicate web bundles; backup: ${backupPath}`);
  } catch {
    // A broken/locked profile manifest must not prevent the normal dsh error path.
  }
}

function startDsh() {
  const attempt = ++bootAttempt;
  sanitizeProfileBundles();
  const env = buildEnv();
  const args = ['/c', 'dsh', 'web', '--no-open', '--port', String(fixedPort || 0)];
  const proc = spawn(process.env.ComSpec || 'cmd.exe', args, {
    windowsHide: true,
    env
  });
  dshProc = proc;

  let output = '';
  let pendingOutput = '';
  const inspectLine = (line) => {
    if (dshUrl || attempt !== bootAttempt) return;
    const parsed = findLocalUrl(line, fixedPort);
    if (parsed) {
      dshUrl = parsed.href;
      if (!fixedPort) fixedPort = Number(parsed.port) || 0;
      waitForServer(dshUrl, attempt, () => {
        if (attempt !== bootAttempt || !win || win.isDestroyed()) return;
        clearBootTimer();
        win.webContents.once('did-finish-load', () => win.setTitle(APP_TITLE));
        win.loadURL(dshUrl).catch((err) => failBoot('无法加载 dsh', err.message));
      });
    }
  };
  const capture = (chunk) => {
    const text = chunk.toString();
    output = (output + text).slice(-8000);
    const { lines, remainder } = consumeLines(pendingOutput, text);
    pendingOutput = remainder;
    for (const line of lines) inspectLine(line);
  };
  proc.stdout.on('data', capture);
  proc.stderr.on('data', capture);

  proc.on('error', (err) => {
    if (restarting) return;
    failBoot(
      '无法启动 dsh',
      `请确认已正确安装 dsh（npm install -g @deepseek-ai/dsh），且 dsh 命令在 PATH 中可用。\n\n错误信息：${err.message}`
    );
  });

  proc.on('exit', (code) => {
    if (proc !== dshProc) return;
    if (stopped || isQuiting) return;

    if (restarting) {
      return;
    }

    stopped = true;
    isQuiting = true;
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

async function restartDsh() {
  if (restarting || stopped) return;
  restarting = true;
  clearBootTimer();
  dshUrl = null;

  if (win && !win.isDestroyed()) {
    win.setTitle(APP_TITLE);
    win.loadFile(path.join(__dirname, 'loading.html'), { query: { reason: 'restart' } }).catch(() => {});
    if (!win.isVisible()) win.show();
  }

  await killDshTree();

  if (!fixedPort) {
    try { fixedPort = await findFreePort(); } catch { fixedPort = 0; }
  }

  setTimeout(() => {
    if (!restarting || stopped) return;
    restarting = false;
    startDsh();
  }, 800);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });

  app.whenReady().then(async () => {
    createTray();
    createWindow();
    try { fixedPort = await findFreePort(); } catch { fixedPort = 0; }
    startDsh();

    ipcMain.on('dsh:request-restart', (event) => {
      if (!win || event.sender !== win.webContents || !isSameDshOrigin(event.senderFrame.url)) return;
      restartDsh().catch(() => {});
    });


    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    isQuiting = true;
    stopped = true;
    clearBootTimer();
    killDshTree();
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  app.on('window-all-closed', (event) => {
    event.preventDefault();
  });
}




