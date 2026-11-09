' Hidden launcher for the QQAgent-StopAll scheduled task.
' Runs scripts\stop-all.bat with no console window.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "cmd /c """ & base & "\stop-all.bat"""
sh.Run cmd, 0, False
