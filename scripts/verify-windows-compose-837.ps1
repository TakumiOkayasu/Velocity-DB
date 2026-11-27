# Windows Compose の非管理者実行とホスト出力を検証する。
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

Write-Host '::group::Compose image build'
docker @compose build $service
Write-Host '::endgroup::'

New-Item -ItemType Directory -Path build-output | Out-Null
Write-Host '::group::Non-admin identity'
$identity = docker @compose run --rm --no-deps $service whoami
Write-Host $identity
if ($identity -notmatch '(?i)(^|\\)ContainerUser\s*$') {
    throw "Expected ContainerUser; got $identity."
}
Write-Host '::endgroup::'

Write-Host '::group::Normal application build'
docker @compose run --rm --no-deps $service
$artifact = Get-Item -LiteralPath 'build-output\VelocityDB.exe'
if ($artifact.Length -eq 0) { throw 'VelocityDB.exe was empty.' }
Write-Host ('Fresh build-output\VelocityDB.exe, {0} bytes.' -f $artifact.Length)
Write-Host '::endgroup::'
