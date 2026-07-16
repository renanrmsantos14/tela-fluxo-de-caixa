param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [string]$SolutionUniqueName = 'appbetinhos',
  [string]$RoleName = 'Fluxo de Caixa - Operador',
  [switch]$DeviceCode
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
function Step($message) { Write-Host "[provision-security] $(Clean-Text $message)" }
function Token($url, [switch]$UseDeviceCode) {
  if (-not (Get-Module -ListAvailable MSAL.PS)) { throw 'MSAL.PS não encontrado. Instale: Install-Module MSAL.PS -Scope CurrentUser' }
  Import-Module MSAL.PS -ErrorAction Stop
  $client = New-MsalClientApplication -ClientId '51f81489-12ee-4a9e-aaae-a2591f45987d' -TenantId 'organizations' -RedirectUri ([Uri]'http://localhost')
  Enable-MsalTokenCacheOnDisk -PublicClientApplication $client | Out-Null
  try { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Silent).AccessToken }
  catch { if ($UseDeviceCode) { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -DeviceCode).AccessToken }; return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Interactive).AccessToken }
}
function Request($method, $path, $body = $null, $requestHeaders = $headers) {
  $arguments = @{Method=$method;Uri="$base/$path";Headers=$requestHeaders}
  if ($null -ne $body) { $arguments.ContentType='application/json; charset=utf-8'; $arguments.Body=($body | ConvertTo-Json -Depth 15) }
  return Invoke-RestMethod @arguments
}

$url = $EnvironmentUrl.TrimEnd('/')
$base = "$url/api/data/v9.2"
$token = Token $url $DeviceCode
$headers = @{Authorization="Bearer $token";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0';Prefer='return=representation';'MSCRM.SolutionUniqueName'=$SolutionUniqueName}
$who = Request 'GET' 'WhoAmI'
$businessUnitId = [string]$who.BusinessUnitId
$escapedRole = $RoleName.Replace("'", "''")
$existing = @((Request 'GET' "roles?`$select=roleid,name&`$filter=name eq '$escapedRole' and _businessunitid_value eq $businessUnitId").value)
if ($existing.Count -gt 1) { throw "Mais de um papel '$RoleName' foi encontrado na unidade raiz." }
if ($existing.Count -eq 1) {
  $roleId = [string]$existing[0].roleid
  Step "exists role $RoleName ($roleId)"
} else {
  Step "create role $RoleName"
  $created = Request 'POST' 'roles' @{name=$RoleName;'businessunitid@odata.bind'="/businessunits($businessUnitId)"}
  $roleId = [string]$created.roleid
  if (-not $roleId) { throw 'Dataverse não retornou roleid ao criar o papel.' }
}

$tables = @(
  'cr40f_fluxocaixalancamento',
  'cr40f_fluxocaixaimportacao',
  'cr40f_fluxocaixaconta',
  'cr40f_fluxocaixacategoria',
  'cr40f_fluxocaixarecorrencia',
  'cr40f_fluxocaixacontraparte',
  'cr40f_fluxocaixaregra',
  'cr40f_fluxocaixaferiado',
  'cr40f_fluxocaixaconfiguracao',
  'cr40f_fluxocaixaevento'
)
$allowedTypes = @('Create','Read','Write','Delete','Append','AppendTo')
$privileges = @()
foreach ($table in $tables) {
  $metadata = Request 'GET' "EntityDefinitions(LogicalName='$table')?`$select=LogicalName,Privileges"
  $tablePrivileges = @($metadata.Privileges | Where-Object { $allowedTypes -contains [string]$_.PrivilegeType })
  if ($tablePrivileges.Count -ne $allowedTypes.Count) { throw "Metadata de privilégios incompleta para ${table}: $($tablePrivileges.PrivilegeType -join ', ')" }
  foreach ($privilege in $tablePrivileges) {
    if (-not $privilege.CanBeGlobal) { throw "Privilégio sem profundidade Global: $($privilege.Name)" }
    $privileges += @{Depth='Global';PrivilegeId=[string]$privilege.PrivilegeId;BusinessUnitId=$businessUnitId;PrivilegeName=[string]$privilege.Name}
  }
}
$favorecidoMetadata = Request 'GET' "EntityDefinitions(LogicalName='cr40f_terceirofavorecido')?`$select=LogicalName,Privileges"
$favorecidoRead = @($favorecidoMetadata.Privileges | Where-Object { [string]$_.PrivilegeType -eq 'Read' })
if ($favorecidoRead.Count -ne 1 -or -not $favorecidoRead[0].CanBeGlobal) { throw 'Privilegio global de leitura do Terceiro Favorecido nao encontrado.' }
$privileges += @{Depth='Global';PrivilegeId=[string]$favorecidoRead[0].PrivilegeId;BusinessUnitId=$businessUnitId;PrivilegeName=[string]$favorecidoRead[0].Name}
Step "apply $($privileges.Count) table privileges"
Request 'POST' "roles($roleId)/Microsoft.Dynamics.CRM.AddPrivilegesRole" @{Privileges=$privileges} | Out-Null

$solution = @((Request 'GET' "solutions?`$select=solutionid&`$filter=uniquename eq '$SolutionUniqueName'").value)
if ($solution.Count -ne 1) { throw "Solução não encontrada: $SolutionUniqueName" }
$solutionId = [string]$solution[0].solutionid
$component = @((Request 'GET' "solutioncomponents?`$select=solutioncomponentid,componenttype&`$filter=_solutionid_value eq $solutionId and objectid eq $roleId").value)
if (-not $component.Count) {
  $formattedHeaders = @{}; foreach ($key in $headers.Keys) { $formattedHeaders[$key] = $headers[$key] }; $formattedHeaders.Prefer='odata.include-annotations="OData.Community.Display.V1.FormattedValue"'
  $types = @((Request 'GET' "solutioncomponents?`$select=componenttype&`$filter=_solutionid_value eq $solutionId" $null $formattedHeaders).value)
  $roleType = $types | Where-Object { [string]$_['componenttype@OData.Community.Display.V1.FormattedValue'] -match 'Security Role|Função de Segurança|Função de segurança' } | Select-Object -First 1
  if (-not $roleType) { throw 'Não foi possível obter o componenttype de Security Role pela metadata formatada da solução.' }
  Step 'attach role to solution'
  Request 'POST' 'AddSolutionComponent' @{ComponentId=$roleId;ComponentType=[int]$roleType.componenttype;SolutionUniqueName=$SolutionUniqueName;AddRequiredComponents=$false;DoNotIncludeSubcomponents=$false;IncludedComponentSettingsValues=$null} | Out-Null
}
Step "ok. role=$roleId privileges=$($privileges.Count)"
