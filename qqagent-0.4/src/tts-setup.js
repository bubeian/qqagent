// 语音模型安装（2026-11-09）
//
// 数据来源（ModelScope）：https://www.modelscope.cn/models/HereIsMark/audio.cpp-gguf
//   IndexTTS2.5-GGUF/index-tts2_5-q8_0.gguf     3,502,960,096 字节
//
// 部署步骤（后台任务，前端轮询进度）：
//   1. <包根>\tts-runtime\audio.cpp  →  <包根>\tts\audio.cpp   （包内自带，约 238 MB）
//   2. 下载 GGUF 到 <包根>\tts\models\index-tts2_5-q8_0.gguf（支持断点续传，.part 文件）
//   3. 复制 ref.wav，并按实际路径生成 server.json
//
// 进度通过 ttsStatus() 的 progress 字段暴露。

import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_ROOT = path.resolve(APP_ROOT, '..');
const TTS_DIR = path.join(PKG_ROOT, 'tts');
const RUNTIME_DIR = path.join(PKG_ROOT, 'tts-runtime');
const MODELS_DIR = path.join(TTS_DIR, 'models');

const MODEL_NAME = 'index-tts2_5-q8_0.gguf';
const MODEL_REL = path.join('models', MODEL_NAME);
const MODEL_URL =
  'https://www.modelscope.cn/models/HereIsMark/audio.cpp-gguf/resolve/master/IndexTTS2.5-GGUF/index-tts2_5-q8_0.gguf';
const MODEL_SIZE = 3502960096;

/** 运行中任务的进度（模块级；单进程单任务） */
let abortCtl = null;   // 暂停下载用

let job = {
  running: false,
  phase: '',        // copy-runtime | download | config | verify
  received: 0,
  total: MODEL_SIZE,
  percent: 0,
  error: '',
  message: ''
};

function resetJob() {
  job = { running: false, phase: '', received: 0, total: MODEL_SIZE, percent: 0, error: '', message: '' };
}

function isRuntimeOk() {
  return fs.existsSync(path.join(TTS_DIR, 'audio.cpp', 'audiocpp_server.exe'));
}

