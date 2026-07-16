param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [string]$SolutionUniqueName = 'appbetinhos',
  [switch]$DeviceCode,
  [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Step($message) { Write-Host "[repair-encoding] $message" }
function Repair-Text($text) {
  if ($null -eq $text) { return $null }
  $value = [string]$text
  for ($attempt = 0; $attempt -lt 2 -and $value -match '\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\uFFFF]|\u00F0[\u0080-\uFFFF]'; $attempt++) {
    $value = [Text.Encoding]::UTF8.GetString([Text.Encoding]::GetEncoding(1252).GetBytes($value))
  }
  return $value
}
function Token($url, [switch]$UseDeviceCode) {
  if (-not (Get-Module -ListAvailable MSAL.PS)) { throw 'MSAL.PS is required.' }
  Import-Module MSAL.PS -ErrorAction Stop
  $client = New-MsalClientApplication -ClientId '51f81489-12ee-4a9e-aaae-a2591f45987d' -TenantId 'organizations' -RedirectUri ([Uri]'http://localhost')
  Enable-MsalTokenCacheOnDisk -PublicClientApplication $client | Out-Null
  try { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Silent).AccessToken }
  catch { if ($UseDeviceCode) { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -DeviceCode).AccessToken }; return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Interactive).AccessToken }
}
function Invoke-Json($method, $path, $body = $null, $metadata = $false) {
  $requestHeaders = @{}; foreach ($key in $headers.Keys) { $requestHeaders[$key] = $headers[$key] }
  if ($metadata) { $requestHeaders['MSCRM.MergeLabels']='true' }
  $arguments = @{Method=$method;Uri="$base/$path";Headers=$requestHeaders}
  if ($null -ne $body) { $arguments.ContentType='application/json; charset=utf-8'; $arguments.Body=($body | ConvertTo-Json -Depth 100 -Compress) }
  return Invoke-RestMethod @arguments
}
function Repair-Label($label) {
  $changed = $false
  if ($label -and $label.LocalizedLabels) {
    foreach ($item in $label.LocalizedLabels) {
      $fixed = Repair-Text $item.Label
      if ($fixed -ne $item.Label) { $item.Label=$fixed; $changed=$true }
    }
  }
  if ($label -and $label.UserLocalizedLabel) {
    $fixed = Repair-Text $label.UserLocalizedLabel.Label
    if ($fixed -ne $label.UserLocalizedLabel.Label) { $label.UserLocalizedLabel.Label=$fixed; $changed=$true }
  }
  return $changed
}
function Remove-ODataProperties($object) {
  @($object.PSObject.Properties | Where-Object { $_.Name -like '@odata.*' }) | ForEach-Object { $object.PSObject.Properties.Remove($_.Name) }
}
function Attribute-ODataType($attribute, $attributeType) {
  $typeProperty = $attribute.PSObject.Properties['@odata.type']
  if ($typeProperty) { return ([string]$typeProperty.Value).TrimStart('#') }
  $name = if ($attributeType -eq 'Uniqueidentifier') { 'UniqueIdentifier' } elseif ($attributeType -eq 'Owner') { 'Lookup' } else { [string]$attributeType }
  return "Microsoft.Dynamics.CRM.${name}AttributeMetadata"
}

