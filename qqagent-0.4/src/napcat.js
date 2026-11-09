// NapCat 账号桥接（2026-11-09）
//
// 目的：把 NapCat WebUI（默认 127.0.0.1:6099）的账号相关接口包一层给 UI 用：
//   - 读当前登录的 QQ（uin / 昵称 / 头像）
//   - 取扫码登录二维码（未登录时才有，已登录会返回 "QQ Is Logined"）
//   - 重启 NapCat 回到登录态（NapCat 没有"退出 QQ 账号"接口，只能重启）
//
// 为什么要服务端代理：控制台页面的 CSP 是 connect-src 'self'，
// 浏览器里不能直连 6099；而且 WebUI 需要 token 鉴权，token 不能落到前端。
//
// 配置来源（按顺序）：
//   1. 环境变量 NAPCAT_WEBUI_CONFIG 指向 webui.json
//   2. <项目根>/../napcat/config/webui.json
//   3. D:\qqagent\napcat\config\webui.json
//   4. 环境变量 NAPCAT_WEBUI_PORT / NAPCAT_WEBUI_TOKEN

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 应用根目录：用本文件位置推算，不依赖 process.cwd()
// （Electron 由启动器拉起时 cwd 是启动器目录，不是应用目录）
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_PORT = 6099;
const DEFAULT_HOST = '127.0.0.1';

function readWebuiConfig() {
  // 全部相对应用目录，保证整个包换机器/换盘符后仍能找到 NapCat 配置
  const candidates = [
    process.env.NAPCAT_WEBUI_CONFIG,
    path.resolve(APP_ROOT, 'data', 'napcat.json'),                              // 本控制台自己的覆盖配置
    path.resolve(APP_ROOT, '..', 'napcat-shell', 'config', 'webui.json'),       // 懒人包布局：<根>/napcat-shell
    path.resolve(APP_ROOT, '..', 'napcat', 'config', 'webui.json'),             // 旧布局：<根>/napcat
    path.resolve(APP_ROOT, '..', '..', 'napcat-shell', 'config', 'webui.json'),
    path.resolve(process.cwd(), 'data', 'napcat.json'),                          // 兜底：以进程 cwd 为准
    path.resolve(process.cwd(), '..', 'napcat-shell', 'config', 'webui.json')
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      // NapCat 默认把 host 写成 "::"（监听全部地址），直连时不能用它做 URL 主机
      const bindHost = String(j.host || '');
      const host = bindHost && bindHost !== '::' && bindHost !== '0.0.0.0' ? bindHost : DEFAULT_HOST;
      return {
        host,
        port: Number(j.port || j.webuiPort || DEFAULT_PORT),
        token: String(j.token || ''),
        source: p
      };
    } catch {
      /* 坏文件就跳过，换下一个候选 */
    }
  }
  return {
    host: DEFAULT_HOST,
    port: Number(process.env.NAPCAT_WEBUI_PORT || DEFAULT_PORT),
    token: String(process.env.NAPCAT_WEBUI_TOKEN || ''),
    source: ''
  };
}

let credCache = { credential: '', at: 0 };

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

async function getCredential(force = false) {
  const cfg = readWebuiConfig();
  if (!force && credCache.credential && Date.now() - credCache.at < 10 * 60 * 1000) {
    return { cfg, credential: credCache.credential };
  }
  if (!cfg.token) throw new Error('没有找到 NapCat WebUI token（napcat/config/webui.json）');

  const resp = await fetch(`http://${cfg.host}:${cfg.port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash: sha256Hex(`${cfg.token}.napcat`) }),
    signal: AbortSignal.timeout(8000)
  });
  const j = await resp.json().catch(() => null);
  const credential = j?.data?.Credential;
  if (!credential) {
    const msg = String(j?.message || resp.status);
    if (/token is invalid|token is empty/i.test(msg)) {
      throw new Error('NapCat WebUI token 已失效（NapCat 重启后可能在内存里换了新 token）。重启 NapCat 即可恢复；或在 data/napcat.json 里写 {"token":"当前token"} 覆盖');
    }
    throw new Error(`NapCat 鉴权失败：${msg}`);
  }
  credCache = { credential, at: Date.now() };
  return { cfg, credential };
}

async function napcatPost(pathname, body = {}) {
  const { cfg, credential } = await getCredential();
  const resp = await fetch(`http://${cfg.host}:${cfg.port}/api${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credential}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const text = await resp.text();
  let j = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`NapCat 返回非 JSON：${text.slice(0, 120)}`);
  }
  if (j?.code !== 0) {
    throw new Error(j?.message || `NapCat 接口错误（${resp.status}）`);
  }
  return j.data;
}

