using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

static class Program {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);

    [STAThread]
    static void Main(string[] args) {
        try {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string targetExe = Path.Combine(baseDir, "app", "Поисковик торрентов.exe");
            
            if (!File.Exists(targetExe)) {
                MessageBox(IntPtr.Zero, "Не найден исполняемый файл приложения:\n" + targetExe, "Поисковик торрентов", 0x10);
                return;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo {
                FileName = targetExe,
                WorkingDirectory = Path.Combine(baseDir, "app"),
                Arguments = string.Join(" ", args),
                UseShellExecute = false,
                CreateNoWindow = true
            };

            Process.Start(startInfo);
        } catch (Exception ex) {
            MessageBox(IntPtr.Zero, "Ошибка при запуске программы:\n" + ex.Message, "Поисковик торрентов", 0x10);
        }
    }
}
