param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [string]$CsvPath = '',
  [switch]$PruneMissing,
  [switch]$DeviceCode
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ([string]::IsNullOrWhiteSpace($CsvPath)) {
  $CsvPath = Join-Path $PSScriptRoot '..\data\categorias-dre.csv'
}

function Token($url, [switch]$UseDeviceCode) {
  if (-not (Get-Module -ListAvailable MSAL.PS)) { throw 'MSAL.PS not found.' }
  Import-Module MSAL.PS -ErrorAction Stop
  $client = New-MsalClientApplication -ClientId '51f81489-12ee-4a9e-aaae-a2591f45987d' -TenantId 'organizations' -RedirectUri ([Uri]'http://localhost')
  Enable-MsalTokenCacheOnDisk -PublicClientApplication $client | Out-Null
  try { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Silent).AccessToken }
  catch {
    if ($UseDeviceCode) { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -DeviceCode).AccessToken }
    return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Interactive).AccessToken
  }
}
function Normalize($value) {
  $formD = ([string]$value).Normalize([Text.NormalizationForm]::FormD)
  $plain = ($formD.ToCharArray() | Where-Object {
    [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [Globalization.UnicodeCategory]::NonSpacingMark
  }) -join ''
  return (($plain -replace '\s+', ' ').Trim().ToUpperInvariant())
}

$resolvedCsv = Resolve-Path $CsvPath
$rows = @(Import-Csv -LiteralPath $resolvedCsv -Encoding UTF8)
if (-not $rows.Count) { throw 'Category CSV is empty.' }
$allowed = @('inflow','outflow','transfer')
$seen = @{}
foreach ($row in $rows) {
  $row.Group = ([string]$row.Group).Trim()
  $row.Category = ([string]$row.Category).Trim()
  $row.Nature = ([string]$row.Nature).Trim().ToLowerInvariant()
  if (-not $row.Group -or -not $row.Category -or $allowed -notcontains $row.Nature) {
    throw "Invalid category row: $($row | ConvertTo-Json -Compress)"
  }
  $key = "$(Normalize $row.Group)|$(Normalize $row.Category)"
  if ($seen.ContainsKey($key)) { throw "Duplicate category key: $key" }
  $seen[$key] = $true
}

$url = $EnvironmentUrl.TrimEnd('/')
$base = "$url/api/data/v9.2"
$headers = @{
  Authorization = "Bearer $(Token $url $DeviceCode)"
  Accept = 'application/json'
  'OData-MaxVersion' = '4.0'
  'OData-Version' = '4.0'
}
$existing = @((Invoke-RestMethod -Method Get -Uri "$base/cr40f_fluxocaixacategorias?`$select=cr40f_fluxocaixacategoriaid,cr40f_name,cr40f_grupo" -Headers $headers).value)
$existingByKey = @{}
foreach ($item in $existing) {
  $existingByKey["$(Normalize $item.cr40f_grupo)|$(Normalize $item.cr40f_name)"] = [string]$item.cr40f_fluxocaixacategoriaid
}

$batch = "batch_$([guid]::NewGuid().ToString('N'))"
$change = "changeset_$([guid]::NewGuid().ToString('N'))"
$lines = @("--$batch","Content-Type: multipart/mixed; boundary=$change",'')
$contentId = 1
$created = 0
$updated = 0
$deleted = 0
foreach ($row in $rows) {
  $key = "$(Normalize $row.Group)|$(Normalize $row.Category)"
  $id = $existingByKey[$key]
  if ($id) {
    $method = 'PATCH'
    $target = "cr40f_fluxocaixacategorias($id)"
    $updated++
  } else {
    $method = 'POST'
    $target = 'cr40f_fluxocaixacategorias'
    $created++
  }
  $body = @{cr40f_name=$row.Category;cr40f_grupo=$row.Group;cr40f_natureza=$row.Nature} | ConvertTo-Json -Compress
  $lines += @(
    "--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary',"Content-ID: $contentId",'',
    "$method /api/data/v9.2/$target HTTP/1.1",'Content-Type: application/json; charset=utf-8','',$body,''
  )
  $contentId++
}
$sourceGroups = @{}
foreach ($row in $rows) { $sourceGroups[(Normalize $row.Group)] = $true }
if ($PruneMissing) {
  foreach ($item in $existing) {
    $key = "$(Normalize $item.cr40f_grupo)|$(Normalize $item.cr40f_name)"
    if ($sourceGroups.ContainsKey((Normalize $item.cr40f_grupo)) -and -not $seen.ContainsKey($key)) {
      $lines += @(
        "--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary',"Content-ID: $contentId",'',
        "DELETE /api/data/v9.2/cr40f_fluxocaixacategorias($($item.cr40f_fluxocaixacategoriaid)) HTTP/1.1",'If-Match: *',''
      )
      $contentId++
      $deleted++
    }
  }
}
$auditBody = @{
  cr40f_name = 'Importacao de categorias da DRE'
  cr40f_acao = 'Importacao de categorias'
  cr40f_detalhe = "$($rows.Count) categorias validadas e gravadas atomicamente."
  cr40f_data = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
} | ConvertTo-Json -Compress
$lines += @(
  "--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary',"Content-ID: $contentId",'',
  'POST /api/data/v9.2/cr40f_fluxocaixaeventos HTTP/1.1','Content-Type: application/json; charset=utf-8','',$auditBody,''
)
$lines += @("--$change--","--$batch--",'')
$response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$base/`$batch" -Headers $headers -ContentType "multipart/mixed; boundary=$batch" -Body ([Text.Encoding]::UTF8.GetBytes(($lines -join "`r`n")))
$text = [string]$response.Content
if ($response.StatusCode -ne 200 -or $text -match 'HTTP/1.1 [45]\d\d') { throw "Atomic category import rejected: $text" }

$live = @((Invoke-RestMethod -Method Get -Uri "$base/cr40f_fluxocaixacategorias?`$select=cr40f_name,cr40f_grupo,cr40f_natureza&`$top=5000" -Headers $headers).value)
if ($PruneMissing -and $live.Count -ne $rows.Count) { throw "Live category count mismatch. source=$($rows.Count) live=$($live.Count)" }
$liveByKey = @{}
foreach ($item in $live) {
  $liveByKey["$(Normalize $item.cr40f_grupo)|$(Normalize $item.cr40f_name)"] = $item
}
foreach ($row in $rows) {
  $key = "$(Normalize $row.Group)|$(Normalize $row.Category)"
  $item = $liveByKey[$key]
  if (-not $item -or $item.cr40f_grupo -ne $row.Group -or $item.cr40f_name -ne $row.Category -or $item.cr40f_natureza -ne $row.Nature) {
    throw "Live category mismatch: $key"
  }
}
Write-Host "[import-dre] source=$($rows.Count) created=$created updated=$updated deleted=$deleted live=$($live.Count) exact-match=true"
