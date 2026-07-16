param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [switch]$DeviceCode,
  [switch]$KeepFixtures
)
$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Step($message) { Write-Host "[smoke-dataverse] $message" }
function Token($url, [switch]$UseDeviceCode) {
  if (-not (Get-Module -ListAvailable MSAL.PS)) { throw 'MSAL.PS is required.' }
  Import-Module MSAL.PS -ErrorAction Stop
  $client = New-MsalClientApplication -ClientId '51f81489-12ee-4a9e-aaae-a2591f45987d' -TenantId 'organizations' -RedirectUri ([Uri]'http://localhost')
  Enable-MsalTokenCacheOnDisk -PublicClientApplication $client | Out-Null
  try { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Silent).AccessToken }
  catch { if ($UseDeviceCode) { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -DeviceCode).AccessToken }; return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Interactive).AccessToken }
}
function Request($method, $path, $body = $null, $extraHeaders = @{}) {
  $requestHeaders=@{}; foreach($key in $headers.Keys){$requestHeaders[$key]=$headers[$key]}; foreach($key in $extraHeaders.Keys){$requestHeaders[$key]=$extraHeaders[$key]}
  $arguments=@{Method=$method;Uri="$base/$path";Headers=$requestHeaders}
  if($null-ne $body){$arguments.ContentType='application/json; charset=utf-8';$arguments.Body=($body|ConvertTo-Json -Depth 20 -Compress)}
  return Invoke-RestMethod @arguments
}
function Navigation($schemaName) {
  $result=Request 'GET' "RelationshipDefinitions/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?`$select=ReferencingEntityNavigationPropertyName&`$filter=SchemaName eq '$schemaName'"
  if(@($result.value).Count-ne 1){throw "Relationship not found: $schemaName"}
  return [string]$result.value[0].ReferencingEntityNavigationPropertyName
}
function Hash($value) {
  $sha=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-','').ToLowerInvariant()}
  finally{$sha.Dispose()}
}
function Batch($body, $batch) {
  $response=Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$base/`$batch" -Headers $headers -ContentType "multipart/mixed; boundary=`"$batch`"" -Body ([Text.Encoding]::UTF8.GetBytes($body))
  $text=[string]$response.Content
  if($response.StatusCode-ne 200 -or $text-match 'HTTP/1.1 [45]\d\d'){throw "Batch rejected. HTTP=$($response.StatusCode) body=$text"}
  return $text
}
function CreateRow($setName, $body) {
  $row=Request 'POST' $setName $body
  $primaryId = switch ($setName) {
    'cr40f_fluxocaixaimportacaos' { 'cr40f_fluxocaixaimportacaoid' }
    'cr40f_fluxocaixalancamentos' { 'cr40f_fluxocaixalancamentoid' }
    default { throw "Primary id is not mapped for $setName" }
  }
  $id=[string]$row.$primaryId
  if($id -notmatch '^[0-9a-f-]{36}$'){throw "No primary id returned for $setName ($primaryId)"}
  return $id
}

