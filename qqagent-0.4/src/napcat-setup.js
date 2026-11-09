// QQ 隔离引导（2026-11-09）
//
// 背景：NapCat 必须由它自己拉起 QQ，而 QQ 是单实例的。如果不做隔离，
// 机器人启动时就得杀掉用户自己的 QQ。
//
// 方案：首次启动弹「使用须知」，让用户二选一：
//   · 下载独立 QQ → 把系统 QQ 程序体复制到 <包根>/qq-nt，机器人只用它，
//                    个人 QQ 可以同时在线（磁盘 +1.2 GB）
//   · 不下载       → 继续用系统 QQ，机器人启动时会先关掉所有 QQ
//
// 这里只负责"检测 + 复制 + 记状态"，UI 在 ui/app/14-setup.js。

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_ROOT = path.resolve(APP_ROOT, '..');
const QQ_COPY_DIR = path.join(PKG_ROOT, 'qq-nt');

const EXCLUDE_DIRS = ['Tencent Files', 'Weixin', 'wxltjl'];
const EXCLUDE_FILES = ['Uninstall.exe', 'Uninstall.xml'];

function sh(exe, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** 从注册表找系统 QQ 安装目录 */
async function detectSystemQQ() {
  const r = await sh('reg.exe', [
    'query',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ',
    '/v',
    'UninstallString'
  ]);
  if (r.ok) {
    const m = /REG_SZ\s+(.+?)\s*$/m.exec(r.stdout);
    if (m) {
      const uninstall = m[1].replace(/^"|"$/g, '');
      const dir = path.dirname(uninstall);
      if (fs.existsSync(path.join(dir, 'QQ.exe'))) return dir;
    }
  }
  // 兜底：常见安装位置
  for (const p of ['D:\\tecent', 'C:\\Program Files\\Tencent\\QQNT', 'C:\\Program Files (x86)\\Tencent\\QQNT']) {
    if (fs.existsSync(path.join(p, 'QQ.exe'))) return p;
  }
  return '';
}

/** 复制 QQ 程序体（不含聊天记录/微信），返回是否成功 */
async function copySystemQQ(systemDir) {
  if (!systemDir) return { ok: false, error: '没有找到系统 QQ 安装目录' };
  try {
    fs.mkdirSync(QQ_COPY_DIR, { recursive: true });
  } catch (e) {
    return { ok: false, error: `无法创建目录 ${QQ_COPY_DIR}：${e.message}` };
  }

  const args = [systemDir, QQ_COPY_DIR, '/E', '/MT:8', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
    '/XD', ...EXCLUDE_DIRS.map((d) => path.join(systemDir, d)),
    '/XF', ...EXCLUDE_FILES];

  const r = await sh('robocopy.exe', args, 15 * 60 * 1000);
  // robocopy: 0-7 成功，>=8 失败
  if (r.code >= 8) {
    return { ok: false, error: `复制失败（robocopy ${r.code}）：${(r.stderr || r.stdout).slice(0, 200)}` };
  }
  if (!fs.existsSync(path.join(QQ_COPY_DIR, 'QQ.exe'))) {
    return { ok: false, error: '复制完成但 qq-nt\\QQ.exe 不存在' };
  }
  return { ok: true, dir: QQ_COPY_DIR };
}

/** 当前状态 */
export async function setupStatus(cfg = {}) {
  const systemQQ = await detectSystemQQ();
  const hasCopy = fs.existsSync(path.join(QQ_COPY_DIR, 'QQ.exe'));
  const napcatCfg = cfg?.napcat || {};
  return {
    ok: true,
    done: !!napcatCfg.setupDone,
    isolate: !!napcatCfg.isolateQQ,
    hasCopy,
    systemQQ,
    copyDir: QQ_COPY_DIR,
    sizeMB: hasCopy ? dirSizeMB(QQ_COPY_DIR) : 0
  };
}

function dirSizeMB(p) {
  try {
    let sum = 0;
    const stack = [p];
    while (stack.length) {
      const cur = stack.pop();
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        const fp = path.join(cur, ent.name);
        if (ent.isDirectory()) stack.push(fp);
        else {
          try { sum += fs.statSync(fp).size; } catch { /* ignore */ }
        }
      }
    }
    return Math.round(sum / 1024 / 1024);
  } catch {
    return 0;
  }
}

/**
 * 处理用户选择。
 * @param {{isolate:boolean}} opts
 * @returns {{ok:boolean, isolate:boolean, copied?:boolean, error?:string}}
 */
export async function applySetup({ isolate }) {
  const systemQQ = await detectSystemQQ();

  if (!isolate) {
    return { ok: true, isolate: false, copied: false, systemQQ };
  }

  const hasCopy = fs.existsSync(path.join(QQ_COPY_DIR, 'QQ.exe'));
  if (hasCopy) {
    return { ok: true, isolate: true, copied: false, reused: true, systemQQ, copyDir: QQ_COPY_DIR };
  }

  const r = await copySystemQQ(systemQQ);
  if (!r.ok) return { ok: false, isolate: true, error: r.error };
  return { ok: true, isolate: true, copied: true, systemQQ, copyDir: r.dir };
}

export const setupPaths = { APP_ROOT, PKG_ROOT, QQ_COPY_DIR };
