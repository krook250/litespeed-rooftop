<#
.SYNOPSIS
    Verify, commit and deploy Rooftop Auto to both remotes.

.DESCRIPTION
    A push to main IS the deploy - there is no staging step between the two.
    So this script refuses to push a tree that does not build.

      origin -> GitHub -> Vercel auto-deploys the Next.js app
      live   -> Bluehost push-to-deploy for the static site in site\

    Both remotes get the same commit. The Bluehost hook only copies site\
    across, so pushing both every time is correct and costs nothing.

    Run this from Windows PowerShell, never from the Cowork cloud bridge -
    the bridge cannot unlink and strands .git\index.lock.

.PARAMETER Message
    Commit message. Prompted for if omitted.

.PARAMETER Yes
    Skip the "commit these files?" confirmation.

.PARAMETER SkipBuild
    Skip typecheck and build. For a site\-only or docs-only change where no
    TypeScript was touched. Use sparingly - it is the guard that has caught
    two broken deploys.

.PARAMETER NoPush
    Verify and commit, but do not push. Useful for staging up several commits.

.EXAMPLE
    .\deploy.ps1 -Message "meta pixel + signup conversion"

.EXAMPLE
    .\deploy.ps1 -Message "fix features page copy" -SkipBuild -Yes
#>

[CmdletBinding()]
param(
    [string] $Message,
    [switch] $Yes,
    [switch] $SkipBuild,
    [switch] $NoPush
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Write-Step {
    param([string] $Text)
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-Ok {
    param([string] $Text)
    Write-Host "    $Text" -ForegroundColor Green
}

function Stop-With {
    param([string] $Text)
    Write-Host ""
    Write-Host "FAILED: $Text" -ForegroundColor Red
    Write-Host "Nothing was pushed." -ForegroundColor Red
    exit 1
}

# Native commands do not throw on a non-zero exit, so every one of them is
# checked by hand. This is the whole reason the script exists.
function Invoke-Checked {
    param(
        [string] $Exe,
        [string[]] $Arguments,
        [string] $What
    )
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { Stop-With "$What (exit $LASTEXITCODE)" }
}

Write-Host ""
Write-Host "Rooftop Auto deploy" -ForegroundColor White
Write-Host "  repo: $PSScriptRoot"

# ---------------------------------------------------------------- sanity ----

Write-Step "Checking the repo"

if (-not (Test-Path (Join-Path $PSScriptRoot '.git'))) {
    Stop-With "No .git here. Run this from the repo root."
}

# A Cowork session running in the cloud leaves this behind and it blocks every
# later git command, including GitHub Desktop. Safe to clear: if a real git
# process held it, git itself would still be running.
$lock = Join-Path $PSScriptRoot '.git\index.lock'
if (Test-Path $lock) {
    Remove-Item $lock -Force
    Write-Ok "Cleared a stranded .git\index.lock"
}

$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0) { Stop-With "git rev-parse failed" }
if ($branch -ne 'main') {
    Stop-With "On branch '$branch'. Both remotes deploy from main - switch first."
}
Write-Ok "On main"

$status = (& git status --porcelain) -join "`n"
if ($LASTEXITCODE -ne 0) { Stop-With "git status failed" }

$hasChanges = -not [string]::IsNullOrWhiteSpace($status)
if (-not $hasChanges) {
    Write-Ok "Working tree clean - nothing to commit"
    if ($NoPush) { Write-Host ""; Write-Host "Done."; exit 0 }
}

# ----------------------------------------------------------------- verify ----

if ($SkipBuild) {
    Write-Step "Skipping typecheck and build (-SkipBuild)"
    Write-Host "    Only safe if this change touched no TypeScript." -ForegroundColor Yellow
}
else {
    # tsconfig.json sets incremental:true, so a plain `tsc --noEmit` will return
    # clean off a stale .tsbuildinfo without re-checking anything. That has
    # shipped a broken tree to Vercel before. --incremental false is mandatory.
    Write-Step "Typecheck (tsc --noEmit --incremental false)"
    Invoke-Checked npx @('tsc', '--noEmit', '--incremental', 'false') "Typecheck failed"
    Write-Ok "Types clean"

    # A clean tsc is still not a green build: next build runs its own pass over
    # route handlers and imports modules during page-data collection.
    Write-Step "Build (npm run build)"
    Invoke-Checked npm @('run', 'build') "Build failed"
    Write-Ok "Build green"
}

# ----------------------------------------------------------------- commit ----

if ($hasChanges) {
    Write-Step "Changes to commit"
    & git status --short
    Write-Host ""

    if (-not $Yes) {
        $answer = Read-Host "Commit all of the above? (y/N)"
        if ($answer -notmatch '^(y|yes)$') {
            Write-Host "Aborted. Nothing committed, nothing pushed." -ForegroundColor Yellow
            exit 0
        }
    }

    if ([string]::IsNullOrWhiteSpace($Message)) {
        $Message = Read-Host "Commit message"
        if ([string]::IsNullOrWhiteSpace($Message)) { Stop-With "Empty commit message" }
    }

    Invoke-Checked git @('add', '-A') "git add failed"
    Invoke-Checked git @('commit', '-m', $Message) "git commit failed"
    Write-Ok "Committed"
}

# ------------------------------------------------------------------- push ----

if ($NoPush) {
    Write-Step "Not pushing (-NoPush)"
    Write-Host ""
    Write-Host "Done. Push when ready:" -ForegroundColor White
    Write-Host "  git push origin main   # Vercel"
    Write-Host "  git push live main     # Bluehost"
    exit 0
}

Write-Step "Push to origin (GitHub -> Vercel builds the app)"
Invoke-Checked git @('push', 'origin', 'main') "Push to origin failed"
Write-Ok "origin/main updated"

# If this one fails on auth, the ssh alias is the first place to look:
# WinSCP connects as FTP user 'watson', the alias uses 'tikdmumy'.
Write-Step "Push to live (Bluehost takes site\)"
Invoke-Checked git @('push', 'live', 'main') "Push to live failed - check the bluehost-litespeed ssh alias"
Write-Ok "live/main updated"

# ------------------------------------------------------------------ done ----

$sha = (& git rev-parse --short HEAD).Trim()

Write-Host ""
Write-Host "Deployed $sha to both remotes." -ForegroundColor Green
Write-Host ""
Write-Host "  Vercel   builds now - watch it before you call it live"
Write-Host "  Bluehost is already serving rooftopauto.com"
Write-Host ""
Write-Host "Remember: a migration is a separate handoff. Run npm run db:migrate" -ForegroundColor Yellow
Write-Host "against production BEFORE the Vercel build finishes if this commit" -ForegroundColor Yellow
Write-Host "carries one." -ForegroundColor Yellow
Write-Host ""