/** 当前账号：{ ok, loggedIn, uin, nick, avatar } */
export async function napcatAccount() {
  try {
    const st = await napcatPost('/QQLogin/CheckLoginStatus');
    if (!st?.isLogin) {
      return { ok: true, loggedIn: false, uin: '', nick: '', avatar: '' };
    }

    let info = null;
    try {
      info = await napcatPost('/QQLogin/GetQQLoginInfo');
    } catch {
      /* 掉线瞬间可能取不到，退回空 */
    }

    const uin = String(info?.uin || '');
    const nick = String(info?.nick || '');
    let avatar = '';

    // 头像不在 GetQQLoginInfo 里，在快速登录列表的 faceUrl
    try {
      const list = await napcatPost('/QQLogin/GetQuickLoginListNew');
      const hit = Array.isArray(list) ? list.find((x) => String(x.uin) === uin) : null;
      avatar = hit?.faceUrl || '';
    } catch {
      /* 列表取不到就退回官方头像地址 */
    }
    if (!avatar && uin) avatar = `https://q1.qlogo.cn/g?b=sdk&nk=${uin}&s=640`;

    return { ok: true, loggedIn: true, uin, nick, avatar };
  } catch (e) {
    return { ok: false, loggedIn: false, error: String(e?.message || e) };
  }
}

/** 取二维码：{ ok, qrcode } 或 { ok:false, error } */
export async function napcatQr({ refresh = false } = {}) {
  try {
    const st = await napcatPost('/QQLogin/CheckLoginStatus');
    if (st?.isLogin) {
      return { ok: false, loggedIn: true, error: 'QQ 已登录，无法获取登录二维码' };
    }
    const data = await napcatPost(refresh ? '/QQLogin/RefreshQRcode' : '/QQLogin/GetQQLoginQrcode');
    const qrcode = data?.qrcode || data?.data?.qrcode || '';
    if (!qrcode) return { ok: false, error: 'NapCat 没有返回二维码内容' };
    return { ok: true, qrcode };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * 退出登录：NapCat 没有注销 QQ 的接口，只能重启协议端回到登录态。
 * 重启期间 6099/3000 会短暂断开，前端要容忍失败并继续轮询。
 */
export async function napcatLogout() {
  try {
    await napcatPost('/QQLogin/RestartNapCat');
    credCache = { credential: '', at: 0 };
    return { ok: true, message: 'NapCat 正在重启，稍后会回到扫码登录' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ── OneBot 网络配置自检（2026-11-09）────────────────────────────
// 新装的 NapCat 首次登录后 onebot11_<uin>.json 是空配置（没有 3000/3001），
// 表现就是"扫码登录成功但 OneBot 一直连不上"。
// 这里读配置 → 缺就补 → SetConfig 热更新（不重启，避免掉登录态）→ 轮询端口。

const DEFAULT_HTTP = {
  name: 'qq-agent-http', enable: true, host: '127.0.0.1', port: 3000,
  enableCors: true, enableWebsocket: false, messagePostFormat: 'array', token: '', debug: false
};
const DEFAULT_WS = {
  name: 'qq-agent-ws', enable: true, host: '127.0.0.1', port: 3001,
  reportSelfMessage: false, enableForcePushEvent: true, messagePostFormat: 'array',
  token: '', debug: false, heartInterval: 30000
};

function hasServer(list, port) {
  return Array.isArray(list) && list.some((s) => Number(s?.port) === Number(port) && s?.enable !== false);
}

async function tcpOpen(port, host = '127.0.0.1') {
  const net = await import('node:net');
  return new Promise((resolve) => {
    let done = false;
    const sock = net.connect({ host, port });
    const finish = (v) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(v);
    };
    sock.setTimeout(600);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

/**
 * 确保 OneBot 的 HTTP(3000) / WS(3001) 已启用。
 * @returns {{ok:boolean, changed?:boolean, reason?:string, error?:string, ports?:object}}
 */
export async function ensureOnebotServers({ httpPort = 3000, wsPort = 3001 } = {}) {
  try {
    const st = await napcatPost('/QQLogin/CheckLoginStatus');
    if (!st?.isLogin) {
      return { ok: false, reason: 'not-logged-in', error: 'NapCat 未登录，跳过 OneBot 自检' };
    }

    const cfg = await napcatPost('/OB11Config/GetConfig');
    const net = cfg?.network || {};
    const httpOk = hasServer(net.httpServers, httpPort);
    const wsOk = hasServer(net.websocketServers, wsPort);

    if (httpOk && wsOk && (await tcpOpen(httpPort)) && (await tcpOpen(wsPort))) {
      return { ok: true, changed: false, ports: { http: true, ws: true } };
    }

    // 补齐缺失的服务器（保留用户已有的其它配置）
    const next = {
      ...cfg,
      network: {
        ...net,
        httpServers: httpOk ? net.httpServers : [...(net.httpServers || []), { ...DEFAULT_HTTP, port: httpPort }],
        websocketServers: wsOk ? net.websocketServers : [...(net.websocketServers || []), { ...DEFAULT_WS, port: wsPort }]
      }
    };

    await napcatPost('/OB11Config/SetConfig', { config: JSON.stringify(next) });

    // 热更新后端口通常几百毫秒到几秒内起来，轮询确认
    let http = false;
    let ws = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      http = await tcpOpen(httpPort);
      ws = await tcpOpen(wsPort);
      if (http && ws) break;
    }

    return {
      ok: http && ws,
      changed: true,
      ports: { http, ws },
      error: http && ws ? '' : '配置已写入，但 3000/3001 仍未监听（可能需要重启 NapCat）'
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** 诊断用：返回当前解析到的 NapCat 配置（不含 token 明文） */
export function napcatConfigInfo() {
  const cfg = readWebuiConfig();
  return { host: cfg.host, port: cfg.port, hasToken: !!cfg.token, source: cfg.source };
}
