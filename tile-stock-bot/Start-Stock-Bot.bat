@echo off
title Tile Stock Bot - keep this window open
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org and then double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo.
  echo Your Node.js is too old. Install the LTS version from https://nodejs.org and try again.
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing for the first time, please wait...
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed. Check the internet connection and try again.
    pause
    exit /b 1
  )
)

if not exist .env (
  copy .env.example .env >nul
  echo.
  echo Notepad will open. Change the ADMIN_PASSWORD line to your own password, then Save and close Notepad.
  notepad .env
)
findstr /c:"change-me-to-a-long-password" .env >nul
if not errorlevel 1 (
  echo.
  echo Please set your own ADMIN_PASSWORD in Notepad, then Save and close Notepad.
  notepad .env
)

echo.
echo Starting the stock bot...
echo Admin page: http://localhost:3000
echo KEEP THIS WINDOW OPEN. Closing it stops the bot.
echo.
start "" cmd /c "timeout /t 5 >nul & start http://localhost:3000"
call npm start
echo.
echo The bot has stopped.
pause
