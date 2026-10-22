@echo off
rem Modular Stream Overlay - OBS connector. Double-click to start; keep this window open while streaming.
cd /d "%~dp0"
if not exist "%APPDATA%\modular-stream-overlay\obs-connector.json" node obs-connector.mjs setup
node obs-connector.mjs
pause
