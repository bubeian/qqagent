// 「下载额外功能」向导（2026-11-09）
//
// 两页：独立QQ → 语音模型
//   · 已经装过的页会自动隐藏（独立QQ 看 qq-nt 是否存在；语音模型看模型文件是否完整）
//   · 首次启动自动弹；用户点过 × 之后不再自动弹（仍可从顶部按钮手动打开）
//   · × 的行为：后面还有页就翻到下一页，没有才关闭弹窗（并记下"不再提示"）
//
// 视觉：白底卡片；右上角 ×；底部单个居中的「下载」按钮。

(function () {
  const ICON_DOWNLOAD =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>';

  const EXTRA_TEXT = '后续可在额外功能中下载。';

  // 每一页：installed(st) 为真时该页不再展示
  const PAGE_DEFS = [
    {
      key: 'napcat',
      title: '是否下载独立QQ',
      body: '下载独立QQ可以让你使用小号进行聊天时，同时登录自己的大号QQ。',
      extra: EXTRA_TEXT,
      api: '/api/napcat/setup',
      payloadYes: { isolate: true },
      busyText: '正在下载独立QQ（约 1.2 GB），请稍候……',
      doneText: '独立QQ已就绪。',
      installed: (st) => !!st?.napcat?.hasCopy
    },
    {
      key: 'tts',
      title: '是否下载语音模型',
      body: '下载语音模型后，机器人可以用自己的声音发语音条（约 3.5 GB）。',
      extra: EXTRA_TEXT,
      api: '/api/tts/setup',
      payloadYes: { install: true },
      busyText: '正在下载语音模型（约 3.5 GB），请稍候……',
      doneText: '语音模型已就绪。',
      installed: (st) => !!st?.tts?.installed
    }
  ];

  let busy = false;
  let stopPoll = false;
  let pages = [];
  let current = 0;
  const nodes = {};

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  async function api(path, body) {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    return r.json();
  }

  function setBusy(on) {
    busy = on;
    if (nodes.btnYes) nodes.btnYes.disabled = on;
  }

  function renderPage(idx) {
    current = idx;
    stopPoll = false;
    const p = pages[idx];
    if (!p) return;
    nodes.title.textContent = p.title;
    nodes.body.textContent = p.body;
    nodes.extra.textContent = p.extra;
    nodes.status.textContent = '';
    setBusy(false);
  }

  function close() {
    if (nodes.mask) nodes.mask.remove();
    nodes.mask = null;
  }

  async function pollTts() {
    for (let i = 0; i < 2400; i++) {
      if (stopPoll) return;
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const st = await api('/api/tts/setup');
        const p = st?.progress || {};
        if (p.error) {
          nodes.status.textContent = '下载失败：' + p.error;
          setBusy(false);
          return;
        }
        if (st?.installed && !p.running) {
          nodes.status.textContent = '语音模型部署完成。';
          return;
        }
        const got = (p.received / 1024 / 1024 / 1024).toFixed(2);
        const all = (p.total / 1024 / 1024 / 1024).toFixed(2);
        nodes.status.textContent = p.phase === 'copy-runtime'
          ? '正在部署运行环境…'
          : `正在下载语音模型… ${p.percent || 0}%（${got} / ${all} GB）`;
      } catch {
        /* 网络抖动忽略 */
      }
    }
    nodes.status.textContent = '下载超时，请稍后重试。';
    setBusy(false);
  }

  async function chooseDownload() {
    if (busy) return;
    const p = pages[current];
    setBusy(true);
    nodes.status.textContent = p.busyText;
    try {
      const r = await api(p.api, p.payloadYes);
      if (!r?.ok) throw new Error(r?.error || '操作失败');

      nodes.status.textContent = r?.reused ? '已存在，直接启用。' : p.doneText;

      // 语音模型是后台下载，轮询进度
      if (r?.started && p.key === 'tts') {
        await pollTts();
        setTimeout(finishStep, 800);
        return;
      }
      setTimeout(finishStep, 700);
    } catch (e) {
      nodes.status.textContent = '失败：' + String(e?.message || e);
      setBusy(false);
    }
  }

  // 当前页完成后：还有下一页就翻页，否则关闭
  function finishStep() {
    setBusy(false);
    if (current < pages.length - 1) renderPage(current + 1);
    else close();
  }

  // 关闭并记住"不再自动弹"
  async function dismissAndClose() {
    if (current === pages.length - 1) {
      await api('/api/setup/dismiss', {}).catch(() => {});
    }
    close();
  }

  function buildModal(list, startPage = 0) {
    pages = list;
    const mask = el('div', 'setup-mask');
    const card = el('div', 'setup-card');

    nodes.close = el('button', 'setup-close', '&times;');
    nodes.close.type = 'button';
    nodes.close.title = '关闭';
    card.append(nodes.close);

    nodes.title = el('div', 'setup-title');
    nodes.hr = el('div', 'setup-hr');
    nodes.body = el('div', 'setup-body');
    nodes.extra = el('div', 'setup-body setup-body-extra');
    nodes.status = el('div', 'setup-status', '');

    const row = el('div', 'setup-actions');
    nodes.btnYes = el('button', 'setup-btn setup-btn-yes');
    nodes.btnYes.type = 'button';
    nodes.btnYes.innerHTML = `<span class="setup-btn-icon">${ICON_DOWNLOAD}</span><span>下载</span>`;
    row.append(nodes.btnYes);

    card.append(nodes.title, nodes.hr, nodes.body, nodes.extra, nodes.status, row);
    mask.append(card);
    document.body.append(mask);
    nodes.mask = mask;

    nodes.btnYes.addEventListener('click', () => chooseDownload());

    nodes.close.addEventListener('click', async () => {
      stopPoll = true;
      if (busy && pages[current]?.key === 'tts') {
        // 正在下载语音模型：先暂停（保留 .part 可续传）
        await api('/api/tts/setup', { pause: true }).catch(() => {});
      }
      setBusy(false);
      if (current < pages.length - 1) renderPage(current + 1);
      else await dismissAndClose();
    });

    renderPage(Math.min(startPage, pages.length - 1));
  }

  // 已经装好的页不展示
  function pendingPages(st) {
    return PAGE_DEFS.filter((p) => !p.installed(st));
  }

  async function init() {
    try {
      const st = await api('/api/setup');
      if (!st?.ok) return;
      if (st.dismissed) return;                 // 用户点过 ×，不再自动弹
      const list = pendingPages(st);
      if (!list.length) return;                 // 都装好了
      if (!document.querySelector('.setup-mask')) buildModal(list, 0);
    } catch {
      /* 后端没就绪就下次再说 */
    }
  }

  // 顶部「下载额外功能」按钮：总是可以手动打开
  window.__qqaOpenSetup = async function () {
    if (document.querySelector('.setup-mask')) return;
    let st = null;
    try { st = await api('/api/setup'); } catch { /* ignore */ }
    const list = st ? pendingPages(st) : PAGE_DEFS.slice();

    if (!list.length) {
      // 全部已就绪：给个轻提示，不弹向导
      const mask = el('div', 'setup-mask');
      const card = el('div', 'setup-card');
      const x = el('button', 'setup-close', '&times;');
      x.type = 'button';
      x.addEventListener('click', () => mask.remove());
      const title = el('div', 'setup-title', '额外功能已全部就绪');
      const hr = el('div', 'setup-hr');
      const body = el('div', 'setup-body', '独立QQ与语音模型都已安装，无需重复下载。');
      card.append(x, title, hr, body);
      mask.append(card);
      document.body.append(mask);
      return;
    }
    buildModal(list, 0);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
