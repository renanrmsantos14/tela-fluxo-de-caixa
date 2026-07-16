param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [switch]$DeviceCode
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

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
function Request($method, $path, $body = $null) {
  $arguments = @{Method=$method;Uri="$base/$path";Headers=$headers}
  if ($null -ne $body) {
    $arguments.ContentType = 'application/json; charset=utf-8'
    $arguments.Body = ($body | ConvertTo-Json -Depth 10 -Compress)
  }
  return Invoke-RestMethod @arguments
}
function Navigation($schemaName) {
  $result = Request 'GET' "RelationshipDefinitions/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?`$select=ReferencingEntityNavigationPropertyName&`$filter=SchemaName eq '$schemaName'"
  if (@($result.value).Count -ne 1) { throw "Relationship not found: $schemaName" }
  return [string]$result.value[0].ReferencingEntityNavigationPropertyName
}

$url = $EnvironmentUrl.TrimEnd('/')
$base = "$url/api/data/v9.2"
$headers = @{Authorization="Bearer $(Token $url $DeviceCode)";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0';Prefer='return=representation'}
$statusMetadata = Request 'GET' "EntityDefinitions(LogicalName='cr40f_terceirofavorecido')/Attributes(LogicalName='cr40f_status')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?`$select=LogicalName&`$expand=OptionSet"
$activeOption = $statusMetadata.OptionSet.Options | Where-Object { $_.Label.UserLocalizedLabel.Label -match '^Ativo$|^Active$' } | Select-Object -First 1
if (-not $activeOption) { throw 'Active favored status not found in metadata.' }
$favored = @((Request 'GET' "cr40f_terceirofavorecidos?`$select=cr40f_terceirofavorecidoid,cr40f_nomerazaosocial&`$filter=cr40f_status eq $($activeOption.Value)&`$top=1").value) | Select-Object -First 1
if (-not $favored) { throw 'No active favored third party found.' }
$categoryNav = Navigation 'cr40f_FluxoCategoria_Regras'
$favoredNav = Navigation 'cr40f_Favorecido_FluxoRegras'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')
$categoryId = $null
$ruleId = $null
try {
  $category = Request 'POST' 'cr40f_fluxocaixacategorias' @{cr40f_name="SMOKE CATEGORY $stamp";cr40f_grupo='SMOKE';cr40f_natureza='outflow'}
  $categoryId = [string]$category.cr40f_fluxocaixacategoriaid
  $rule = Request 'POST' 'cr40f_fluxocaixaregras' @{
    cr40f_name="SMOKE RULE $stamp";cr40f_expressao="SMOKE $stamp";cr40f_direcao='outflow';cr40f_ativo=$true;cr40f_categoria="SMOKE CATEGORY $stamp"
    "$categoryNav@odata.bind"="/cr40f_fluxocaixacategorias($categoryId)"
    "$favoredNav@odata.bind"="/cr40f_terceirofavorecidos($($favored.cr40f_terceirofavorecidoid))"
  }
  $ruleId = [string]$rule.cr40f_fluxocaixaregraid
  $stored = Request 'GET' "cr40f_fluxocaixaregras($ruleId)?`$select=cr40f_expressao,cr40f_ativo,_cr40f_categoriaref_value,_cr40f_terceirofavorecidoref_value"
  if ($stored._cr40f_categoriaref_value -ne $categoryId -or $stored._cr40f_terceirofavorecidoref_value -ne $favored.cr40f_terceirofavorecidoid) { throw 'Unified lookups were not stored.' }
  $blocked = $false
  try { Request 'DELETE' "cr40f_fluxocaixacategorias($categoryId)" | Out-Null } catch { $blocked = $true }
  if (-not $blocked) { throw 'Category deletion should be blocked while a rule uses it.' }
  Request 'PATCH' "cr40f_fluxocaixaregras($ruleId)" @{cr40f_expressao="SMOKE EDITED $stamp";cr40f_ativo=$false;"$favoredNav@odata.bind"=$null} | Out-Null
  $edited = Request 'GET' "cr40f_fluxocaixaregras($ruleId)?`$select=cr40f_expressao,cr40f_ativo,_cr40f_terceirofavorecidoref_value"
  if ($edited.cr40f_ativo -ne $false -or $edited.cr40f_expressao -ne "SMOKE EDITED $stamp" -or $edited._cr40f_terceirofavorecidoref_value) { throw 'Rule edit or lookup clearing failed.' }
  Write-Host '[smoke-masters] ok create edit status unified-favored protected-delete'
}
finally {
  if ($ruleId) { try { Request 'DELETE' "cr40f_fluxocaixaregras($ruleId)" | Out-Null } catch {} }
  if ($categoryId) { try { Request 'DELETE' "cr40f_fluxocaixacategorias($categoryId)" | Out-Null } catch {} }
}
