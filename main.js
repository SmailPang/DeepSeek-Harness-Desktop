const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron');
const { spawn, execFile } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { compareVersions, consumeLines, findLocalUrl, isSameOrigin, parseHttpUrl } = require('./lib/runtime-utils');

const APP_TITLE = 'DeepSeek Harness';
const BOOT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const LATEST_RELEASE_API = 'https://api.github.com/repos/SmailPang/DeepSeek-Harness-Desktop/releases/latest';
const PROJECT_URL = 'https://github.com/SmailPang/DeepSeek-Harness-Desktop';
const DSH_PACKAGE_URL = 'https://www.npmjs.com/package/@deepseek-ai/dsh';
const DSH_REGISTRY_API = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest';
const DESKTOP_SETTINGS_PATCH = fs.readFileSync(path.join(__dirname, 'renderer', 'desktop-settings.js'), 'utf8');

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
let updatingDsh = false;
let startupUpdateCheckConsumed = false;
let updatePreferencesCache = null;

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
  if (!dshProc || dshProc.killed || dshProc.exitCode !== null) {
    dshProc = null;
    return Promise.resolve();
  }
  const proc = dshProc;
  const pid = dshProc.pid;
  dshProc = null;
  const runTaskkill = (force) => new Promise((resolve) => {
    const args = ['/pid', String(pid), '/T'];
    if (force) args.push('/F');
    try { execFile('taskkill', args, () => resolve()); } catch { resolve(); }
  });
  const waitForExit = (timeoutMs) => new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve(true);
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    proc.once('exit', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
  return (async () => {
    await runTaskkill(false);
    if (await waitForExit(1200)) return;
    await runTaskkill(true);
    if (!(await waitForExit(800))) {
      try { proc.kill(); } catch {}
    }
  })();
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
      click: requestAppQuit
    }
  ]));
  tray.on('double-click', showWindow);
  tray.on('click', showWindow);
}

function getUpdatePreferencesPath() {
  return path.join(app.getPath('userData'), 'desktop-preferences.json');
}

function getUpdatePreferences() {
  if (updatePreferencesCache) return { ...updatePreferencesCache };
  const defaults = { checkOnStartup: true };
  try {
    const stored = JSON.parse(fs.readFileSync(getUpdatePreferencesPath(), 'utf8'));
    updatePreferencesCache = {
      checkOnStartup: typeof stored.checkOnStartup === 'boolean' ? stored.checkOnStartup : true
    };
  } catch {
    updatePreferencesCache = defaults;
  }
  return { ...updatePreferencesCache };
}

