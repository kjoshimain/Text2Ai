@echo off
setlocal
set DIR=%~dp0
where java >nul 2>nul
if errorlevel 1 (
  echo Android SDK / Java not found. Please install the Android SDK and Java 17+.
  exit /b 1
)

if exist "%DIR%\.gradle\wrapper\dists" (
  echo Gradle wrapper is available.
)

call "%DIR%\gradlew" 2>nul || echo Android SDK is not installed or gradle wrapper is not configured.
