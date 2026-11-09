# QQ Agent 整合包（Electron 客户端 + NapCat + 本地语音）

基于 [QQ Agent](https://github.com/K0nd1us/QQ-agent)（MIT）二次整合的 Windows 桌面机器人：

- **本地客户端界面**：Electron 桌面窗口 + 托盘常驻，不再是纯网页控制台
- **内置 NapCat 协议端**：`napcat-shell/`，由客户端托管启动，首次启动自动创建计划任务（最高权限，之后零 UAC）
- **本地语音合成**：IndexTTS2.5（GGUF）+ audio.cpp，首次点「下载语音模型」即可自动下载部署
- **QQ 隔离**：「下载额外功能」向导可复制一份独立 QQ 到 `qq-nt/`，机器人与你平时用的 QQ 可同时在线

## 目录结构

```
qqagent-gh/
├─ 启动QQAgent.bat            本地客户端（推荐）
├─ 启动QQAgent-网页模式.bat    仅后端 + 浏览器（调试用）
├─ 启动TTS服务.bat             手动启动语音服务（一般不用，客户端会自动拉起）
├─ 关闭后台服务.bat            一键停止 NapCat / TTS（需一次 UAC）
├─ qqagent-0.4/                QQ Agent 主程序（源码）
│  ├─ electron/                主进程（窗口 / 托盘 / 自启 / 退出清理）
│  ├─ src/                     后端（HTTP / 路由 / NapCat 桥接 / TTS 部署）
│  ├─ ui/                      前端（控制台界面）
│  ├─ skills/                  技能（含 voice-say 语音技能）
│  └─ scripts/                 NapCat 计划任务与启动脚本
├─ napcat-shell/               NapCat Shell v4.18.41（未修改，见其 NOTICE）
└─ tts-runtime/                audio.cpp 运行体（Apache-2.0，见其 NOTICE）
```

## 环境要求

- Windows 10 / 11 x64
- 已安装 **腾讯 QQ**（本仓库不包含 QQ 本体）
- Node.js ≥ 20（仅首次安装依赖时需要）

## 快速开始

```bat
:: 1) 安装依赖（只需一次，约 200 MB）
cd qqagent-0.4
npm install

:: 2) 回到根目录，双击启动
启动QQAgent.bat
```

首次启动流程：

1. 弹一次 UAC → 创建两个计划任务（`QQAgent-NapCat` / `QQAgent-StopAll`），之后启动与关闭都不再弹
2. 弹「下载额外功能」向导
   - 第一页：是否下载独立 QQ（复制系统 QQ 到 `qq-nt/`，实现与个人 QQ 隔离）
   - 第二页：是否下载语音模型（从 ModelScope 下载 IndexTTS2.5 GGUF 约 3.3 GB，带断点续传）
3. 左上角头像 → 扫码登录 QQ
4. 登录后自动配置 OneBot（HTTP 3000 / WS 3001），客户端状态显示「在线」

## 改动概览（相对上游 QQ Agent 0.4）

- 顶部：账号头像移到左上角，右侧两行显示「QQ 账号 / 在线·离线」
- 头像点击：二级面板（切换账号 / 退出登录，扫码登录带二维码失效刷新）
- 顶栏：「模型：xxx」可点击直达设置 → 模型 API
- 导航：Skill 市场 / 插件市场 / 人设广场合并为「能力广场」；新增「下载额外功能」向导
- 设置：「聊天白名单」并入「聊天设置」，位于「信息发送配置」与「活跃设置」之间
- 启动：客户端托管 NapCat（计划任务 + 隐藏窗口），退出时一并关闭 NapCat 与 TTS
- 语音：迁移 `voice-say` 技能，与本地 TTS 服务配对（`/v1/audio/speech`）

## 端口

| 服务 | 端口 |
| --- | --- |
| QQ Agent 控制台 | 3210（占用则顺延） |
| NapCat WebUI | 6099 |
| OneBot HTTP / WS | 3000 / 3001 |
| 本地 TTS | 8080 |

## 许可与免责

- 本项目修改部分：MIT（见 [LICENSE](./LICENSE)）
- QQ Agent 上游：MIT，© 2026 Kondius
- NapCat：Limited Redistribution License，© 2024 Mlikiowa
  **仅限非商业用途**；`napcat-shell/` 为未修改的官方发行文件，详见其 [NOTICE](./napcat-shell/NOTICE.md)
- audio.cpp：Apache-2.0，© ShugoAI LLC，详见其 [NOTICE](./tts-runtime/NOTICE.md)
- **腾讯 QQ 本体不在本仓库内**，需自行安装；使用自动化客户端可能违反 QQ 用户协议，风险自负
- 本项目仅供学习与个人使用，请勿用于商业用途或大规模自动化场景
