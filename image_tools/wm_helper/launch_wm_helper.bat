@echo off
setlocal
cd /d "%~dp0"

if not exist "wm_helper.py" (
  echo wm_helper.py was not found in:
  echo %~dp0
  pause
  exit /b 1
)

set "EXIT_CODE=0"

where py >nul 2>&1
if not errorlevel 1 (
  py -3 "wm_helper.py"
  set "EXIT_CODE=%ERRORLEVEL%"
  goto :after_run
)

where python >nul 2>&1
if not errorlevel 1 (
  python "wm_helper.py"
  set "EXIT_CODE=%ERRORLEVEL%"
  goto :after_run
)

echo Python was not found on PATH.
echo Install Python 3 (and Pillow), or use the Python launcher 'py'.
pause
exit /b 1

:after_run
if not "%EXIT_CODE%"=="0" (
  echo.
  echo wm_helper exited with code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
