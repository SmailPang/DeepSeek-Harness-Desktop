(() => {
  if (window.__dshDesktopSettingsInstalled) return;
  window.__dshDesktopSettingsInstalled = true;

  const STYLE_ID = 'dsh-desktop-settings-style';
  const NAV_ATTRIBUTE = 'data-dsh-desktop-settings-nav';
  const PANEL_ATTRIBUTE = 'data-dsh-desktop-settings-panel';
  const shell = window.__dshShell;
  let info = null;
  let updateResult = null;
  let checking = false;
  let updatingDsh = false;
  let updateNotice = '';
  let updateNoticeType = '';
  let preferences = { checkOnStartup: true };
  let savingPreferences = false;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${PANEL_ATTRIBUTE}] { box-sizing: border-box; height: 100%; overflow: auto; padding: 28px 32px 40px; color: inherit; }
      .dsh-desktop-heading { margin: 0 0 6px; font-size: 20px; line-height: 1.35; font-weight: 650; }
      .dsh-desktop-lead { margin: 0 0 28px; color: color-mix(in srgb, currentColor 58%, transparent); font-size: 13px; line-height: 1.6; }
      .dsh-desktop-section { margin-top: 26px; }
      .dsh-desktop-section-title { margin: 0 0 10px; font-size: 13px; font-weight: 650; }
      .dsh-desktop-card { overflow: hidden; border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 16px; background: color-mix(in srgb, currentColor 3%, transparent); }
      .dsh-desktop-row { display: flex; align-items: center; min-height: 54px; padding: 0 16px; gap: 16px; border-bottom: 1px solid color-mix(in srgb, currentColor 9%, transparent); }
      .dsh-desktop-row:last-child { border-bottom: 0; }
      .dsh-desktop-row-main { min-width: 0; flex: 1; }
      .dsh-desktop-row-title { font-size: 13px; font-weight: 560; }
      .dsh-desktop-row-detail { margin-top: 3px; color: color-mix(in srgb, currentColor 55%, transparent); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
      .dsh-desktop-value { flex: 0 0 auto; color: color-mix(in srgb, currentColor 65%, transparent); font: 12px/1.4 var(--ds-font-family-code, monospace); }
      .dsh-desktop-badge { flex: 0 0 auto; padding: 3px 8px; border-radius: 999px; background: color-mix(in srgb, #22a06b 13%, transparent); color: #168456; font-size: 11px; font-weight: 600; }
      .dsh-desktop-badge.update { background: color-mix(in srgb, #4d7cff 14%, transparent); color: #3769e8; }
      .dsh-desktop-badge.error { background: color-mix(in srgb, #d14343 12%, transparent); color: #c43d3d; }
      .dsh-desktop-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      .dsh-desktop-button { appearance: none; min-height: 34px; padding: 0 14px; border: 1px solid color-mix(in srgb, currentColor 15%, transparent); border-radius: 12px; background: color-mix(in srgb, currentColor 4%, transparent); color: inherit; font: inherit; font-size: 12px; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
      .dsh-desktop-button:hover { background: color-mix(in srgb, currentColor 8%, transparent); border-color: color-mix(in srgb, currentColor 22%, transparent); }
      .dsh-desktop-button:disabled { cursor: default; opacity: .55; }
      .dsh-desktop-button.primary { border-color: #4d7cff; background: #4d7cff; color: #fff; }
      .dsh-desktop-button.primary:hover { background: #3d6fec; }
      .dsh-desktop-button.danger { color: #c43d3d; }
      .dsh-desktop-note { margin-top: 12px; color: color-mix(in srgb, currentColor 55%, transparent); font-size: 12px; line-height: 1.55; }
      .dsh-desktop-note.success { color: #168456; }
      .dsh-desktop-note.error { color: #c43d3d; }
      .dsh-desktop-link { padding: 0; border: 0; background: none; color: #3769e8; font: inherit; font-size: 12px; cursor: pointer; }
      .dsh-desktop-switch { position: relative; flex: 0 0 auto; width: 38px; height: 22px; }
      .dsh-desktop-switch input { position: absolute; width: 1px; height: 1px; opacity: 0; }
      .dsh-desktop-switch-track { position: absolute; inset: 0; border-radius: 999px; background: color-mix(in srgb, currentColor 18%, transparent); cursor: pointer; transition: background .18s ease; }
      .dsh-desktop-switch-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); transition: transform .18s ease; }
      .dsh-desktop-switch input:checked + .dsh-desktop-switch-track { background: #4d7cff; }
      .dsh-desktop-switch input:checked + .dsh-desktop-switch-track::after { transform: translateX(16px); }
      .dsh-desktop-switch input:focus-visible + .dsh-desktop-switch-track { outline: 2px solid #4d7cff; outline-offset: 2px; }
      .dsh-update-overlay { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 24px; background: rgba(24, 34, 52, .16); backdrop-filter: blur(9px) saturate(.9) brightness(.97); -webkit-backdrop-filter: blur(9px) saturate(.9) brightness(.97); animation: dsh-update-fade .18s ease both; }
      .dsh-update-dialog { box-sizing: border-box; width: min(430px, 100%); overflow: hidden; border: 1px solid color-mix(in srgb, currentColor 10%, transparent); border-radius: 24px; background: Canvas; color: CanvasText; box-shadow: 0 18px 56px rgba(15, 23, 42, .2), 0 2px 8px rgba(15, 23, 42, .08); animation: dsh-update-rise .22s ease both; }
      .dsh-update-dialog:focus { outline: none; }
      .dsh-update-header { padding: 24px 24px 17px; }
      .dsh-update-kicker { margin-bottom: 7px; color: #4d7cff; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .dsh-update-title { margin: 0; font-size: 20px; line-height: 1.35; font-weight: 650; letter-spacing: -.01em; }
      .dsh-update-subtitle { margin: 7px 0 0; color: color-mix(in srgb, currentColor 56%, transparent); font-size: 13px; line-height: 1.55; }
      .dsh-update-list { overflow: hidden; margin: 0 24px; padding: 0 14px; border-radius: 16px; background: color-mix(in srgb, currentColor 3.5%, transparent); }
      .dsh-update-item { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 59px; padding: 0 2px; border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent); }
      .dsh-update-item:last-child { border-bottom: 0; }
      .dsh-update-name { font-size: 13px; font-weight: 600; line-height: 1.4; }
      .dsh-update-version { margin-top: 4px; color: color-mix(in srgb, currentColor 52%, transparent); font: 11px/1.4 var(--ds-font-family-code, monospace); }
      .dsh-update-available { flex: 0 0 auto; color: #4d7cff; font-size: 11px; font-weight: 650; }
      .dsh-update-dialog-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding: 18px 24px 20px; }
      .dsh-update-dialog-actions .dsh-desktop-button { border-radius: 12px; }
      .dsh-update-dialog-actions .dsh-desktop-button.primary { min-width: 108px; }
      .dsh-update-dialog-actions .quiet { order: -1; margin-right: auto; padding-inline: 4px; border-color: transparent; background: transparent; color: color-mix(in srgb, currentColor 58%, transparent); }
      .dsh-update-dialog-actions .quiet:hover { border-color: transparent; background: transparent; color: inherit; }
      .dsh-update-error { margin: 14px 24px 0; color: #c43d3d; font-size: 12px; line-height: 1.5; }
      @keyframes dsh-update-fade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes dsh-update-rise { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
      @media (max-width: 720px) { [${PANEL_ATTRIBUTE}] { padding: 22px 20px 32px; } .dsh-desktop-row { align-items: flex-start; padding-block: 13px; } }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[character]);
  }

  function versionRow(label, current, status, target) {
    let badge = '';
    let detail = current ? `当前版本 ${escapeHtml(current)}` : '暂时无法检测当前版本';
    if (status) {
      if (!status.ok) {
        badge = '<span class="dsh-desktop-badge error">检查失败</span>';
        detail = escapeHtml(status.error || '检查失败');
      } else if (status.updateAvailable) {
        badge = '<span class="dsh-desktop-badge update">有新版本</span>';
        detail = `当前 ${escapeHtml(status.current)} · 最新 ${escapeHtml(status.latest)}`;
      } else {
        badge = '<span class="dsh-desktop-badge">已是最新</span>';
        detail = `当前 ${escapeHtml(status.current)} · 最新 ${escapeHtml(status.latest)}`;
      }
    }
    const links = [];
    if (status?.ok && status.updateAvailable) {
      links.push(`<button class="dsh-desktop-link" data-open-update="${target}">查看更新</button>`);
      if (target === 'dsh') {
        links.push(`<button class="dsh-desktop-link" data-update-dsh ${updatingDsh ? 'disabled' : ''}>${updatingDsh ? '正在更新…' : '更新 DSH'}</button>`);
      }
    }
    return `<div class="dsh-desktop-row"><div class="dsh-desktop-row-main"><div class="dsh-desktop-row-title">${label}</div><div class="dsh-desktop-row-detail">${detail}${links.length ? ` · ${links.join(' · ')}` : ''}</div></div>${badge || `<span class="dsh-desktop-value">${escapeHtml(current || '—')}</span>`}</div>`;
  }

  async function requestDshUpdate() {
    const result = await shell.updateDsh();
    if (result.cancelled) return result;
    if (!result.ok) throw new Error(result.error || '更新失败');
    const version = result.version || updateResult?.dsh?.latest || info?.dshVersion;
    info = { ...info, dshVersion: version };
    updateResult = {
      ...updateResult,
      dsh: { ok: true, current: version, latest: version, updateAvailable: false }
    };
    return result;
  }

  function showStartupUpdateModal(result) {
    if (document.querySelector('[data-dsh-update-overlay]')) return;
    const updates = [];
    if (result.desktop?.ok && result.desktop.updateAvailable) updates.push({ key: 'desktop', label: 'DeepSeek Harness Desktop', ...result.desktop });
    if (result.dsh?.ok && result.dsh.updateAvailable) updates.push({ key: 'dsh', label: 'DSH', ...result.dsh });
    if (!updates.length) return;
    const hasDesktopUpdate = updates.some((item) => item.key === 'desktop');
    const hasDshUpdate = updates.some((item) => item.key === 'dsh');

    const overlay = document.createElement('div');
    overlay.className = 'dsh-update-overlay';
    overlay.setAttribute('data-dsh-update-overlay', '');
    overlay.innerHTML = `
      <div class="dsh-update-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dsh-update-title" tabindex="-1">
        <div class="dsh-update-header">
          <div class="dsh-update-kicker">DeepSeek Harness</div>
          <h2 class="dsh-update-title" id="dsh-update-title">有新版本可用</h2>
          <p class="dsh-update-subtitle">${updates.length > 1 ? `检测到 ${updates.length} 项更新，现在处理或稍后前往设置。` : '检测到 1 项更新，现在处理或稍后前往设置。'}</p>
        </div>
        <div class="dsh-update-list">${updates.map((item) => `<div class="dsh-update-item"><div><div class="dsh-update-name">${item.label}</div><div class="dsh-update-version">${escapeHtml(item.current)} → ${escapeHtml(item.latest)}</div></div><span class="dsh-update-available">可更新</span></div>`).join('')}</div>
        <p class="dsh-update-error" data-update-modal-message hidden></p>
        <div class="dsh-update-dialog-actions">
          ${hasDesktopUpdate && hasDshUpdate ? '<button class="dsh-desktop-button primary" data-modal-update-all>全部更新</button>' : ''}
          ${hasDesktopUpdate && !hasDshUpdate ? '<button class="dsh-desktop-button primary" data-modal-desktop-update>下载桌面更新</button>' : ''}
          ${hasDshUpdate && !hasDesktopUpdate ? '<button class="dsh-desktop-button primary" data-modal-dsh-update>更新 DSH</button>' : ''}
          <button class="dsh-desktop-button quiet" data-modal-dismiss>稍后提醒</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const dismiss = () => overlay.remove();
    overlay.querySelector('[data-modal-dismiss]')?.addEventListener('click', dismiss);
    overlay.querySelector('[data-modal-desktop-update]')?.addEventListener('click', () => shell?.openUpdatePage?.('desktop'));
    const handleDshUpdate = async (event, includeDesktopUpdate = false) => {
      const button = event.currentTarget;
      const message = overlay.querySelector('[data-update-modal-message]');
      button.disabled = true;
      button.textContent = includeDesktopUpdate ? '正在全部更新…' : '正在更新…';
      if (message) message.hidden = true;
      try {
        const update = await requestDshUpdate();
        if (update.cancelled) {
          button.disabled = false;
          button.textContent = includeDesktopUpdate ? '全部更新' : '更新 DSH';
          return;
        }
        if (includeDesktopUpdate) await shell?.openUpdatePage?.('desktop');
        button.textContent = includeDesktopUpdate ? '已处理' : '更新完成';
        if (message) {
          message.className = 'dsh-desktop-note success';
          message.textContent = includeDesktopUpdate
            ? 'DSH 更新完成，已打开桌面应用下载页面，正在重启 DeepSeek Harness…'
            : update.alreadyLatest ? '当前 DSH 已是最新版本。' : 'DSH 更新完成，正在重启 DeepSeek Harness…';
          message.hidden = false;
        }
        if (update.restartRequired) setTimeout(() => shell.requestRestart?.(), 800);
      } catch (error) {
        button.disabled = false;
        button.textContent = includeDesktopUpdate ? '重试全部更新' : '重试更新';
        if (message) {
          message.className = 'dsh-update-error';
          message.textContent = `${includeDesktopUpdate ? '全部更新' : 'DSH 更新'}失败：${error.message || '未知错误'}`;
          message.hidden = false;
        }
      }
    };
    overlay.querySelector('[data-modal-dsh-update]')?.addEventListener('click', (event) => handleDshUpdate(event));
    overlay.querySelector('[data-modal-update-all]')?.addEventListener('click', (event) => handleDshUpdate(event, true));
    overlay.querySelector('[role="alertdialog"]')?.focus();
  }

  function render(panel) {
    const desktopStatus = updateResult?.desktop;
    const dshStatus = updateResult?.dsh;
    panel.innerHTML = `
      <h2 class="dsh-desktop-heading">桌面应用</h2>
      <p class="dsh-desktop-lead">管理 DeepSeek Harness Desktop 外壳及其承载的 DSH 服务。</p>

      <section class="dsh-desktop-section">
        <h3 class="dsh-desktop-section-title">版本与更新</h3>
        <div class="dsh-desktop-card">
          ${versionRow('DeepSeek Harness Desktop', info?.appVersion, desktopStatus, 'desktop')}
          ${versionRow('DSH', info?.dshVersion, dshStatus, 'dsh')}
          <div class="dsh-desktop-row"><div class="dsh-desktop-row-main"><div class="dsh-desktop-row-title">Electron</div><div class="dsh-desktop-row-detail">桌面运行环境</div></div><span class="dsh-desktop-value">${escapeHtml(info?.electronVersion || '—')}</span></div>
        </div>
        <div class="dsh-desktop-actions">
          <button class="dsh-desktop-button primary" data-check-update="all" ${checking ? 'disabled' : ''}>${checking ? '正在检查…' : '检查全部更新'}</button>
          <button class="dsh-desktop-button" data-check-update="desktop" ${checking ? 'disabled' : ''}>检查桌面应用</button>
          <button class="dsh-desktop-button" data-check-update="dsh" ${checking ? 'disabled' : ''}>检查 DSH</button>
        </div>
        ${updateNotice ? `<p class="dsh-desktop-note ${updateNoticeType}">${escapeHtml(updateNotice)}</p>` : ''}
      </section>

      <section class="dsh-desktop-section">
        <h3 class="dsh-desktop-section-title">更新偏好</h3>
        <div class="dsh-desktop-card">
          <div class="dsh-desktop-row"><div class="dsh-desktop-row-main"><div class="dsh-desktop-row-title">启动时检查更新</div><div class="dsh-desktop-row-detail">每次启动时同时检查桌面应用和 DSH，有新版本时显示提醒。</div></div><label class="dsh-desktop-switch"><input type="checkbox" data-startup-update-toggle ${preferences.checkOnStartup ? 'checked' : ''} ${savingPreferences ? 'disabled' : ''} aria-label="启动时检查更新"><span class="dsh-desktop-switch-track"></span></label></div>
        </div>
      </section>

      <section class="dsh-desktop-section">
        <h3 class="dsh-desktop-section-title">运行</h3>
        <div class="dsh-desktop-card">
          <div class="dsh-desktop-row"><div class="dsh-desktop-row-main"><div class="dsh-desktop-row-title">重启 DeepSeek Harness</div><div class="dsh-desktop-row-detail">重新启动后台 DSH 服务，完成后会自动回到主界面。</div></div><button class="dsh-desktop-button danger" data-restart-dsh>重启</button></div>
        </div>
      </section>

      <section class="dsh-desktop-section">
        <h3 class="dsh-desktop-section-title">关于</h3>
        <div class="dsh-desktop-card">
          <div class="dsh-desktop-row"><div class="dsh-desktop-row-main"><div class="dsh-desktop-row-title">DeepSeek Harness Desktop</div><div class="dsh-desktop-row-detail">用于启动并承载 DeepSeek Harness Web UI 的桌面外壳。</div></div></div>
          <div class="dsh-desktop-row"><div class="dsh-desktop-row-main"><div class="dsh-desktop-row-title">许可证</div></div><span class="dsh-desktop-value">${escapeHtml(info?.license || 'MIT')}</span></div>
          <div class="dsh-desktop-row"><div class="dsh-desktop-row-main"><div class="dsh-desktop-row-title">项目主页</div><div class="dsh-desktop-row-detail">GitHub 源码、发行版本与问题反馈</div></div><button class="dsh-desktop-link" data-open-update="project">打开</button></div>
        </div>
      </section>
    `;

    panel.querySelectorAll('[data-check-update]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (checking || !shell?.checkUpdates) return;
        checking = true;
        render(panel);
        try {
          const result = await shell.checkUpdates(button.dataset.checkUpdate);
          updateResult = { ...updateResult, ...result };
        } catch (error) {
          const scope = button.dataset.checkUpdate;
          const failure = { ok: false, error: error.message || '检查失败' };
          updateResult = scope === 'all' ? { desktop: failure, dsh: failure } : { ...updateResult, [scope]: failure };
        } finally {
          checking = false;
          render(panel);
        }
      });
    });
    panel.querySelector('[data-restart-dsh]')?.addEventListener('click', () => shell?.requestRestart?.());
    panel.querySelector('[data-update-dsh]')?.addEventListener('click', async () => {
      if (updatingDsh || !shell?.updateDsh) return;
      updatingDsh = true;
      updateNotice = '正在通过 npm 更新全局 DSH，请勿退出桌面应用…';
      updateNoticeType = '';
      render(panel);
      try {
        const result = await requestDshUpdate();
        if (result.cancelled) {
          updateNotice = '';
          return;
        }
        updateNotice = result.alreadyLatest ? '当前 DSH 已是最新版本。' : 'DSH 更新完成，正在重启 DeepSeek Harness…';
        updateNoticeType = 'success';
        if (result.restartRequired) setTimeout(() => shell.requestRestart?.(), 800);
      } catch (error) {
        updateNotice = `DSH 更新失败：${error.message || '未知错误'}`;
        updateNoticeType = 'error';
      } finally {
        updatingDsh = false;
        if (panel.isConnected) render(panel);
      }
    });
    panel.querySelectorAll('[data-open-update]').forEach((button) => {
      button.addEventListener('click', () => shell?.openUpdatePage?.(button.dataset.openUpdate));
    });
    panel.querySelector('[data-startup-update-toggle]')?.addEventListener('change', async (event) => {
      const previous = preferences.checkOnStartup;
      const next = event.currentTarget.checked;
      savingPreferences = true;
      preferences = { ...preferences, checkOnStartup: next };
      render(panel);
      try {
        preferences = await shell.setUpdatePreferences({ checkOnStartup: next });
        if (updateNotice.startsWith('保存更新设置失败：')) updateNotice = '';
      } catch (error) {
        preferences = { ...preferences, checkOnStartup: previous };
        updateNotice = `保存更新设置失败：${error.message || '未知错误'}`;
        updateNoticeType = 'error';
      } finally {
        savingPreferences = false;
        if (panel.isConnected) render(panel);
      }
    });
  }

  function restoreNativeContent(dialog) {
    const panel = dialog.querySelector(`[${PANEL_ATTRIBUTE}]`);
    if (panel) panel.remove();
    const content = dialog.querySelector('nav')?.nextElementSibling;
    if (!content) return;
    const header = content.firstElementChild;
    const options = header?.nextElementSibling;
    if (header?.firstElementChild) header.firstElementChild.hidden = false;
    if (options) options.hidden = false;
  }

  async function showDesktopSettings(dialog, button, nativeButtons, activeClasses) {
    nativeButtons.forEach((item) => {
      activeClasses.forEach((className) => item.classList.remove(className));
      item.removeAttribute('aria-current');
    });
    activeClasses.forEach((className) => button.classList.add(className));
    button.setAttribute('aria-current', 'true');

    const content = dialog.querySelector('nav')?.nextElementSibling;
    if (!content) return;
    const header = content.firstElementChild;
    const options = header?.nextElementSibling;
    if (header?.firstElementChild) header.firstElementChild.hidden = true;
    if (options) options.hidden = true;

    let panel = content.querySelector(`[${PANEL_ATTRIBUTE}]`);
    if (!panel) {
      panel = document.createElement('div');
      panel.setAttribute(PANEL_ATTRIBUTE, '');
      content.appendChild(panel);
    }
    render(panel);
    if (!info && shell?.getDesktopInfo) {
      try { info = await shell.getDesktopInfo(); } catch {}
      if (panel.isConnected) render(panel);
    }
  }

  function enhanceDialog(dialog) {
    const nav = dialog.querySelector('nav');
    if (!nav || nav.querySelector(`[${NAV_ATTRIBUTE}]`)) return;
    const nativeButtons = Array.from(nav.querySelectorAll('button'));
    if (!nativeButtons.length) return;
    const navList = nativeButtons[0].parentElement;
    if (!navList || !nativeButtons.every((button) => button.parentElement === navList)) return;

    const activeButton = nativeButtons.find((button) => button.getAttribute('aria-current') === 'true') || nativeButtons[0];
    const inactiveButton = nativeButtons.find((button) => button !== activeButton) || activeButton;
    const activeClasses = Array.from(activeButton.classList).filter((className) => !inactiveButton.classList.contains(className));
    const button = inactiveButton.cloneNode(true);
    button.setAttribute(NAV_ATTRIBUTE, '');
    button.removeAttribute('aria-current');
    button.querySelector('span')?.replaceChildren('桌面应用');
    const icon = button.querySelector('svg');
    if (icon) {
      icon.setAttribute('viewBox', '0 0 16 16');
      icon.innerHTML = '<rect x="1.5" y="2.25" width="13" height="9" rx="1.5" stroke="currentColor" stroke-width="1.25"/><path d="M5.25 13.75h5.5M8 11.5v2.25" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>';
    }
    button.addEventListener('click', () => showDesktopSettings(dialog, button, nativeButtons, activeClasses));
    navList.addEventListener('click', (event) => {
      const clicked = event.target.closest('button');
      if (!clicked || clicked === button) return;
      activeClasses.forEach((className) => button.classList.remove(className));
      button.removeAttribute('aria-current');
      restoreNativeContent(dialog);
    });
    navList.appendChild(button);
  }

  installStyles();
  Promise.all([
    shell?.getUpdatePreferences?.().catch(() => preferences),
    shell?.checkStartupUpdates?.().catch(() => null)
  ]).then(([storedPreferences, startupResult]) => {
    if (storedPreferences) preferences = storedPreferences;
    if (startupResult) {
      updateResult = { ...updateResult, ...startupResult };
      showStartupUpdateModal(startupResult);
    }
    const openPanel = document.querySelector(`[${PANEL_ATTRIBUTE}]`);
    if (openPanel) render(openPanel);
  });
  const observer = new MutationObserver(() => {
    document.querySelectorAll('[role="dialog"]').forEach(enhanceDialog);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll('[role="dialog"]').forEach(enhanceDialog);
})();
