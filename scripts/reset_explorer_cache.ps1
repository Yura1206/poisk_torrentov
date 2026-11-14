Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$iconDb = Join-Path $env:LOCALAPPDATA "IconCache.db"
if (Test-Path $iconDb) {
    Remove-Item $iconDb -Force -ErrorAction SilentlyContinue
}
$explorerDb = Join-Path $env:LOCALAPPDATA "Microsoft\Windows\Explorer"
if (Test-Path $explorerDb) {
    Get-ChildItem $explorerDb -Filter "iconcache*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem $explorerDb -Filter "thumbcache*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500
Start-Process explorer.exe
Write-Output "Explorer restarted and icon cache cleared successfully."