$url = $EnvironmentUrl.TrimEnd('/')
$base = "$url/api/data/v9.2"
$token = Token $url $DeviceCode
$headers = @{Authorization="Bearer $token";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0';Prefer='return=representation';'MSCRM.SolutionUniqueName'=$SolutionUniqueName}
$tables = @(
  @{Logical='cr40f_fluxocaixalancamento';Set='cr40f_fluxocaixalancamentos';Id='cr40f_fluxocaixalancamentoid';Text=@('cr40f_name','cr40f_categoria','cr40f_grupo','cr40f_origem','cr40f_tipo','cr40f_natureza','cr40f_status','cr40f_conta','cr40f_contraparte','cr40f_descricaooriginal')},
  @{Logical='cr40f_fluxocaixaimportacao';Set='cr40f_fluxocaixaimportacaos';Id='cr40f_fluxocaixaimportacaoid';Text=@('cr40f_name','cr40f_conta','cr40f_status')},
  @{Logical='cr40f_fluxocaixaconta';Set='cr40f_fluxocaixacontas';Id='cr40f_fluxocaixacontaid';Text=@('cr40f_name','cr40f_banco','cr40f_identificador')},
  @{Logical='cr40f_fluxocaixacategoria';Set='cr40f_fluxocaixacategorias';Id='cr40f_fluxocaixacategoriaid';Text=@('cr40f_name','cr40f_grupo','cr40f_natureza')},
  @{Logical='cr40f_fluxocaixarecorrencia';Set='cr40f_fluxocaixarecorrencias';Id='cr40f_fluxocaixarecorrenciaid';Text=@('cr40f_name','cr40f_categoria','cr40f_natureza','cr40f_frequencia','cr40f_ajustevencimento')},
  @{Logical='cr40f_fluxocaixacontraparte';Set='cr40f_fluxocaixacontrapartes';Id='cr40f_fluxocaixacontraparteid';Text=@('cr40f_name','cr40f_documento')},
  @{Logical='cr40f_fluxocaixaregra';Set='cr40f_fluxocaixaregras';Id='cr40f_fluxocaixaregraid';Text=@('cr40f_name','cr40f_expressao','cr40f_categoria')},
  @{Logical='cr40f_fluxocaixaferiado';Set='cr40f_fluxocaixaferiados';Id='cr40f_fluxocaixaferiadoid';Text=@('cr40f_name')},
  @{Logical='cr40f_fluxocaixaconfiguracao';Set='cr40f_fluxocaixaconfiguracaos';Id='cr40f_fluxocaixaconfiguracaoid';Text=@('cr40f_name','cr40f_entidadeop','cr40f_entitysetop','cr40f_campoidop','cr40f_camponomeop','cr40f_campovalorop','cr40f_campodataop','cr40f_campostatusop','cr40f_valorativoop','cr40f_categoriaop','cr40f_campocontraparteop','cr40f_destinatariosalerta')},
  @{Logical='cr40f_fluxocaixaevento';Set='cr40f_fluxocaixaeventos';Id='cr40f_fluxocaixaeventoid';Text=@('cr40f_name','cr40f_acao','cr40f_detalhe')}
)
$metadataFixes=0; $rowFixes=0
foreach ($table in $tables) {
  $entity = Invoke-Json 'GET' "EntityDefinitions(LogicalName='$($table.Logical)')"
  $entityChanged = Repair-Label $entity.DisplayName
  if (Repair-Label $entity.DisplayCollectionName) { $entityChanged=$true }
  if (Repair-Label $entity.Description) { $entityChanged=$true }
  if ($entityChanged) {
    $metadataFixes++
    Step "table label $($table.Logical)"
    if (-not $WhatIf) {
      Remove-ODataProperties $entity
      $entity | Add-Member -NotePropertyName '@odata.type' -NotePropertyValue 'Microsoft.Dynamics.CRM.EntityMetadata'
      Invoke-Json 'PUT' "EntityDefinitions(LogicalName='$($table.Logical)')" $entity $true | Out-Null
    }
  }
  $attributes = @((Invoke-Json 'GET' "EntityDefinitions(LogicalName='$($table.Logical)')/Attributes?`$select=LogicalName,AttributeType,DisplayName,Description").value)
  foreach ($summary in $attributes) {
    $summaryChanged = Repair-Label $summary.DisplayName
    if (Repair-Label $summary.Description) { $summaryChanged=$true }
    if (-not $summaryChanged) { continue }
    $attribute = Invoke-Json 'GET' "EntityDefinitions(LogicalName='$($table.Logical)')/Attributes(LogicalName='$($summary.LogicalName)')"
    $changed = Repair-Label $attribute.DisplayName
    if (Repair-Label $attribute.Description) { $changed=$true }
    if (-not $changed) { continue }
    $metadataFixes++
    Step "attribute label $($table.Logical).$($summary.LogicalName)"
    if (-not $WhatIf) {
      $odataType = Attribute-ODataType $attribute $summary.AttributeType
      Remove-ODataProperties $attribute
      $attribute | Add-Member -NotePropertyName '@odata.type' -NotePropertyValue $odataType
      Invoke-Json 'PUT' "EntityDefinitions(LogicalName='$($table.Logical)')/Attributes(LogicalName='$($summary.LogicalName)')" $attribute $true | Out-Null
    }
  }
  $select = @($table.Id) + $table.Text
  $rows = @((Invoke-Json 'GET' "$($table.Set)?`$select=$($select -join ',')").value)
  foreach ($row in $rows) {
    $body=@{}
    foreach ($field in $table.Text) {
      $fixed=Repair-Text $row.$field
      if ($fixed -ne $row.$field) { $body[$field]=$fixed }
    }
    if (-not $body.Count) { continue }
    $rowFixes++
    Step "row $($table.Set)($($row.($table.Id)))"
    if (-not $WhatIf) { Invoke-Json 'PATCH' "$($table.Set)($($row.($table.Id)))" $body | Out-Null }
  }
}
if (-not $WhatIf -and $metadataFixes) { Invoke-Json 'POST' 'PublishAllXml' @{} | Out-Null }
Step "ok metadata=$metadataFixes rows=$rowFixes whatIf=$WhatIf"
