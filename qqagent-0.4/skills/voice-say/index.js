// voice-say —— 用 IndexTTS2.5（audio.cpp 服务）把一句话念成语音条发到当前会话。
//
// 为什么是「技能」（skills/，LLM 型）而不是插件：
//   「要不要用语音说」没有能写死的规则，得模型自己看语境判断。
//
// 依赖：D:\qqagent\tts 里的 audio.cpp 服务（默认 127.0.0.1:8080），
//       接口是 OpenAI 风格 POST /v1/audio/speech，克隆用 voice_ref + reference_text。
// 数据：生成的 wav 落在 DATA_DIR/voice-say/ 下，可随手删。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../../src/config.js';

// 应用根目录（skills/voice-say/ 往上两级），用于解析相对路径的参考音频
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
import { getSkillConfig } from '../../src/skills/config.js';

const SKILL_ID = 'voice-say';

const DEFAULTS = {
  enabled: true,
  apiUrl: 'http://127.0.0.1:8080/v1/audio/speech',
  model: 'indextts',
  voiceRef: '../tts/ref.wav',   // 相对应用根目录；懒人包里就是 <包根>/tts/ref.wav
  referenceText: '欢迎来到欢送仪式的场地，我的目的地就在前面不远的地方了。',
  language: 'zh',
  maxChars: 80,
  timeoutMs: 120000
};

const DIR = path.join(DATA_DIR, SKILL_ID);

let log = () => {};

function cfg() {
  return { ...DEFAULTS, ...(getSkillConfig(SKILL_ID, DEFAULTS) || {}) };
}

function ensureDir() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function cleanText(raw, max) {
  const s = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  return s.slice(0, max);
}

export function setup(api) {
  log = api?.log || (() => {});

  api.registerTool({
    id: 'say_voice',
    name: '用语音说一句话',
    description:
      '把一段文字用自己的音色念成 QQ 语音条发到当前会话。你可以自己判断什么时候用语音：短句、有情绪、撒娇/生气/安慰/晚安/念台词这类值得被听到的话可以用；解释、答疑、长内容、正经事务用文字。用户明确要求「用语音说/发条语音」时必须用；明确说「打字就行/别发语音」时不要用。生成很快（约 2~5 秒）。',
    category: 'media',
    icon: '🎙️',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要念出来的文字，一句自然的话，不要带动作描写、emoji、换行。'
        }
      },
      required: ['text']
    },
    async execute(ctx, args) {
      const c = cfg();
      if (c.enabled === false) {
        return { content: '错误：语音说话这个技能被关掉了。', isError: true };
      }

      const maxChars = Number(c.maxChars) > 0 ? Number(c.maxChars) : 80;
      const text = cleanText(args?.text, maxChars);
      if (!text) {
        return { content: '错误：没告诉我要念什么。', isError: true };
      }

      ensureDir();
      const file = path.join(DIR, `${Date.now()}.wav`);
      const timeoutMs = Number(c.timeoutMs) || 120000;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const started = Date.now();

      // 相对路径按应用根目录解析，便于整个包换机器/换盘符
      const voiceRef = c.voiceRef && !path.isAbsolute(c.voiceRef)
        ? path.resolve(APP_ROOT, c.voiceRef)
        : c.voiceRef;

      const payload = {
        model: c.model || 'indextts',
        input: text,
        voice_ref: voiceRef,
        reference_text: c.referenceText,
        language: c.language || 'zh',
        response_format: 'wav'
      };

      try {
        log(`开始合成：${text.slice(0, 30)}…`);
        const resp = await fetch(c.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          return {
            content: `错误：语音接口返回 ${resp.status}${body ? `（${body.slice(0, 160)}）` : ''}。检查 D:\\qqagent\\tts 的 TTS 服务是否在跑（启动TTS服务.bat）。`,
            isError: true
          };
        }

        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length < 1000) {
          return { content: '错误：语音接口返回的数据太小，可能生成失败。', isError: true };
        }
        fs.writeFileSync(file, buf);

        const secs = ((Date.now() - started) / 1000).toFixed(1);
        log(`合成完成 ${path.basename(file)}（${buf.length} 字节，${secs}s），开始发送`);

        try {
          await ctx.sender.sendMedia(ctx.chatKey, [{ type: 'record', data: { file } }], {
            label: `[语音] ${text.slice(0, 20)}`
          });
        } catch (e) {
          log(`语音条发送失败，改发文件：${e?.message || e}`);
          try {
            await ctx.sender.sendMedia(ctx.chatKey, [{ type: 'file', data: { file } }], {
              label: `[语音文件] ${text.slice(0, 20)}`
            });
          } catch (e2) {
            return { content: `错误：语音生成成功但发送失败（${e2?.message || e2}）。`, isError: true };
          }
        }

        return { content: `已用语音说出来（${secs} 秒，约 ${text.length} 字），不要再重复调用。` };
      } catch (e) {
        const msg = e?.name === 'AbortError' ? `超时（${Math.round(timeoutMs / 1000)} 秒）` : e?.message || String(e);
        return { content: `错误：语音生成失败（${msg}）。`, isError: true };
      } finally {
        clearTimeout(timer);
      }
    }
  });
}

export function dispose() {
  log = () => {};
}
