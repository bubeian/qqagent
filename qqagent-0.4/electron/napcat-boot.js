// NapCat 计划任务启动器（2026-11-09）
//
// 目标：QQ Agent 启动时"默认以管理员启动 NapCat"，但不要每次都弹 UAC。
// 做法：首次启动时用一次 UAC 创建一个「最高权限 + 交互式」的计划任务，
//       之后统一用 schtasks /run 拉起，全程无弹窗。
//
// 为什么不用 Start-Process -Verb RunAs 每次拉起：
//   UAC 只拦"普通进程提权"，不拦"本来就有最高权限的计划任务"。

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TASK_NAME = 'QQAgent-NapCat';
const STOP_TASK = 'QQAgent-StopAll';   // 关闭全部后台（NapCat + TTS）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTALL_BAT = path.resolve(__dirname, '..', 'scripts', 'install-napcat-task.bat');

function run(exe, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout: 120000, ...opts }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || '')
      });
    });
  });
}

/** 计划任务是否已存在 */
export async function taskExists(name) {
  const r = await run('schtasks.exe', ['/query', '/tn', name]);
  return r.ok;
}

export async function napcatTaskExists() {
  return taskExists(TASK_NAME);
}

/**
 * 确保计划任务存在；不存在时提权创建（会弹一次 UAC）。
 * @returns {{ok:boolean, created:boolean, error?:string}}
 */
export async function ensureNapcatTask(force = false) {
  if (!force && (await napcatTaskExists())) return { ok: true, created: false };

  if (!(await fileExists(INSTALL_BAT))) {
    return { ok: false, created: false, error: `找不到 ${INSTALL_BAT}` };
  }

  const ps = `Start-Process -FilePath cmd.exe -ArgumentList '/c','"${INSTALL_BAT}"' -Verb RunAs -Wait -WindowStyle Hidden`;
  const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps]);

  const exists = await napcatTaskExists();
  return {
    ok: exists,
    created: exists,
    error: exists ? '' : (r.stderr.trim() || '计划任务创建失败（可能取消了 UAC）')
  };
}

/** 通过计划任务启动 NapCat（无 UAC） */
export async function startNapcat() {
  const r = await run('schtasks.exe', ['/run', '/tn', TASK_NAME]);
  return { ok: r.ok, error: r.ok ? '' : (r.stderr.trim() || r.stdout.trim() || 'schtasks /run 失败') };
}


// ── OneBot 配置自检（2026-11-09）────────────────────────────────
// 场景：新装的 NapCat 首次扫码登录后，onebot11_<uin>.json 是空配置，
//       QQ Agent 永远连不上 3000/3001。这里在启动后持续盯一段时间：
//       一旦检测到"已登录但端口没起"，就自动补配置并热更新。
// 只在本次进程内跑，最多盯 30 分钟或成功一次即止。

let selfCheckTimer = null;

export function startOnebotSelfCheck({ log = () => {}, intervalMs = 60000, maxTries = 30 } = {}) {
  if (selfCheckTimer) return;
  let tries = 0;

  const tick = async () => {
    tries += 1;
    try {
      const { ensureOnebotServers } = await import('../src/napcat.js');
      const r = await ensureOnebotServers();
      if (r.ok) {
        log(r.changed ? 'OneBot 配置已自动补全，3000/3001 已监听' : 'OneBot 端口正常');
        stopOnebotSelfCheck();
        return;
      }
      if (r.reason === 'not-logged-in') {
        // 还没扫码，安静等待
      } else {
        log('OneBot 自检未通过：' + (r.error || r.reason || 'unknown'));
      }
    } catch (e) {
      log('OneBot 自检异常：' + String(e?.message || e));
    }
    if (tries >= maxTries) stopOnebotSelfCheck();
  };

  selfCheckTimer = setInterval(tick, intervalMs);
  if (selfCheckTimer.unref) selfCheckTimer.unref();
  setTimeout(tick, 8000); // 启动后先试一次
}

