# One-off verification of the Windows Compose entry point at issue #841.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$compose = @('compose', '-f', 'docker/vcpkg-build/compose.yaml')
$service = 'vcpkg-build'

Write-Host '::group::Runner and Docker'
$os = docker info --format '{{.OSType}}'
if ($os.Trim() -ne 'windows') { throw "Expected a Windows Docker daemon; got $os." }
docker compose version
Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free | Format-Table
Write-Host '::endgroup::'

Write-Host '::group::WORKDIR preflight'
$smokeDir = New-Item -ItemType Directory -Path (Join-Path $env:RUNNER_TEMP 'velocity-workdir-smoke')
$source = Get-Content -LiteralPath 'docker/vcpkg-build/Dockerfile'
$instructions = @($source | Where-Object { $_ -match '^(FROM|WORKDIR)\s' })
if ($instructions.Count -ne 2) { throw 'Expected one FROM and one WORKDIR.' }
$instructions += 'RUN if /I not "%CD%"=="C:\build-work\src" exit /b 1'
$instructions | Set-Content -LiteralPath (Join-Path $smokeDir.FullName 'Dockerfile') -Encoding ascii
docker build --isolation=process -t velocity-workdir-smoke $smokeDir.FullName
Write-Host '::endgroup::'

Write-Host '::group::Compose image build'
docker @compose build $service
Write-Host '::endgroup::'

New-Item -ItemType Directory -Path build-output | Out-Null
Write-Host '::group::Non-admin identity and bind mount'
$identity = docker @compose run --rm --no-deps $service whoami
Write-Host $identity
if ($identity -notmatch '(?i)(^|\\)ContainerUser\s*$') {
    throw "Expected ContainerUser; got $identity."
}
$probe = 'windows-compose-user-probe'
docker @compose run --rm --no-deps $service cmd.exe /d /c 'echo windows-compose-user-probe>C:\output\compose-user-probe.txt'
$probePath = 'build-output\compose-user-probe.txt'
if ((Get-Content -LiteralPath $probePath -Raw).Trim() -ne $probe) {
    throw 'The expected bind-mount probe did not reach the host.'
}
Remove-Item -LiteralPath $probePath
Write-Host '::endgroup::'

Write-Host '::group::Normal application build'
docker @compose run --rm --no-deps $service
$artifact = Get-Item -LiteralPath 'build-output\VelocityDB.exe'
if ($artifact.Length -eq 0) { throw 'VelocityDB.exe was empty.' }
Write-Host ('Fresh build-output\VelocityDB.exe, {0} bytes.' -f $artifact.Length)
Write-Host '::endgroup::'