function isModelOk() {
  const p = path.join(TTS_DIR, MODEL_REL);
  try {
    return fs.existsSync(p) && fs.statSync(p).size >= MODEL_SIZE - 1024 * 1024;
  } catch {
    return false;
  }
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

function sh(exe, args, timeout = 15 * 60 * 1000) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** 生成/修复 server.json（模型路径按当前实际位置写绝对路径） */
export function ensureTtsConfig() {
  try {
    fs.mkdirSync(TTS_DIR, { recursive: true });
    const cfgPath = path.join(TTS_DIR, 'server.json');
    const modelPath = path.join(TTS_DIR, MODEL_REL).replace(/\\/g, '/');
    const cfg = {
      host: '127.0.0.1',
      port: 8080,
      backend: 'vulkan',
      device: 0,
      lazy_load: false,
      max_loaded_models: 1,
      models: [{ id: 'indextts', family: 'index_tts2', path: modelPath, task: 'clone', mode: 'offline' }]
    };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export async function ttsStatus(cfg = {}) {
  const installed = isRuntimeOk() && isModelOk();
  return {
    ok: true,
    done: !!cfg?.tts?.setupDone,
    enabled: !!cfg?.tts?.enabled,
    installed,
    runtime: isRuntimeOk(),
    model: isModelOk(),
    dir: TTS_DIR,
    sizeMB: installed ? dirSizeMB(TTS_DIR) : 0,
    source: MODEL_URL,
    progress: { ...job }
  };
}

async function copyRuntime() {
  job.phase = 'copy-runtime';
  job.message = '正在部署运行环境…';
  if (!fs.existsSync(path.join(RUNTIME_DIR, 'audio.cpp', 'audiocpp_server.exe'))) {
    throw new Error('包内缺少 tts-runtime（audio.cpp 未随包携带）');
  }
  fs.mkdirSync(TTS_DIR, { recursive: true });
  const r = await sh('robocopy.exe', [path.join(RUNTIME_DIR, 'audio.cpp'), path.join(TTS_DIR, 'audio.cpp'),
    '/E', '/MT:8', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XJD']);
  if (r.code >= 8) throw new Error(`复制运行环境失败（robocopy ${r.code}）`);

  for (const f of ['ref.wav']) {
    const src = path.join(RUNTIME_DIR, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(TTS_DIR, f));
  }
}

async function downloadModel() {
  job.phase = 'download';
  job.message = '正在下载语音模型…';
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  const dest = path.join(TTS_DIR, MODEL_REL);
  const part = `${dest}.part`;
  if (isModelOk()) {
    job.received = MODEL_SIZE;
    job.percent = 100;
    return;
  }

  let start = 0;
  try {
    if (fs.existsSync(part)) start = fs.statSync(part).size;
  } catch { /* ignore */ }
  if (start > MODEL_SIZE) start = 0;

  const headers = start > 0 ? { Range: `bytes=${start}-` } : {};
  abortCtl = new AbortController();
  const resp = await fetch(MODEL_URL, { headers, redirect: 'follow', signal: abortCtl.signal });
  if (!resp.ok) throw new Error(`下载失败：HTTP ${resp.status}`);

  // 服务端不支持断点续传时会返回 200，此时必须从头写
  if (start > 0 && resp.status !== 206) start = 0;

  job.received = start;
  job.percent = Math.floor((start / MODEL_SIZE) * 100);

  const out = fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' });
  try {
    for await (const chunk of resp.body) {
      const buf = Buffer.from(chunk);
      if (!out.write(buf)) {
        await new Promise((res) => out.once('drain', res));
      }
      job.received += buf.length;
      job.percent = Math.min(99, Math.floor((job.received / MODEL_SIZE) * 100));
    }
  } finally {
    await new Promise((res) => out.end(res));
  }

  const size = fs.statSync(part).size;
  if (size < MODEL_SIZE - 1024 * 1024) {
    throw new Error(`下载不完整：${size} / ${MODEL_SIZE} 字节`);
  }
  fs.renameSync(part, dest);
  job.percent = 100;
}

async function runInstall() {
  job.running = true;
  try {
    if (!isRuntimeOk()) await copyRuntime();
    await downloadModel();
    job.phase = 'config';
    job.message = '正在写入配置…';
    ensureTtsConfig();
    job.phase = 'verify';
    if (!(isRuntimeOk() && isModelOk())) throw new Error('部署校验失败');
    job.running = false;
    job.phase = 'done';
    job.message = '语音模型部署完成';
    job.percent = 100;
    // 下载完成立即拉起服务，配合 voice-say 技能直接可用
    ensureTtsRunning().catch(() => {});
  } catch (e) {
    job.running = false;
    if (e?.name === 'AbortError') {
      // 用户点了 ×：保留 .part，下次继续下载
      job.phase = 'paused';
      job.message = '下载已暂停';
      job.error = '';
    } else {
      job.error = String(e?.message || e);
      job.phase = 'error';
    }
  } finally {
    abortCtl = null;
  }
}

/** 启动安装（立即返回，进度用 ttsStatus 轮询） */
export async function installTts() {
  if (job.running) return { ok: true, started: true, running: true };
  if (isRuntimeOk() && isModelOk()) {
    ensureTtsConfig();
    return { ok: true, installed: true, reused: true };
  }
  resetJob();
  runInstall();
  return { ok: true, started: true, running: true };
}

// ── 自启动（2026-11-09）────────────────────────────────────────
// 模型下载完成后自动拉起服务；应用启动时也会检查一次（见 electron/main.js）。
// 服务进程 detached + 无窗口，和 NapCat 一样由 QQ Agent 托管。

const TTS_PORT = 8080;

function tcpOpen(port) {
  return new Promise((resolve) => {
    let done = false;
    const sock = net.connect({ host: '127.0.0.1', port });
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

export async function isTtsRunning() {
  return tcpOpen(TTS_PORT);
}

/**
 * 确保 TTS 服务在跑。
 * @returns {{ok:boolean, started?:boolean, alreadyRunning?:boolean, reason?:string, error?:string}}
 */
export async function ensureTtsRunning() {
  if (!(isRuntimeOk() && isModelOk())) {
    return { ok: false, reason: 'not-installed', error: '语音模型尚未安装' };
  }
  if (await tcpOpen(TTS_PORT)) {
    return { ok: true, alreadyRunning: true };
  }

  const exe = path.join(TTS_DIR, 'audio.cpp', 'audiocpp_server.exe');
  const cfg = path.join(TTS_DIR, 'server.json');
  if (!fs.existsSync(cfg)) ensureTtsConfig();
  const tmp = path.join(TTS_DIR, 'temp');
  try { fs.mkdirSync(tmp, { recursive: true }); } catch { /* ignore */ }

  try {
    const child = spawn(exe, ['--config', cfg], {
      cwd: TTS_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, TEMP: tmp, TMP: tmp }
    });
    child.unref();
  } catch (e) {
    return { ok: false, error: `启动失败：${e.message}` };
  }

  // 模型加载 1~3 分钟，最多等 150 秒
  for (let i = 0; i < 75; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await tcpOpen(TTS_PORT)) return { ok: true, started: true };
  }
  return { ok: false, error: 'TTS 启动超时（模型加载可能失败，见 tts/temp 日志）' };
}

/** 暂停下载：中断当前请求，保留 .part 文件以便续传 */
export async function pauseTts() {
  if (!job.running) return { ok: true, paused: false, running: false };
  try {
    abortCtl?.abort();
  } catch { /* ignore */ }
  return { ok: true, paused: true };
}

export const ttsPaths = { APP_ROOT, PKG_ROOT, TTS_DIR, RUNTIME_DIR, MODEL_URL, MODEL_SIZE };