$url=$EnvironmentUrl.TrimEnd('/')
$base="$url/api/data/v9.2"
$token=Token $url $DeviceCode
$headers=@{Authorization="Bearer $token";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0';Prefer='return=representation'}
$navAccountEntry=Navigation 'cr40f_FluxoConta_Lancamentos'
$navCategoryEntry=Navigation 'cr40f_FluxoCategoria_Lancamentos'
$navImportEntry=Navigation 'cr40f_FluxoImportacao_Lancamentos'
$navAccountImport=Navigation 'cr40f_FluxoConta_Importacoes'
$navReconciliation=Navigation 'cr40f_FluxoLancamento_Conciliados'
$account=@((Request 'GET' 'cr40f_fluxocaixacontas?$select=cr40f_fluxocaixacontaid,cr40f_name&$top=1').value)|Select-Object -First 1
$category=@((Request 'GET' 'cr40f_fluxocaixacategorias?$select=cr40f_fluxocaixacategoriaid,cr40f_name,cr40f_grupo,cr40f_natureza&$top=1').value)|Select-Object -First 1
if(-not $account -or -not $category){throw 'Create at least one account and category before the smoke test.'}
$stamp=[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')
$fingerprint=Hash "smoke-file-$stamp"
$transactionKey=Hash "smoke-account-$($account.cr40f_fluxocaixacontaid)-fitid-$stamp"
$fitId="SMOKE-$stamp"
$date=[DateTime]::UtcNow.ToString('yyyy-MM-dd')
$editedDate=[DateTime]::UtcNow.AddDays(1).ToString('yyyy-MM-dd')
$importId=$null; $duplicateImportId=$null; $actualId=$null; $forecastId=$null; $completed=$false
try {
  Step 'create import and upload original file'
  $importId=CreateRow 'cr40f_fluxocaixaimportacaos' @{
    cr40f_name="OFX smoke $stamp";cr40f_fingerprint=$fingerprint;cr40f_conta=[string]$account.cr40f_name;cr40f_status='processing'
    "$navAccountImport@odata.bind"="/cr40f_fluxocaixacontas($($account.cr40f_fluxocaixacontaid))"
  }
  Request 'GET' "cr40f_fluxocaixaimportacaos($importId)?`$select=cr40f_fluxocaixaimportacaoid" | Out-Null
  $ofx="OFXHEADER:100`r`nDATA:OFXSGML`r`nVERSION:102`r`nSECURITY:NONE`r`nENCODING:USASCII`r`nCHARSET:1252`r`nCOMPRESSION:NONE`r`nOLDFILEUID:NONE`r`nNEWFILEUID:NONE`r`n<OFX><CURDEF>BRL<BANKACCTFROM><BANKID>341<ACCTID>SMOKE<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>$([DateTime]::UtcNow.ToString('yyyyMMdd'))120000[-3]<TRNAMT>-123.45<FITID>$fitId<NAME>SMOKE DATAVERSE</STMTTRN></BANKTRANLIST></OFX>"
  $fileHeaders=@{
    Authorization="Bearer $token";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0'
    'If-None-Match'='null';'Content-Type'='application/octet-stream';'x-ms-file-name'='smoke.ofx'
  }
  Invoke-RestMethod -Method Patch -Uri "$base/cr40f_fluxocaixaimportacaos($importId)/cr40f_arquivoofx" -Headers $fileHeaders -Body ([Text.Encoding]::ASCII.GetBytes($ofx)) | Out-Null

  Step 'atomic import changeset'
  $batch="batch_$([guid]::NewGuid().ToString('N'))";$change="changeset_$([guid]::NewGuid().ToString('N'))"
  $entry=@{
    cr40f_name='SMOKE DATAVERSE';cr40f_data=$date;cr40f_valor=123.45;cr40f_categoria=[string]$category.cr40f_name;cr40f_grupo=[string]$category.cr40f_grupo
    cr40f_origem='ofx';cr40f_tipo='actual';cr40f_natureza='outflow';cr40f_status='open';cr40f_conta=[string]$account.cr40f_name
    cr40f_chavetransacao=$transactionKey;cr40f_fitid=$fitId;cr40f_descricaooriginal='SMOKE DATAVERSE';cr40f_dataoriginal=$date;cr40f_importacaoid=$importId
    "$navAccountEntry@odata.bind"="/cr40f_fluxocaixacontas($($account.cr40f_fluxocaixacontaid))"
    "$navCategoryEntry@odata.bind"="/cr40f_fluxocaixacategorias($($category.cr40f_fluxocaixacategoriaid))"
    "$navImportEntry@odata.bind"="/cr40f_fluxocaixaimportacaos($importId)"
  }
  $lines=@("--$batch","Content-Type: multipart/mixed; boundary=`"$change`"",'',"--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 1','',"POST /api/data/v9.2/cr40f_fluxocaixalancamentos HTTP/1.1",'Content-Type: application/json;type=entry','',($entry|ConvertTo-Json -Depth 10 -Compress),'',"--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 2','',"PATCH /api/data/v9.2/cr40f_fluxocaixaimportacaos($importId) HTTP/1.1",'Content-Type: application/json;type=entry','',(@{cr40f_status='imported'}|ConvertTo-Json -Compress),'',"--$change--","--$batch--",'')
  Batch ($lines-join "`r`n") $batch|Out-Null
  $actual=@((Request 'GET' "cr40f_fluxocaixalancamentos?`$select=cr40f_fluxocaixalancamentoid,cr40f_name,cr40f_data,cr40f_descricaooriginal,cr40f_dataoriginal,cr40f_status&`$filter=cr40f_chavetransacao eq '$transactionKey'").value)|Select-Object -First 1
  if(-not $actual){throw 'Atomic import did not create the entry.'};$actualId=[string]$actual.cr40f_fluxocaixalancamentoid

  Step 'duplicate fingerprint block'
  $blocked=$false
  try{$duplicateImportId=CreateRow 'cr40f_fluxocaixaimportacaos' @{cr40f_name='SMOKE DUPLICATE';cr40f_fingerprint=$fingerprint;cr40f_status='processing'}}catch{$blocked=$true}
  if(-not $blocked){throw 'Duplicate fingerprint was accepted.'}

  Step 'edit while preserving original fields'
  Request 'PATCH' "cr40f_fluxocaixalancamentos($actualId)" @{cr40f_name='SMOKE EDITED';cr40f_data=$editedDate} @{'If-Match'='*'}|Out-Null
  $edited=Request 'GET' "cr40f_fluxocaixalancamentos($actualId)?`$select=cr40f_name,cr40f_data,cr40f_descricaooriginal,cr40f_dataoriginal"
  if($edited.cr40f_name-ne 'SMOKE EDITED' -or ([string]$edited.cr40f_data).Substring(0,10)-ne $editedDate -or $edited.cr40f_descricaooriginal-ne 'SMOKE DATAVERSE' -or ([string]$edited.cr40f_dataoriginal).Substring(0,10)-ne $date){throw 'Original OFX fields were changed.'}

  Step 'create forecast and reconcile atomically'
  $forecastId=CreateRow 'cr40f_fluxocaixalancamentos' @{
    cr40f_name='SMOKE FORECAST';cr40f_data=$editedDate;cr40f_valor=123.45;cr40f_categoria=[string]$category.cr40f_name;cr40f_grupo=[string]$category.cr40f_grupo
    cr40f_origem='manual';cr40f_tipo='forecast';cr40f_natureza='outflow';cr40f_status='open'
    "$navAccountEntry@odata.bind"="/cr40f_fluxocaixacontas($($account.cr40f_fluxocaixacontaid))"
    "$navCategoryEntry@odata.bind"="/cr40f_fluxocaixacategorias($($category.cr40f_fluxocaixacategoriaid))"
  }
  $batch="batch_$([guid]::NewGuid().ToString('N'))";$change="changeset_$([guid]::NewGuid().ToString('N'))"
  $lines=@("--$batch","Content-Type: multipart/mixed; boundary=`"$change`"",'',"--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 1','',"PATCH /api/data/v9.2/cr40f_fluxocaixalancamentos($actualId) HTTP/1.1",'Content-Type: application/json;type=entry','',(@{cr40f_status='reconciled';cr40f_conciliadocomid=$forecastId;"$navReconciliation@odata.bind"="/cr40f_fluxocaixalancamentos($forecastId)"}|ConvertTo-Json -Compress),'',"--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 2','',"PATCH /api/data/v9.2/cr40f_fluxocaixalancamentos($forecastId) HTTP/1.1",'Content-Type: application/json;type=entry','',(@{cr40f_status='reconciled';cr40f_conciliadocomid=$actualId;"$navReconciliation@odata.bind"="/cr40f_fluxocaixalancamentos($actualId)"}|ConvertTo-Json -Compress),'',"--$change--","--$batch--",'')
  Batch ($lines-join "`r`n") $batch|Out-Null

  Step 'atomic reversal reopens forecast'
  $batch="batch_$([guid]::NewGuid().ToString('N'))";$change="changeset_$([guid]::NewGuid().ToString('N'))"
  $actualReverse=@{cr40f_status='reversed';cr40f_conciliadocomid=$null;"$navReconciliation@odata.bind"=$null}
  $forecastOpen=@{cr40f_status='open';cr40f_conciliadocomid=$null;"$navReconciliation@odata.bind"=$null}
  $lines=@("--$batch","Content-Type: multipart/mixed; boundary=`"$change`"",'',"--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 1','',"PATCH /api/data/v9.2/cr40f_fluxocaixalancamentos($actualId) HTTP/1.1",'Content-Type: application/json;type=entry','',($actualReverse|ConvertTo-Json -Compress),'',"--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 2','',"PATCH /api/data/v9.2/cr40f_fluxocaixalancamentos($forecastId) HTTP/1.1",'Content-Type: application/json;type=entry','',($forecastOpen|ConvertTo-Json -Compress),'',"--$change",'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 3','',"PATCH /api/data/v9.2/cr40f_fluxocaixaimportacaos($importId) HTTP/1.1",'Content-Type: application/json;type=entry','',(@{cr40f_status='reversed'}|ConvertTo-Json -Compress),'',"--$change--","--$batch--",'')
  Batch ($lines-join "`r`n") $batch|Out-Null
  $actualFinal=Request 'GET' "cr40f_fluxocaixalancamentos($actualId)?`$select=cr40f_status,_cr40f_conciliadocom_value"
  $forecastFinal=Request 'GET' "cr40f_fluxocaixalancamentos($forecastId)?`$select=cr40f_status,_cr40f_conciliadocom_value"
  $importFinal=Request 'GET' "cr40f_fluxocaixaimportacaos($importId)?`$select=cr40f_status"
  if($actualFinal.cr40f_status-ne 'reversed' -or $actualFinal._cr40f_conciliadocom_value -or $forecastFinal.cr40f_status-ne 'open' -or $forecastFinal._cr40f_conciliadocom_value -or $importFinal.cr40f_status-ne 'reversed'){throw 'Atomic reversal state is invalid.'}
  $completed=$true
  Step 'ok import duplicate edit reconcile reverse'
} finally {
  if(-not $KeepFixtures){
    if(-not $actualId){
      try{
        $orphan=@((Request 'GET' "cr40f_fluxocaixalancamentos?`$select=cr40f_fluxocaixalancamentoid&`$filter=cr40f_chavetransacao eq '$transactionKey'").value)|Select-Object -First 1
        if($orphan){$actualId=[string]$orphan.cr40f_fluxocaixalancamentoid}
      }catch{}
    }
    foreach($item in @(@{Set='cr40f_fluxocaixalancamentos';Id=$actualId},@{Set='cr40f_fluxocaixalancamentos';Id=$forecastId},@{Set='cr40f_fluxocaixaimportacaos';Id=$duplicateImportId},@{Set='cr40f_fluxocaixaimportacaos';Id=$importId})){
      if($item.Id){try{Request 'DELETE' "$($item.Set)($($item.Id))"|Out-Null}catch{Step "cleanup warning $($item.Set)($($item.Id))"}}
    }
    try {
      $remainingEntries=@((Request 'GET' "cr40f_fluxocaixalancamentos?`$select=cr40f_fluxocaixalancamentoid&`$filter=cr40f_chavetransacao eq '$transactionKey'").value).Count
      $remainingImports=@((Request 'GET' "cr40f_fluxocaixaimportacaos?`$select=cr40f_fluxocaixaimportacaoid&`$filter=cr40f_fingerprint eq '$fingerprint'").value).Count
      if($remainingEntries -or $remainingImports){
        $message="cleanup left entries=$remainingEntries imports=$remainingImports"
        if($completed){throw $message};Step "warning $message"
      }
    } catch {
      if($completed){throw};Step 'cleanup verification warning'
    }
  }
}