function setUpdatePreferences(values) {
  updatePreferencesCache = { ...getUpdatePreferences(), ...values };
  const target = getUpdatePreferencesPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(updatePreferencesCache, null, 2)}\n`, 'utf8');
  return { ...updatePreferencesCache };
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `DeepSeek-Harness-Desktop/${app.getVersion()}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) req.destroy(new Error('更新响应过大'));
      });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GitHub 返回 HTTP ${res.statusCode}`));
        try {
          const release = JSON.parse(body);
          const page = new URL(release.html_url);
          if (page.protocol !== 'https:' || page.hostname !== 'github.com') throw new Error('无效的更新地址');
          resolve({
            version: String(release.tag_name || '').replace(/^v/i, ''),
            notes: String(release.body || '').slice(0, 3000),
            url: page.href
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error('检查更新超时')));
    req.on('error', reject);
  });
}

function getInstalledDshVersion() {
  return new Promise((resolve, reject) => {
    execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'dsh --version'], {
      windowsHide: true,
      env: buildEnv(),
      timeout: 8000
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim()));
      const match = String(stdout).match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
      if (!match) return reject(new Error('无法识别已安装的 DSH 版本'));
      resolve(match[0]);
    });
  });
}

function fetchLatestDshVersion() {
  return new Promise((resolve, reject) => {
    const req = https.get(DSH_REGISTRY_API, {
      headers: {
        Accept: 'application/json',
        'User-Agent': `DeepSeek-Harness-Desktop/${app.getVersion()}`
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) req.destroy(new Error('DSH 更新响应过大'));
      });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`npm 返回 HTTP ${res.statusCode}`));
        try {
          const data = JSON.parse(body);
          if (!data.version) throw new Error('npm 未返回 DSH 版本号');
          resolve(String(data.version));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error('检查 DSH 更新超时')));
    req.on('error', reject);
  });
}

function installLatestDsh() {
  return new Promise((resolve, reject) => {
    execFile(process.env.ComSpec || 'cmd.exe', [
      '/d', '/s', '/c', 'npm install --global @deepseek-ai/dsh@latest'
    ], {
      windowsHide: true,
      env: buildEnv(),
      timeout: 5 * 60_000,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message).trim().slice(-8000);
        return reject(new Error(detail || 'npm 更新 DSH 失败'));
      }
      resolve(String(stdout || stderr).trim().slice(-8000));
    });
  });
}

async function getDesktopUpdateStatus() {
  const release = await fetchLatestRelease();
  const current = app.getVersion();
  if (!release.version) throw new Error('GitHub Release 缺少版本号');
  return { current, latest: release.version, updateAvailable: compareVersions(release.version, current) > 0, release };
}

async function getDshUpdateStatus() {
  const [current, latest] = await Promise.all([getInstalledDshVersion(), fetchLatestDshVersion()]);
  return { current, latest, updateAvailable: compareVersions(latest, current) > 0 };
}

function serializeDesktopStatus(status) {
  return {
    current: status.current,
    latest: status.latest,
    updateAvailable: status.updateAvailable
  };
}

function serializeDshStatus(status) {
  return {
    current: status.current,
    latest: status.latest,
    updateAvailable: status.updateAvailable
  };
}

async function getEmbeddedUpdateResult(scope) {
  const getDesktop = async () => {
    try {
      return { ok: true, ...serializeDesktopStatus(await getDesktopUpdateStatus()) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };
  const getDsh = async () => {
    try {
      return { ok: true, ...serializeDshStatus(await getDshUpdateStatus()) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };
  if (scope === 'desktop') return { desktop: await getDesktop() };
  if (scope === 'dsh') return { dsh: await getDsh() };
  const [desktop, dsh] = await Promise.all([getDesktop(), getDsh()]);
  return { desktop, dsh };
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function requestAppQuit() {
  if (isQuiting) return;
  isQuiting = true;
  stopped = true;
  clearBootTimer();
  if (win && !win.isDestroyed()) win.hide();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  await killDshTree();
  app.quit();
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
    if (isQuiting) return;
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
    win.webContents.executeJavaScript(DESKTOP_SETTINGS_PATCH, true).catch(() => {});
  });

  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://127.0.0.1/*', 'http://localhost/*'] },
    (details, callback) => {
      let isRestartRequest = false;
      try {
        const target = new URL(details.url);
        isRestartRequest = details.method === 'POST'
          && target.pathname === '/dsh-market/restart'
          && isSameDshOrigin(details.url);
      } catch {}
      callback({ cancel: isRestartRequest });
      if (isRestartRequest) setImmediate(() => restartDsh().catch(() => {}));
    }
  );

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

async function failBoot(title, detail) {
  if (stopped) return;
  stopped = true;
  bootAttempt += 1;
  clearBootTimer();
  await killDshTree();
  dshUrl = null;
  if (!win || win.isDestroyed()) return;
  await win.loadFile(path.join(__dirname, 'loading.html'), {
    query: { reason: 'error', title, detail }
  }).catch(() => {});
  showWindow();
}

async function retryBoot() {
  if (!stopped || isQuiting) return;
  await killDshTree();
  stopped = false;
  restarting = false;
  dshUrl = null;
  if (win && !win.isDestroyed()) {
    await win.loadFile(path.join(__dirname, 'loading.html')).catch(() => {});
  }
  startDsh();
}

function startDsh() {
  const attempt = ++bootAttempt;
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
    void failBoot(
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

    clearBootTimer();
    if (!dshUrl) {
      void failBoot(
        'dsh 启动失败',
        `dsh 进程意外退出（退出码 ${code}）。请确认已正确安装 dsh，可在终端执行 dsh web 验证。\n\n输出：\n${output || '（无）'}`
      );
      return;
    }
    void failBoot('dsh 已停止', `dsh 进程意外退出（退出码 ${code}）。\n\n输出：\n${output || '（无）'}`);
  });

  bootTimer = setTimeout(() => {
    void failBoot(
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

    ipcMain.handle('dsh:get-desktop-info', async (event) => {
      if (!win || event.sender !== win.webContents || !isSameDshOrigin(event.senderFrame.url)) {
        throw new Error('不允许的请求');
      }
      let dshVersion = null;
      try { dshVersion = await getInstalledDshVersion(); } catch {}
      return {
        appVersion: app.getVersion(),
        dshVersion,
        electronVersion: process.versions.electron,
        license: 'MIT'
      };
    });

    ipcMain.handle('dsh:check-updates', async (event, scope) => {
      if (!win || event.sender !== win.webContents || !isSameDshOrigin(event.senderFrame.url)) {
        throw new Error('不允许的请求');
      }
      if (!['all', 'desktop', 'dsh'].includes(scope)) throw new Error('无效的更新检查范围');
      return getEmbeddedUpdateResult(scope);
    });

    ipcMain.handle('dsh:check-startup-updates', async (event) => {
      if (!win || event.sender !== win.webContents || !isSameDshOrigin(event.senderFrame.url)) {
        throw new Error('不允许的请求');
      }
      if (startupUpdateCheckConsumed) return null;
      startupUpdateCheckConsumed = true;
      if (!getUpdatePreferences().checkOnStartup) return null;
      return getEmbeddedUpdateResult('all');
    });

    ipcMain.handle('dsh:get-update-preferences', async (event) => {
      if (!win || event.sender !== win.webContents || !isSameDshOrigin(event.senderFrame.url)) {
        throw new Error('不允许的请求');
      }
      return getUpdatePreferences();
    });

    ipcMain.handle('dsh:set-update-preferences', async (event, values) => {
      if (!win || event.sender !== win.webContents || !isSameDshOrigin(event.senderFrame.url)) {
        throw new Error('不允许的请求');
      }
      if (!values || typeof values.checkOnStartup !== 'boolean') throw new Error('无效的更新设置');
      return setUpdatePreferences({ checkOnStartup: values.checkOnStartup });
    });

    ipcMain.handle('dsh:update-dsh', async (event) => {
      if (!win || event.sender !== win.webContents || !isSameDshOrigin(event.senderFrame.url)) {
        throw new Error('不允许的请求');
      }
      if (updatingDsh) return { ok: false, error: 'DSH 更新正在进行中' };

      let status;
      try {
        status = await getDshUpdateStatus();
      } catch (error) {
        return { ok: false, error: error.message };
      }
      if (!status.updateAvailable) {
        return { ok: true, alreadyLatest: true, version: status.current };
      }

      const confirmation = await dialog.showMessageBox(win, {
        type: 'question',
        title: '更新 DSH',
        message: `将 DSH 更新到 ${status.latest}`,
        detail: `当前版本：${status.current}\n最新版本：${status.latest}\n\n桌面应用将通过 npm 更新全局安装的 @deepseek-ai/dsh，完成后自动重启 DeepSeek Harness。`,
        buttons: ['更新 DSH', '取消'],
        defaultId: 0,
        cancelId: 1
      });
      if (confirmation.response !== 0) return { ok: false, cancelled: true };

      updatingDsh = true;
      try {
        await installLatestDsh();
        const installedVersion = await getInstalledDshVersion().catch(() => status.latest);
        return { ok: true, version: installedVersion, restartRequired: true };
      } catch (error) {
        return { ok: false, error: error.message };
      } finally {
        updatingDsh = false;
      }
    });

    ipcMain.on('dsh:open-update-page', (event, target) => {
      if (!win || event.sender !== win.webContents || !isSameDshOrigin(event.senderFrame.url)) return;
      if (target === 'desktop') shell.openExternal(`${PROJECT_URL}/releases/latest`).catch(() => {});
      if (target === 'project') shell.openExternal(PROJECT_URL).catch(() => {});
      if (target === 'dsh') shell.openExternal(DSH_PACKAGE_URL).catch(() => {});
    });

    ipcMain.on('dsh:retry-boot', (event) => {
      if (!win || event.sender !== win.webContents || !event.senderFrame.url.startsWith('file:')) return;
      retryBoot().catch(() => {});
    });

    ipcMain.on('dsh:quit', (event) => {
      if (!win || event.sender !== win.webContents || !event.senderFrame.url.startsWith('file:')) return;
      requestAppQuit().catch(() => {});
    });


    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    isQuiting = true;
    stopped = true;
    clearBootTimer();
    void killDshTree();
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  app.on('window-all-closed', (event) => {
    event.preventDefault();
  });
}




