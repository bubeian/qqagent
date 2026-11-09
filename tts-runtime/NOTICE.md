# audio.cpp（tts-runtime/audio.cpp/）

本目录是 [audio.cpp](https://github.com/audio-cpp/audio.cpp) 的 Windows 预编译运行体，
用于本地运行 IndexTTS 语音合成。

## 来源与版权

- 版权：Copyright 2026 ShugoAI LLC
- 许可：**Apache License 2.0**（完整全文见 [audio.cpp/LICENSE](./audio.cpp/LICENSE)）
- 分发包：audio.cpp 0.9.4（Windows x64，Release）

## 说明

- 本仓库仅再分发了官方预编译二进制，未修改其代码。
- 遵循 Apache-2.0：保留 LICENSE 与版权声明；如有 NOTICE 文件一并保留。
- 语音模型（GGUF）**不在本仓库内**，由程序在用户首次点击「下载语音模型」时
  从 ModelScope 下载：
  https://www.modelscope.cn/models/HereIsMark/audio.cpp-gguf
  模型本身遵循其发布方（IndexTTS / ModelScope 仓库）的条款。
