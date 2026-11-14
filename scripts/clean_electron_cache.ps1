$appData = [System.IO.Path]::Combine($env:APPDATA, 'torrent-navigator')
$dirs = @('Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache')

foreach ($d in $dirs) {
    $target = [System.IO.Path]::Combine($appData, $d)
    if (Test-Path $target) {
        Remove-Item -Path $target -Recurse -Force -ErrorAction SilentlyContinue
        Write-Output "Removed: $d"
    }
}
Write-Output "Electron cache cleanup done."
