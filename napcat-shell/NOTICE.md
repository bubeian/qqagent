# NapCat（napcat-shell/）

本目录是 **未经修改** 的 NapCat Shell 官方发行文件，随本仓库作为运行依赖一并分发。
本仓库不修改 NapCat 的任何文件：NapCat 的启动、隐藏窗口、独立 QQ 副本等逻辑
全部由本项目自己的 `qqagent-0.4/scripts/start-napcat.bat` 完成（直接调用
`NapCatWinBootMain.exe`，与官方 `launcher.bat` 的调用方式一致）。

## 来源与版权

- 项目：NapCat
- 仓库：https://github.com/NapNeko/NapCatQQ
- 版权：Copyright © 2024 Mlikiowa
- 分发版本：v4.18.41（NapCat.Shell.zip）

## 许可

本目录内容受 **Limited Redistribution License for NapCat** 约束，
完整全文见同目录下的 [LICENSE](./LICENSE)。要点：

1. 再分发必须附带完整许可全文，并注明来源与版权信息（本文件即为此用途）。
2. 允许为再分发做少量修改，但 **修改后的代码不得公开发布** ——
   因此本仓库保持 NapCat 原样，未做任何改动。
3. **仅限非商业用途**。
4. 本软件按"原样"提供，作者不承担任何担保或责任。

## 本项目如何在不改 NapCat 的前提下实现定制

`qqagent-0.4/scripts/start-napcat.bat` 复刻了官方 `launcher.bat` 的行为：

```bat
set "NAPCAT_PATCH_PACKAGE=%cd%\qqnt.json"
set "NAPCAT_LOAD_PATH=%cd%\loadNapCat.js"
set "NAPCAT_INJECT_PATH=%cd%\NapCatWinBootHook.dll"
set "NAPCAT_LAUNCHER_PATH=%cd%\NapCatWinBootMain.exe"
set "NAPCAT_MAIN_PATH=%cd%\napcat.mjs"
"%NAPCAT_LAUNCHER_PATH%" "<QQ 路径>" "%NAPCAT_INJECT_PATH%"
```

差异仅在于：QQ 路径可以由本项目选择（`qq-nt\QQ.exe` 优先，用于与用户自己的 QQ 隔离），
并且由计划任务以最高权限静默调用。NapCat 本体未改动。
