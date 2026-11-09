// 右上角账号头像 + 二级面板 + 扫码登录（2026-11-09）
//
// 数据都走本机后端代理（/api/napcat/*），不直连 NapCat WebUI：
//   GET  /api/napcat/account  → { ok, loggedIn, uin, nick, avatar }
//   POST /api/napcat/qr       → { ok, qrcode }（refresh:true 强制换新码）
//   POST /api/napcat/logout   → 重启 NapCat 回到登录态
//
// 交互：
//   · 默认空白头像；登录后显示 QQ 头像
//   · 点头像展开二级面板（头像居中，底部「切换账号 | 退出登录」）
//   · 扫码弹窗：二维码 2 分钟失效 → 模糊 + 圆形刷新箭头 → 点击换新码

(function () {
  const PLACEHOLDER =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" fill="#2a2f3a"/>' +
        '<circle cx="32" cy="25" r="11" fill="#818a99"/>' +
        '<path d="M10 60c2-13 10-20 22-20s20 7 22 20z" fill="#818a99"/>' +
      '</svg>'
    );

  const QR_TTL = 120000;   // 二维码有效期 2 分钟
  const POLL_MS = 3000;    // 登录状态轮询

  const el = {};
  let account = { loggedIn: false, uin: '', nick: '', avatar: '' };
  let qrTimer = null;
  let pollTimer = null;
  let qrBusy = false;

  function $(id) {
    return document.getElementById(id);
  }

  function avatarHTML(acc, cls) {
    const src = acc && acc.loggedIn && acc.avatar ? acc.avatar : PLACEHOLDER;
    return '<img class="' + cls + '" src="' + src + '" alt="" referrerpolicy="no-referrer" />';
  }

  async function api(path, body) {
    const resp = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    return resp.json();
  }

  function applyAccount(acc) {
    account = acc || { loggedIn: false, uin: '', nick: '', avatar: '' };
    const slot = $('account-avatar-slot');
    if (slot) slot.innerHTML = avatarHTML(account, 'account-img');

    // 左上角两行状态：上行 QQ 账号
    const accEl = $('qq-status-account');
    if (accEl) {
      if (account.loggedIn) {
        accEl.textContent = account.nick || account.uin;
        accEl.title = account.uin ? `QQ ${account.uin}` : '';
      } else {
        accEl.textContent = '未登录';
        accEl.title = '';
      }
    }

    // 同步给横幅：未登录时顶部显示「QQ 账号未登录，请点击左上角登录」
    try {
      if (typeof state !== 'undefined') state.qqLoggedIn = !!account.loggedIn;
      if (typeof renderBanner === 'function') renderBanner();
    } catch { /* 横幅失败不影响账号面板 */ }

    const btn = $('account-btn');
    if (btn) btn.title = account.loggedIn ? `${account.nick || account.uin}（QQ ${account.uin}）` : '未登录，点击扫码登录';

    const popAvatar = $('account-pop-avatar');
    if (popAvatar) popAvatar.innerHTML = avatarHTML(account, 'account-pop-img');
    if ($('account-pop-name')) $('account-pop-name').textContent = account.loggedIn ? account.nick || account.uin : '未登录';
    if ($('account-pop-uin')) $('account-pop-uin').textContent = account.loggedIn ? `QQ ${account.uin}` : '扫码后显示账号信息';

    if ($('account-switch-btn')) $('account-switch-btn').textContent = account.loggedIn ? '切换账号' : '扫码登录';
    if ($('account-logout-btn')) $('account-logout-btn').style.display = account.loggedIn ? '' : 'none';
    const divider = document.querySelector('#account-pop .account-pop-divider');
    if (divider) divider.style.display = account.loggedIn ? '' : 'none';
  }

  async function reload() {
    try {
      const acc = await api('/api/napcat/account');
      applyAccount(acc);
    } catch {
      /* 后端没起来时静默，头像保持空白 */
    }
  }

  // ── 二级面板 ─────────────────────────────────────────────
  function togglePopup(force) {
    const pop = $('account-pop');
    if (!pop) return;
    const show = typeof force === 'boolean' ? force : pop.classList.contains('hidden');
    pop.classList.toggle('hidden', !show);
    if (show) {
      // 贴着头像右对齐展开
      const btn = $('account-btn');
      if (btn) {
        const r = btn.getBoundingClientRect();
        pop.style.top = `${Math.round(r.bottom + 8)}px`;
        // 头像在左上角：靠左时向左对齐展开，否则仍右对齐
        if (r.left < window.innerWidth / 2) {
          pop.style.left = `${Math.round(r.left)}px`;
          pop.style.right = 'auto';
        } else {
          pop.style.right = `${Math.round(window.innerWidth - r.right)}px`;
          pop.style.left = 'auto';
        }
      }
      reload();
    }
  }

  // ── 二维码 ───────────────────────────────────────────────
  function setQrStatus(text, tone) {
    const node = $('qr-status');
    if (!node) return;
    node.textContent = text || '';
    node.dataset.tone = tone || '';
  }

  function renderQr(qrcode) {
    const box = $('qr-image');
    if (!box) return;
    try {
      // qrcode-generator 以全局 qrcode 暴露；qrcodegen 只是有的打包版本的名字
      const factory = (typeof qrcodegen !== 'undefined') ? qrcodegen : window.qrcode;
      if (typeof factory !== 'function') throw new Error('二维码库未加载（/vendor/qrcode.js）');
      const qr = factory(0, 'M');
      qr.addData(qrcode);
      qr.make();
      box.innerHTML = qr.createImgTag(6, 8);
      box.classList.remove('qr-blur');
      $('qr-expired')?.classList.add('hidden');
    } catch (e) {
      box.textContent = '二维码渲染失败';
      setQrStatus(String(e?.message || e), 'error');
    }
  }

  function markExpired() {
    $('qr-image')?.classList.add('qr-blur');
    $('qr-expired')?.classList.remove('hidden');
    setQrStatus('二维码已失效，点中间的箭头换新码', 'warn');
  }

  function armQrTimer() {
    clearTimeout(qrTimer);
    qrTimer = setTimeout(markExpired, QR_TTL);
  }

  async function loadQr(refresh) {
    if (qrBusy) return;
    qrBusy = true;
    setQrStatus(refresh ? '正在刷新二维码…' : '正在获取二维码…');
    try {
      let r = null;
      for (let i = 0; i < 8; i++) {
        try {
          r = await api('/api/napcat/qr', { refresh: !!refresh });
          if (r && r.ok) break;
          if (r && r.loggedIn) break;          // 已登录，不用再试
        } catch { /* 重启中，继续等 */ }
        await new Promise((res) => setTimeout(res, 1500));
      }
      if (!r?.ok) {
        setQrStatus(r?.error || '获取二维码失败', 'error');
        // 已登录：直接关掉弹窗并刷新头像
        if (r?.loggedIn) {
          closeQr();
          reload();
        }
        return;
      }
      renderQr(r.qrcode);
      setQrStatus('等待扫码…（2 分钟内有效）');
      armQrTimer();
      startPolling();
    } catch (e) {
      setQrStatus(String(e?.message || e), 'error');
    } finally {
      qrBusy = false;
    }
  }

  async function openQr() {
    togglePopup(false);
    $('qr-mask')?.classList.remove('hidden');
    if (account.loggedIn) {
      // 已登录：必须先退出才能拿到二维码
      setQrStatus('需要先退出当前账号才能扫码切换…');
      await doLogout({ silent: true });
    }
    await loadQr(false);
  }

  function closeQr() {
    $('qr-mask')?.classList.add('hidden');
    clearTimeout(qrTimer);
    stopPolling();
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const acc = await api('/api/napcat/account');
        if (acc?.loggedIn) {
          applyAccount(acc);
          setQrStatus('登录成功！', 'ok');
          stopPolling();
          clearTimeout(qrTimer);
          setTimeout(closeQr, 900);
        }
      } catch {
        /* 重启期间后端可能短暂失败，忽略 */
      }
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ── 退出登录 ─────────────────────────────────────────────
  async function doLogout(opts = {}) {
    const tip = $('account-pop-tip');
    if (tip) tip.textContent = '正在退出登录…';
    try {
      const r = await api('/api/napcat/logout', {});
      if (!r?.ok) {
        if (tip) tip.textContent = r?.error || '退出失败';
        return;
      }
      // NapCat 重启需要几秒，轮询等它回到未登录
      let ok = false;
      for (let i = 0; i < 12; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        try {
          const acc = await api('/api/napcat/account');
          if (!acc?.loggedIn) {
            ok = true;
            applyAccount(acc);
            break;
          }
        } catch {
          /* 重启中 */
        }
      }
      if (tip) tip.textContent = ok ? '已退出登录' : '已发送退出指令，稍后刷新';
      if (!opts.silent) {
        await loadQr(true);
      }
      setTimeout(() => {
        if (tip) tip.textContent = '';
      }, 3000);
    } catch (e) {
      if (tip) tip.textContent = String(e?.message || e);
    }
  }

  // ── 绑定 ─────────────────────────────────────────────────
  function bind() {
    $('account-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePopup();
    });

    $('account-switch-btn')?.addEventListener('click', () => {
      openQr();
    });

    $('account-logout-btn')?.addEventListener('click', async () => {
      togglePopup(false);
      await doLogout({});
    });

    $('qr-refresh-btn')?.addEventListener('click', () => loadQr(true));
    $('qr-close-btn')?.addEventListener('click', closeQr);
    $('qr-mask')?.addEventListener('click', (e) => {
      if (e.target === $('qr-mask')) closeQr();
    });

    document.addEventListener('click', (e) => {
      const pop = $('account-pop');
      if (!pop || pop.classList.contains('hidden')) return;
      if (pop.contains(e.target) || e.target.closest('#account-btn')) return;
      togglePopup(false);
    });

    // 登录成功后头像要自动刷新：NapCat 侧登录会发生在扫码弹窗之外（手机确认）
    setInterval(() => {
      if (!document.hidden) reload();
    }, 30000);
  }

  function init() {
    if (!$('account-btn')) return;
    bind();
    reload();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
