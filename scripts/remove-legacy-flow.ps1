param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [string]$FlowName = 'Fluxo de Caixa - Sincronização e Alertas',
  [switch]$DeviceCode
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

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
function Request($method, $path, $body = $null) {
  $arguments = @{Method=$method;Uri="$base/$path";Headers=$headers}
  if ($null -ne $body) {
    $arguments.ContentType = 'application/json; charset=utf-8'
    $arguments.Body = ($body | ConvertTo-Json -Depth 10 -Compress)
  }
  return Invoke-RestMethod @arguments
}

$url = $EnvironmentUrl.TrimEnd('/')
$base = "$url/api/data/v9.2"
$headers = @{Authorization="Bearer $(Token $url $DeviceCode)";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0'}
$escapedName = $FlowName.Replace("'", "''")
$flows = @((Request 'GET' "workflows?`$select=workflowid,name,statecode,statuscode&`$filter=name eq '$escapedName'").value)
if ($flows.Count -eq 0) {
  Write-Host '[remove-legacy-flow] fluxo financeiro já está ausente.'
  exit 0
}
if ($flows.Count -gt 1) { throw "Mais de um Flow encontrado com o nome: $FlowName" }

$stateMetadata = Request 'GET' "EntityDefinitions(LogicalName='workflow')/Attributes(LogicalName='statecode')/Microsoft.Dynamics.CRM.StateAttributeMetadata?`$select=LogicalName&`$expand=OptionSet"
$statusMetadata = Request 'GET' "EntityDefinitions(LogicalName='workflow')/Attributes(LogicalName='statuscode')/Microsoft.Dynamics.CRM.StatusAttributeMetadata?`$select=LogicalName&`$expand=OptionSet"
$draftState = $stateMetadata.OptionSet.Options | Where-Object {
  $_.InvariantName -eq 'Draft' -or $_.Label.UserLocalizedLabel.Label -match 'Draft|Rascunho'
} | Select-Object -First 1
if (-not $draftState) { throw 'Estado Draft/Rascunho não encontrado na metadata.' }
$draftStatus = $statusMetadata.OptionSet.Options | Where-Object { $_.State -eq $draftState.Value } | Select-Object -First 1
if (-not $draftStatus) { throw 'Status de rascunho não encontrado na metadata.' }

$flow = $flows[0]
if ([int]$flow.statecode -ne [int]$draftState.Value) {
  Request 'PATCH' "workflows($($flow.workflowid))" @{statecode=[int]$draftState.Value;statuscode=[int]$draftStatus.Value} | Out-Null
}
Request 'DELETE' "workflows($($flow.workflowid))" | Out-Null
$remaining = @((Request 'GET' "workflows?`$select=workflowid&`$filter=name eq '$escapedName'").value)
if ($remaining.Count) { throw 'O Flow continuou presente após a exclusão.' }
Write-Host '[remove-legacy-flow] Flow removido. Connection references compartilhadas foram preservadas.'
