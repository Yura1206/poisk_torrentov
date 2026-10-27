@echo off
chcp 65001 >nul
title Сборка портабл-версии Поисковика торрентов

echo ========================================================
echo    Сборка портабл-версии: Поисковик торрентов
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/3] Проверка окружения Node.js...
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Node.js и npm не найдены в системе или не добавлены в PATH.
    echo Установите Node.js с официального сайта: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Закрываем запущенное приложение если открыто
taskkill /F /IM "Поисковик торрентов.exe" >nul 2>&1

echo [2/3] Компиляция проекта и упаковка в Portable .exe...
echo Это может занять от 30 секунд до 2 минут.
echo.

call npm.cmd run dist:portable
if errorlevel 1 (
    echo.
    echo [ОШИБКА] Сборка завершилась с ошибкой. Проверьте сообщения выше.
    echo.
    pause
    exit /b 1
)

if exist "%~dp0release\builder-debug.yml" del /f /q "%~dp0release\builder-debug.yml" >nul 2>&1

echo.
echo ========================================================
echo [3/3] Сборка успешно завершена!
echo Файл: "%~dp0release\Поисковик торрентов.exe"
echo ========================================================
echo.

if exist "%~dp0release\Поисковик торрентов.exe" (
    echo Открываем папку с готовым файлом...
    explorer.exe /select,"%~dp0release\Поисковик торрентов.exe"
)

echo.
pause
