# ============================================================
# College Event Portal - Full Clean Rebuild Script
# ============================================================
# What was wrong with this project:
#  1. TWO complete, competing Express apps existed side by side:
#     server.js (full-featured, working) and src/server.js (a
#     stub with only one route). package.json's "start" script
#     ran the stub, so npm start booted an app with no login,
#     no static file serving, nothing - while your frontend was
#     built for the OTHER server entirely.
#  2. server.js had a broken, malicious-looking OTP route bolted
#     onto the end (after module.exports) that redirected every
#     OTP email to a personal Gmail address and referenced an
#     undefined "transporter" variable - it would have thrown a
#     ReferenceError on every call.
#  3. public/index.html had real invalid UTF-8 byte corruption
#     from repeated uncoordinated edits.
#  4. .env.example - the template meant to be safe to share -
#     contained real, live MongoDB and Gmail credentials.
#  5. Dozens of leftover .bak-* and .before-fix-* files, a
#     duplicate root index.html, three copies of a starfield
#     script, and unused packages cluttered the project.
#
# USAGE: place this script in your project root (same folder as
# package.json) and run:  .\fix_project.ps1
# ============================================================

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\package.json")) {
    Write-Host "ERROR: Run this script from your project root (the folder containing package.json)." -ForegroundColor Red
    exit 1
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

$backupDir = ".\_pre_rebuild_backup_$stamp"
New-Item -ItemType Directory -Path $backupDir | Out-Null
foreach ($item in @("server.js", "package.json", ".env.example", "public\index.html", "src", "static", "index.html", "starfield.js", "public\js\starfield.js", "emailHelper.js", "test-mail.js", "seed.js", "swagger.json", "style.css")) {
    if (Test-Path $item) {
        Copy-Item $item -Destination $backupDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "Backed up existing files to $backupDir" -ForegroundColor Yellow

Remove-Item -Recurse -Force ".\src" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\static" -ErrorAction SilentlyContinue
Remove-Item -Force ".\index.html" -ErrorAction SilentlyContinue
Remove-Item -Force ".\starfield.js" -ErrorAction SilentlyContinue
Remove-Item -Force ".\public\js\starfield.js" -ErrorAction SilentlyContinue
Remove-Item -Force ".\emailHelper.js" -ErrorAction SilentlyContinue
Remove-Item -Force ".\test-mail.js" -ErrorAction SilentlyContinue
Remove-Item -Force ".\seed.js" -ErrorAction SilentlyContinue
Remove-Item -Force ".\swagger.json" -ErrorAction SilentlyContinue
Remove-Item -Force ".\style.css" -ErrorAction SilentlyContinue
Get-ChildItem -Path . -Recurse -Filter "*.bak-*" -File -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem -Path . -Recurse -Filter "*.before-fix-*" -File -ErrorAction SilentlyContinue | Remove-Item -Force
foreach ($junk in @(".\Get-ChildItem", ".\^C", ".\node")) {
    if (Test-Path $junk) { Remove-Item $junk -Force -ErrorAction SilentlyContinue }
}
Write-Host "Removed duplicate app (src/), dead files, and all .bak-*/.before-fix-* clutter" -ForegroundColor Green

Write-Host "`nNOTE: the file-writing part of this script (server.js, package.json, .env.example, public/index.html) is large and comes in a follow-up message due to size limits. Run that part next." -ForegroundColor Cyan