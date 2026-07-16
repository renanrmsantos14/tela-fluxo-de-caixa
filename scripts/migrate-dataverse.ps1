param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [switch]$DeviceCode,
  [switch]$WhatIf,
  [string]$BackupDirectory = (Join-Path ([IO.Path]::GetTempPath()) 'betinhos-fluxo-caixa-backups')
)
$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Clean-Text($text) {
  $value = [string]$text
  for ($attempt = 0; $attempt -lt 2 -and $value -match '\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\uFFFF]|\u00F0[\u0080-\uFFFF]'; $attempt++) {
    $value = [Text.Encoding]::UTF8.GetString([Text.Encoding]::GetEncoding(1252).GetBytes($value))
  }
  return $value
}
function Step($message) { Write-Host "[migrate-dataverse] $(Clean-Text $message)" }
function Token($url, [switch]$UseDeviceCode) {
  if (-not (Get-Module -ListAvailable MSAL.PS)) { throw 'MSAL.PS não encontrado. Instale: Install-Module MSAL.PS -Scope CurrentUser' }
  Import-Module MSAL.PS -ErrorAction Stop
  $client = New-MsalClientApplication -ClientId '51f81489-12ee-4a9e-aaae-a2591f45987d' -TenantId 'organizations' -RedirectUri ([Uri]'http://localhost')
  Enable-MsalTokenCacheOnDisk -PublicClientApplication $client | Out-Null
  try { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Silent).AccessToken }
  catch { if ($UseDeviceCode) { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -DeviceCode).AccessToken }; return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Interactive).AccessToken }
}
function Normalize($value) {
  if ([string]::IsNullOrWhiteSpace([string]$value)) { return '' }
  $formD = ([string]$value).Normalize([Text.NormalizationForm]::FormD)
  return (($formD.ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [Globalization.UnicodeCategory]::NonSpacingMark }) -join '').ToLowerInvariant().Trim()
}
function Hash($value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function Request($method, $path, $body = $null) {
  $arguments = @{Method=$method;Uri="$base/$path";Headers=$headers}
  if ($null -ne $body) { $arguments.ContentType='application/json; charset=utf-8'; $arguments.Body=($body | ConvertTo-Json -Depth 10) }
  return Invoke-RestMethod @arguments
}
function Navigation($schemaName) {
  $relationship = Request 'GET' "RelationshipDefinitions/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?`$select=SchemaName,ReferencingEntityNavigationPropertyName&`$filter=SchemaName eq '$schemaName'"
  if (@($relationship.value).Count -ne 1) { throw "Relacionamento não encontrado ou ambíguo: $schemaName" }
  return [string]$relationship.value[0].ReferencingEntityNavigationPropertyName
}
function Create-Row($setName, $body) {
  if ($WhatIf) { Step "would create $setName"; return [guid]::NewGuid().ToString() }
  $response = Invoke-RestMethod -Method Post -Uri "$base/$setName" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ($body | ConvertTo-Json -Depth 8)
  $idProperty = @($response.PSObject.Properties | Where-Object { $_.Name -match 'id$' -and $_.Value -match '^[0-9a-f-]{36}$' } | Select-Object -First 1)
  $id = if ($idProperty.Count) { [string]$idProperty[0].Value } else { '' }
  if (-not $id) { throw "Dataverse não retornou ID ao criar $setName" }
  return $id
}
function Patch-Row($setName, $id, $body) {
  if ($WhatIf) { Step "would patch $setName($id)"; return }
  Invoke-RestMethod -Method Patch -Uri "$base/$setName($id)" -Headers ($headers + @{'If-Match'='*'}) -ContentType 'application/json; charset=utf-8' -Body ($body | ConvertTo-Json -Depth 8) | Out-Null
}

$url = $EnvironmentUrl.TrimEnd('/')
$base = "$url/api/data/v9.2"
$token = Token $url $DeviceCode
$headers = @{Authorization="Bearer $token";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0';Prefer='return=representation'}

$navAccountEntry = Navigation 'cr40f_FluxoConta_Lancamentos'
$navCategoryEntry = Navigation 'cr40f_FluxoCategoria_Lancamentos'
$navImportEntry = Navigation 'cr40f_FluxoImportacao_Lancamentos'
$navAccountImport = Navigation 'cr40f_FluxoConta_Importacoes'

$accounts = @((Request 'GET' 'cr40f_fluxocaixacontas?$select=cr40f_fluxocaixacontaid,cr40f_name,cr40f_banco,cr40f_identificador').value)
$categories = @((Request 'GET' 'cr40f_fluxocaixacategorias?$select=cr40f_fluxocaixacategoriaid,cr40f_name,cr40f_grupo,cr40f_natureza').value)
$imports = @((Request 'GET' 'cr40f_fluxocaixaimportacaos?$select=cr40f_fluxocaixaimportacaoid,cr40f_conta,_cr40f_contaref_value').value)
$entries = @((Request 'GET' 'cr40f_fluxocaixalancamentos?$select=cr40f_fluxocaixalancamentoid,cr40f_name,cr40f_data,cr40f_valor,cr40f_conta,cr40f_categoria,cr40f_grupo,cr40f_natureza,cr40f_status,cr40f_fitid,cr40f_chavetransacao,cr40f_importacaoid,_cr40f_contaref_value,_cr40f_categoriaref_value,_cr40f_importacaoref_value').value)

New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
$backupPath = Join-Path $BackupDirectory "fluxo-caixa-pre-migracao-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')).json"
@{environment=$url;createdAt=[DateTime]::UtcNow.ToString('o');accounts=$accounts;categories=$categories;imports=$imports;entries=$entries} |
  ConvertTo-Json -Depth 20 |
  Set-Content -LiteralPath $backupPath -Encoding UTF8
Step "backup somente leitura: $backupPath"

$accountByName = @{}
foreach ($account in $accounts) { $accountByName[(Normalize $account.cr40f_name)] = [string]$account.cr40f_fluxocaixacontaid }
$legacyAccounts = @($entries.cr40f_conta + $imports.cr40f_conta | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Sort-Object -Unique)
foreach ($legacyName in $legacyAccounts) {
  $normalized = Normalize $legacyName
  if ($accountByName.ContainsKey($normalized)) { continue }
  if ($legacyAccounts.Count -gt 1) { throw "Conta mestre ausente para '$legacyName'. Migração interrompida para evitar associação ambígua." }
  $bankId = ''; $accountId = ''
  $sourceImport = $imports | Where-Object { (Normalize $_.cr40f_conta) -eq $normalized } | Select-Object -First 1
  if ($sourceImport -and -not $WhatIf) {
    try {
      $temp = Join-Path ([IO.Path]::GetTempPath()) "fluxo-$($sourceImport.cr40f_fluxocaixaimportacaoid).ofx"
      Invoke-WebRequest -UseBasicParsing -Uri "$base/cr40f_fluxocaixaimportacaos($($sourceImport.cr40f_fluxocaixaimportacaoid))/cr40f_arquivoofx/`$value" -Headers $headers -OutFile $temp
      $ofx = [IO.File]::ReadAllText($temp, [Text.Encoding]::GetEncoding(1252))
      $bankId = [regex]::Match($ofx, '<BANKID>\s*([^<\r\n]+)', 'IgnoreCase').Groups[1].Value.Trim()
      $accountId = [regex]::Match($ofx, '<ACCTID>\s*([^<\r\n]+)', 'IgnoreCase').Groups[1].Value.Trim()
      Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    } catch { Step "arquivo OFX original não pôde ser lido; conta será criada com nome legado" }
  }
  $created = Create-Row 'cr40f_fluxocaixacontas' @{cr40f_name=[string]$legacyName;cr40f_banco=$bankId;cr40f_identificador=$accountId}
  $accountByName[$normalized] = $created
}

$categoryByName = @{}
foreach ($category in $categories) {
  $key = Normalize $category.cr40f_name
  if ($categoryByName.ContainsKey($key)) { throw "Categorias mestre duplicadas por nome normalizado: $($category.cr40f_name)" }
  $categoryByName[$key] = [string]$category.cr40f_fluxocaixacategoriaid
}
foreach ($entry in $entries) {
  $legacyCategory = [string]$entry.cr40f_categoria
  if ([string]::IsNullOrWhiteSpace($legacyCategory)) { continue }
  $normalized = Normalize $legacyCategory
  if (-not $categoryByName.ContainsKey($normalized)) {
    $created = Create-Row 'cr40f_fluxocaixacategorias' @{cr40f_name=$legacyCategory;cr40f_grupo=[string]$entry.cr40f_grupo;cr40f_natureza=[string]$entry.cr40f_natureza}
    $categoryByName[$normalized] = $created
  }
}

$importById = @{}
foreach ($import in $imports) {
  $id = [string]$import.cr40f_fluxocaixaimportacaoid
  $importById[$id] = $import
  if (-not $import._cr40f_contaref_value -and $import.cr40f_conta) {
    $accountId = $accountByName[(Normalize $import.cr40f_conta)]
    Patch-Row 'cr40f_fluxocaixaimportacaos' $id @{"$navAccountImport@odata.bind"="/cr40f_fluxocaixacontas($accountId)"}
  }
}

$newKeys = @{}
foreach ($entry in $entries) {
  $body = @{}
  if (-not $entry._cr40f_contaref_value -and $entry.cr40f_conta) {
    $accountId = $accountByName[(Normalize $entry.cr40f_conta)]
    $body["$navAccountEntry@odata.bind"] = "/cr40f_fluxocaixacontas($accountId)"
  } else { $accountId = [string]$entry._cr40f_contaref_value }
  if (-not $entry._cr40f_categoriaref_value -and $entry.cr40f_categoria) {
    $categoryId = $categoryByName[(Normalize $entry.cr40f_categoria)]
    $body["$navCategoryEntry@odata.bind"] = "/cr40f_fluxocaixacategorias($categoryId)"
  }
  if (-not $entry._cr40f_importacaoref_value -and $entry.cr40f_importacaoid -and $importById.ContainsKey([string]$entry.cr40f_importacaoid)) {
    $body["$navImportEntry@odata.bind"] = "/cr40f_fluxocaixaimportacaos($($entry.cr40f_importacaoid))"
  }
  $identity = if ($entry.cr40f_fitid) {
    "$accountId|fitid|$($entry.cr40f_fitid)"
  } else {
    "$accountId|fallback|$([string]$entry.cr40f_data)|$([decimal]$entry.cr40f_valor)|$(Normalize $entry.cr40f_name)"
  }
  $key = Hash $identity
  if ($newKeys.ContainsKey($key)) { throw "Chave de transação duplicada durante migração: $key" }
  $newKeys[$key] = $true
  $body.cr40f_chavetransacao = $key
  Patch-Row 'cr40f_fluxocaixalancamentos' ([string]$entry.cr40f_fluxocaixalancamentoid) $body
}

Step "ok. lançamentos=$($entries.Count), importações=$($imports.Count), contas=$($accountByName.Count), categorias=$($categoryByName.Count)"
