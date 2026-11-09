' Hidden launcher for the QQAgent-NapCat scheduled task.
' Runs scripts\start-napcat.bat with no console window.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "cmd /c """ & base & "\start-napcat.bat"""
sh.Run cmd, 0, False
