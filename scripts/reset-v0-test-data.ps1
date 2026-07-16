param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [Parameter(Mandatory = $true)][switch]$ConfirmReset,
  [switch]$DeviceCode,
  [string]$BackupDirectory = (Join-Path ([IO.Path]::GetTempPath()) 'betinhos-fluxo-caixa-backups')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $ConfirmReset) { throw 'Use -ConfirmReset para autorizar a exclusão dos dados de teste.' }

function Token($url, [switch]$UseDeviceCode) {
  if (-not (Get-Module -ListAvailable MSAL.PS)) { throw 'MSAL.PS não encontrado.' }
  Import-Module MSAL.PS -ErrorAction Stop
  $client = New-MsalClientApplication -ClientId '51f81489-12ee-4a9e-aaae-a2591f45987d' -TenantId 'organizations' -RedirectUri ([Uri]'http://localhost')
  Enable-MsalTokenCacheOnDisk -PublicClientApplication $client | Out-Null
  try { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Silent).AccessToken }
  catch {
    if ($UseDeviceCode) { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -DeviceCode).AccessToken }
    return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Interactive).AccessToken
  }
}
function Request($method, $path) {
  return Invoke-RestMethod -Method $method -Uri "$base/$path" -Headers $headers
}

$url = $EnvironmentUrl.TrimEnd('/')
$base = "$url/api/data/v9.2"
$headers = @{Authorization="Bearer $(Token $url $DeviceCode)";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0'}
$targets = @(
  @{Set='cr40f_fluxocaixalancamentos';Id='cr40f_fluxocaixalancamentoid'},
  @{Set='cr40f_fluxocaixaimportacaos';Id='cr40f_fluxocaixaimportacaoid'},
  @{Set='cr40f_fluxocaixaregras';Id='cr40f_fluxocaixaregraid'},
  @{Set='cr40f_fluxocaixaeventos';Id='cr40f_fluxocaixaeventoid'},
  @{Set='cr40f_fluxocaixarecorrencias';Id='cr40f_fluxocaixarecorrenciaid'},
  @{Set='cr40f_fluxocaixaferiados';Id='cr40f_fluxocaixaferiadoid'},
  @{Set='cr40f_fluxocaixaconfiguracaos';Id='cr40f_fluxocaixaconfiguracaoid'},
  @{Set='cr40f_fluxocaixacontrapartes';Id='cr40f_fluxocaixacontraparteid'},
  @{Set='cr40f_fluxocaixacategorias';Id='cr40f_fluxocaixacategoriaid'},
  @{Set='cr40f_fluxocaixacontas';Id='cr40f_fluxocaixacontaid'}
)
$backup = @{}
foreach ($target in $targets) {
  $backup[$target.Set] = @((Request 'GET' "$($target.Set)?`$top=5000").value)
}
New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
$backupPath = Join-Path $BackupDirectory "fluxo-caixa-v0-reset-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')).json"
@{environment=$url;createdAt=[DateTime]::UtcNow.ToString('o');tables=$backup} |
  ConvertTo-Json -Depth 100 |
  Set-Content -LiteralPath $backupPath -Encoding UTF8
Write-Host "[reset-v0] backup: $backupPath"

foreach ($target in $targets) {
  foreach ($row in @($backup[$target.Set])) {
    $id = [string]$row.($target.Id)
    if ($id) { Request 'DELETE' "$($target.Set)($id)" | Out-Null }
  }
  Write-Host "[reset-v0] $($target.Set): $(@($backup[$target.Set]).Count) removidos"
}
Write-Host '[reset-v0] dados de teste removidos. Tabelas e connection references foram preservadas.'
