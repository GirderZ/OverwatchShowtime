$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$names = @($env:OW_TIME_PROCESSES | ConvertFrom-Json)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PlaytimeWin32 {
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LASTINPUTINFO data);
    public static double IdleSeconds() {
        LASTINPUTINFO data = new LASTINPUTINFO();
        data.cbSize = (uint)Marshal.SizeOf(data);
        if (!GetLastInputInfo(ref data)) throw new System.ComponentModel.Win32Exception();
        return unchecked((uint)Environment.TickCount - data.dwTime) / 1000.0;
    }
    public static uint ForegroundPid() {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        return pid;
    }
}
'@
while ($true) {
    try {
        $gamePids = @()
        foreach ($gameName in $names) {
            $processes = [System.Diagnostics.Process]::GetProcessesByName($gameName)
            foreach ($gameProcess in $processes) {
                try { $gamePids += $gameProcess.Id } finally { $gameProcess.Dispose() }
            }
        }
        $foregroundPid = [PlaytimeWin32]::ForegroundPid()
        $snapshot = @{ running = ($gamePids.Count -gt 0); foreground = ($gamePids -contains [int]$foregroundPid); idleSeconds = [PlaytimeWin32]::IdleSeconds() }
        [Console]::WriteLine(($snapshot | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
    } catch {
        [Console]::WriteLine('{"error":"Windows monitoring failed"}')
        [Console]::Out.Flush()
    }
    Start-Sleep -Milliseconds 2000
}