export function stopOnebotSelfCheck() {
  if (selfCheckTimer) {
    clearInterval(selfCheckTimer);
    selfCheckTimer = null;
  }
}

/** 确保「关闭全部后台」任务存在（不存在时提权创建一次，和启动任务共用一次 UAC） */
export async function ensureStopTask() {
  if (await taskExists(STOP_TASK)) return { ok: true, created: false };
  if (!(await fileExists(INSTALL_BAT))) {
    return { ok: false, created: false, error: `找不到 ${INSTALL_BAT}` };
  }
  const ps = `Start-Process -FilePath cmd.exe -ArgumentList '/c','"${INSTALL_BAT}"' -Verb RunAs -Wait -WindowStyle Hidden`;
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
  const ok = await taskExists(STOP_TASK);
  return { ok, created: ok, error: ok ? '' : '关闭任务创建失败（可能取消了 UAC）' };
}

/**
 * 关闭全部后台服务：NapCat(QQ) + TTS。
 * 优先走最高权限计划任务（无 UAC）；任务不存在则提权运行 stop-all.bat。
 */
export async function stopAllBackground({ log = () => {} } = {}) {
  try {
    if (!(await taskExists(STOP_TASK))) {
      const e = await ensureStopTask();
      log(e.ok ? '关闭任务已就绪' : '关闭任务创建失败：' + e.error);
    }

    if (await taskExists(STOP_TASK)) {
      const r = await run('schtasks.exe', ['/run', '/tn', STOP_TASK]);
      log(r.ok ? '已通过计划任务关闭后台服务' : `关闭失败：${r.stderr || r.stdout}`);
      return { ok: r.ok, via: 'task' };
    }

    // 兜底：提权运行 stop-all.bat（会弹一次 UAC）
    const bat = path.resolve(__dirname, '..', 'scripts', 'stop-all.bat');
    if (!(await fileExists(bat))) return { ok: false, error: `找不到 ${bat}` };
    const ps = `Start-Process -FilePath cmd.exe -ArgumentList '/c','"${bat}"' -Verb RunAs -Wait -WindowStyle Hidden`;
    const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
    log(r.ok ? '已通过 UAC 关闭后台服务' : '关闭失败（可能取消了 UAC）');
    return { ok: r.ok, via: 'uac' };
  } catch (e) {
    const msg = String(e?.message || e);
    log('关闭后台异常：' + msg);
    return { ok: false, error: msg };
  }
}

/** QQ 是否在跑（NapCat 注入后 QQ 进程一定存在） */
export async function isNapcatRunning() {
  const r = await run('tasklist.exe', ['/fi', 'imagename eq QQ.exe']);
  return /QQ\.exe/i.test(r.stdout);
}

/** QQ Agent 启动时调用：没在跑就确保任务并拉起 */
export async function ensureAndStart({ log = () => {}, forceTask = false } = {}) {
  try {
    // 先把「启动」和「关闭」两个计划任务都准备好（共用一次 UAC），
    // 否则退出时还要再弹一次提权。
    const t = await ensureNapcatTask(forceTask);
    log(`启动任务：${t.ok ? (t.created ? '已创建' : '已存在') : '创建失败 ' + t.error}`);
    if (!t.ok) return { ok: false, error: t.error };

    const st = await ensureStopTask();
    log(`关闭任务：${st.ok ? (st.created ? '已创建' : '已存在') : '创建失败 ' + st.error}`);

    if (await isNapcatRunning()) {
      log('NapCat 已在运行，跳过启动');
      return { ok: true, skipped: true };
    }

    const s = await startNapcat();
    log(s.ok ? '已通过计划任务启动 NapCat' : `启动失败：${s.error}`);
    if (s.ok) startOnebotSelfCheck({ log });
    return { ok: s.ok, error: s.error, started: s.ok };
  } catch (e) {
    const msg = String(e?.message || e);
    log('NapCat 启动异常：' + msg);
    return { ok: false, error: msg };
  }
}

async function fileExists(p) {
  try {
    const fs = await import('node:fs/promises');
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
