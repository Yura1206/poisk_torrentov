$code = @"
using System;
using System.Runtime.InteropServices;

public class WinAPI {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@

Add-Type -TypeDefinition $code
[WinAPI]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output "Windows shell notified of icon changes."
