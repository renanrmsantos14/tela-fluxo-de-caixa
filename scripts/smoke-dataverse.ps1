param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [switch]$DeviceCode,
  [switch]$KeepFixtures
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Step($message) { Write-Host "[smoke-dataverse] $message" }
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
function Request($method, $path, $body = $null, $extraHeaders = @{}) {
  $requestHeaders = @{}
  foreach ($key in $headers.Keys) { $requestHeaders[$key] = $headers[$key] }
  foreach ($key in $extraHeaders.Keys) { $requestHeaders[$key] = $extraHeaders[$key] }
  $arguments = @{Method=$method;Uri="$base/$path";Headers=$requestHeaders}
  if ($null -ne $body) {
    $arguments.ContentType = 'application/json; charset=utf-8'
    $arguments.Body = ($body | ConvertTo-Json -Depth 20 -Compress)
  }
  return Invoke-RestMethod @arguments
}
function Create($set, $idField, $body) {
  $row = Request 'POST' $set $body
  $id = [string]$row.$idField
  if ($id -notmatch '^[0-9a-f-]{36}$') { throw "Dataverse did not return an ID for $set." }
  return $id
}
function Navigation($schemaName) {
  $result = Request 'GET' "RelationshipDefinitions/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?`$select=ReferencingEntityNavigationPropertyName&`$filter=SchemaName eq '$schemaName'"
  if (@($result.value).Count -ne 1) { throw "Relacionamento ausente: $schemaName" }
  return [string]$result.value[0].ReferencingEntityNavigationPropertyName
}
function Hash($value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function Run-Batch($lines, $batch) {
  $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$base/`$batch" -Headers $headers -ContentType "multipart/mixed; boundary=$batch" -Body ([Text.Encoding]::UTF8.GetBytes(($lines -join "`r`n")))
  $text = [string]$response.Content
  if ($response.StatusCode -ne 200 -or $text -match 'HTTP/1.1 [45]\d\d') { throw "Batch rejeitado: $text" }
}

$url = $EnvironmentUrl.TrimEnd('/')
$base = "$url/api/data/v9.2"
$headers = @{Authorization="Bearer $(Token $url $DeviceCode)";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0';Prefer='return=representation'}
$navAccountEntry = Navigation 'cr40f_FluxoConta_Lancamentos'
$navCategoryEntry = Navigation 'cr40f_FluxoCategoria_Lancamentos'
$navCounterpartyEntry = Navigation 'cr40f_FluxoContraparte_Lancamentos'
$navImportEntry = Navigation 'cr40f_FluxoImportacao_Lancamentos'
$navAccountImport = Navigation 'cr40f_FluxoConta_Importacoes'
$navCategoryRule = Navigation 'cr40f_FluxoCategoria_Regras'
$navAccountRule = Navigation 'cr40f_FluxoConta_Regras'
$navCounterpartyRule = Navigation 'cr40f_FluxoContraparte_Regras'
$navRuleEntry = Navigation 'cr40f_FluxoRegra_Lancamentos'

$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')
$date = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
$fingerprint = Hash "v0-file-$stamp"
$transactionKey = Hash "v0-account-fitid-$stamp"
$ids = @{}
try {
  Step 'create temporary master data'
  $ids.account = Create 'cr40f_fluxocaixacontas' 'cr40f_fluxocaixacontaid' @{cr40f_name="SMOKE CONTA $stamp";cr40f_banco='341';cr40f_identificador="SMOKE-$stamp"}
  $ids.category = Create 'cr40f_fluxocaixacategorias' 'cr40f_fluxocaixacategoriaid' @{cr40f_name="SMOKE FUEL $stamp";cr40f_grupo='Custo operacional';cr40f_natureza='outflow'}
  $ids.counterparty = Create 'cr40f_fluxocaixacontrapartes' 'cr40f_fluxocaixacontraparteid' @{cr40f_name="SMOKE TICKET LOG $stamp"}
  $ids.import = Create 'cr40f_fluxocaixaimportacaos' 'cr40f_fluxocaixaimportacaoid' @{
    cr40f_name="SMOKE OFX $stamp";cr40f_fingerprint=$fingerprint;cr40f_conta="SMOKE CONTA $stamp";cr40f_status='processing'
    "$navAccountImport@odata.bind"="/cr40f_fluxocaixacontas($($ids.account))"
  }

  Step 'atomic import'
  $entry = @{
    cr40f_name='PAGAMENTO TICKET LOG';cr40f_data=$date;cr40f_valor=123.45;cr40f_origem='ofx';cr40f_tipo='actual'
    cr40f_natureza='outflow';cr40f_status='suggested';cr40f_conta="SMOKE CONTA $stamp";cr40f_chavetransacao=$transactionKey
    cr40f_fitid="FIT-$stamp";cr40f_descricaooriginal='PAGAMENTO TICKET LOG';cr40f_dataoriginal=$date
    cr40f_nameoriginal='TICKET LOG';cr40f_memooriginal='BOLETO TICKET LOG';cr40f_tipoofx='DEBIT';cr40f_checknum="CHK-$stamp"
    cr40f_textonormalizado='PAGAMENTO TICKET LOG BOLETO TICKET LOG';cr40f_conflitoregra=$false;cr40f_importacaoid=$ids.import
    "$navAccountEntry@odata.bind"="/cr40f_fluxocaixacontas($($ids.account))"
    "$navCategoryEntry@odata.bind"="/cr40f_fluxocaixacategorias($($ids.category))"
    "$navCounterpartyEntry@odata.bind"="/cr40f_fluxocaixacontrapartes($($ids.counterparty))"
    "$navImportEntry@odata.bind"="/cr40f_fluxocaixaimportacaos($($ids.import))"
  }
  $batch = "batch_$([guid]::NewGuid().ToString('N'))"
  $change = "changeset_$([guid]::NewGuid().ToString('N'))"
  Run-Batch @(
    "--$batch","Content-Type: multipart/mixed; boundary=$change",'',
    "--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 1','',
    'POST /api/data/v9.2/cr40f_fluxocaixalancamentos HTTP/1.1','Content-Type: application/json; charset=utf-8','',
    ($entry | ConvertTo-Json -Depth 20 -Compress),'',
    "--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 2','',
    "PATCH /api/data/v9.2/cr40f_fluxocaixaimportacaos($($ids.import)) HTTP/1.1",'Content-Type: application/json; charset=utf-8','',
    (@{cr40f_status='imported'} | ConvertTo-Json -Compress),'',"--$change--","--$batch--",''
  ) $batch
  $created = @((Request 'GET' "cr40f_fluxocaixalancamentos?`$select=cr40f_fluxocaixalancamentoid,cr40f_status,cr40f_memooriginal,cr40f_checknum,cr40f_fitid&`$filter=cr40f_chavetransacao eq '$transactionKey'").value) | Select-Object -First 1
  if (-not $created) { throw 'Entry was not created.' }
  $ids.entry = [string]$created.cr40f_fluxocaixalancamentoid
  if ($created.cr40f_memooriginal -ne 'BOLETO TICKET LOG' -or $created.cr40f_checknum -ne "CHK-$stamp" -or $created.cr40f_fitid -ne "FIT-$stamp") { throw 'Original fields were not preserved.' }

  Step 'bloquear fingerprint duplicado'
  $blocked = $false
  try { $ids.duplicate = Create 'cr40f_fluxocaixaimportacaos' 'cr40f_fluxocaixaimportacaoid' @{cr40f_name='SMOKE DUPLICADO';cr40f_fingerprint=$fingerprint;cr40f_status='processing'} }
  catch { $blocked = $true }
  if (-not $blocked) { throw 'Fingerprint duplicado foi aceito.' }

  Step 'salvar regra e validar com ETag no mesmo changeset'
  $fresh = Request 'GET' "cr40f_fluxocaixalancamentos($($ids.entry))?`$select=cr40f_fluxocaixalancamentoid"
  $etag = [string]$fresh.'@odata.etag'
  if (-not $etag) { throw 'ETag ausente.' }
  $batch = "batch_$([guid]::NewGuid().ToString('N'))"
  $change = "changeset_$([guid]::NewGuid().ToString('N'))"
  $rule = @{
    cr40f_name='TICKET LOG TO FUEL';cr40f_expressao='TICKET LOG';cr40f_direcao='outflow';cr40f_ativo=$true;cr40f_categoria="SMOKE FUEL $stamp"
    "$navCategoryRule@odata.bind"="/cr40f_fluxocaixacategorias($($ids.category))"
    "$navAccountRule@odata.bind"="/cr40f_fluxocaixacontas($($ids.account))"
    "$navCounterpartyRule@odata.bind"="/cr40f_fluxocaixacontrapartes($($ids.counterparty))"
  }
  $validation = @{
    cr40f_status='validated';cr40f_datavalidacao=[DateTime]::UtcNow.ToString('o');cr40f_categoria="SMOKE FUEL $stamp";cr40f_grupo='Custo operacional';cr40f_contraparte="SMOKE TICKET LOG $stamp";cr40f_natureza='outflow'
    "$navCategoryEntry@odata.bind"="/cr40f_fluxocaixacategorias($($ids.category))"
    "$navCounterpartyEntry@odata.bind"="/cr40f_fluxocaixacontrapartes($($ids.counterparty))"
    "$navRuleEntry@odata.bind"='$1'
  }
  Run-Batch @(
    "--$batch","Content-Type: multipart/mixed; boundary=$change",'',
    "--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 1','',
    'POST /api/data/v9.2/cr40f_fluxocaixaregras HTTP/1.1','Content-Type: application/json; charset=utf-8','',($rule | ConvertTo-Json -Depth 20 -Compress),'',
    "--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 2','',
    "PATCH /api/data/v9.2/cr40f_fluxocaixalancamentos($($ids.entry)) HTTP/1.1",'Content-Type: application/json; charset=utf-8',"If-Match: $etag",'',
    ($validation | ConvertTo-Json -Depth 20 -Compress),'',"--$change--","--$batch--",''
  ) $batch
  $validated = Request 'GET' "cr40f_fluxocaixalancamentos($($ids.entry))?`$select=cr40f_status,_cr40f_regraref_value"
  if ($validated.cr40f_status -ne 'validated' -or -not $validated._cr40f_regraref_value) { throw 'Rule and validation were not confirmed.' }
  $ids.rule = [string]$validated._cr40f_regraref_value

  Step 'reverter lote completo'
  $batch = "batch_$([guid]::NewGuid().ToString('N'))"
  $change = "changeset_$([guid]::NewGuid().ToString('N'))"
  Run-Batch @(
    "--$batch","Content-Type: multipart/mixed; boundary=$change",'',
    "--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 1','',
    "PATCH /api/data/v9.2/cr40f_fluxocaixalancamentos($($ids.entry)) HTTP/1.1",'Content-Type: application/json; charset=utf-8','',(@{cr40f_status='reversed'} | ConvertTo-Json -Compress),'',
    "--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 2','',
    "PATCH /api/data/v9.2/cr40f_fluxocaixaimportacaos($($ids.import)) HTTP/1.1",'Content-Type: application/json; charset=utf-8','',(@{cr40f_status='reversed'} | ConvertTo-Json -Compress),'',
    "--$change--","--$batch--",''
  ) $batch
  $final = Request 'GET' "cr40f_fluxocaixalancamentos($($ids.entry))?`$select=cr40f_status"
  if ($final.cr40f_status -ne 'reversed') { throw 'Reversal was not confirmed.' }
  Step 'ok: import originals duplicate rule etag validation reversal'
}
finally {
  if (-not $KeepFixtures) {
    foreach ($item in @(
      @{Set='cr40f_fluxocaixalancamentos';Id=$ids['entry']},
      @{Set='cr40f_fluxocaixaregras';Id=$ids['rule']},
      @{Set='cr40f_fluxocaixaimportacaos';Id=$ids['duplicate']},
      @{Set='cr40f_fluxocaixaimportacaos';Id=$ids['import']},
      @{Set='cr40f_fluxocaixacontrapartes';Id=$ids['counterparty']},
      @{Set='cr40f_fluxocaixacategorias';Id=$ids['category']},
      @{Set='cr40f_fluxocaixacontas';Id=$ids['account']}
    )) {
      if ($item.Id) {
        try { Request 'DELETE' "$($item.Set)($($item.Id))" | Out-Null }
        catch { Step "aviso de limpeza: $($item.Set)($($item.Id))" }
      }
    }
  }
}
