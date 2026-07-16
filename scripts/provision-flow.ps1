param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [string]$SolutionUniqueName = 'appbetinhos',
  [string]$FlowName = 'Fluxo de Caixa - Sincronização e Alertas',
  [string]$DefinitionPath = '',
  [string]$DataverseConnectionReferenceLogicalName = '',
  [string]$OutlookConnectionReferenceLogicalName = '',
  [switch]$DeviceCode
)
$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ([string]::IsNullOrWhiteSpace($DefinitionPath)) { $DefinitionPath = Join-Path $PSScriptRoot '..\automation\fluxo-caixa-diario.json' }
function Clean-Text($text) {
  $value = [string]$text
  for ($attempt = 0; $attempt -lt 2 -and $value -match '\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\uFFFF]|\u00F0[\u0080-\uFFFF]'; $attempt++) {
    $value = [Text.Encoding]::UTF8.GetString([Text.Encoding]::GetEncoding(1252).GetBytes($value))
  }
  return $value
}
$FlowName = Clean-Text $FlowName
function Step($message) { Write-Host "[provision-flow] $(Clean-Text $message)" }
function Token($url, [switch]$UseDeviceCode) {
  if (-not (Get-Module -ListAvailable MSAL.PS)) { throw 'MSAL.PS não encontrado. Instale: Install-Module MSAL.PS -Scope CurrentUser' }
  Import-Module MSAL.PS -ErrorAction Stop
  $client = New-MsalClientApplication -ClientId '51f81489-12ee-4a9e-aaae-a2591f45987d' -TenantId 'organizations' -RedirectUri ([Uri]'http://localhost')
  Enable-MsalTokenCacheOnDisk -PublicClientApplication $client | Out-Null
  try { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Silent).AccessToken }
  catch { if ($UseDeviceCode) { return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -DeviceCode).AccessToken }; return (Get-MsalToken -PublicClientApplication $client -Scopes "$url/user_impersonation" -Interactive).AccessToken }
}
function Request($method, $path, $body = $null) {
  $arguments = @{Method=$method;Uri="$base/$path";Headers=$headers}
  if ($null -ne $body) { $arguments.ContentType='application/json; charset=utf-8'; $arguments.Body=($body | ConvertTo-Json -Depth 100 -Compress) }
  return Invoke-RestMethod @arguments
}

$url = $EnvironmentUrl.TrimEnd('/')
$base = "$url/api/data/v9.2"
$token = Token $url $DeviceCode
$headers = @{Authorization="Bearer $token";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0';Prefer='return=representation';'MSCRM.SolutionUniqueName'=$SolutionUniqueName}
$definition = Get-Content -LiteralPath (Resolve-Path $DefinitionPath) -Raw -Encoding UTF8 | ConvertFrom-Json
$candidates = @((Request 'GET' "workflows?`$select=workflowid,name,statecode,statuscode,clientdata&`$filter=startswith(name,'Fluxo de Caixa - ')").value)
$existing = @($candidates | Where-Object { (Clean-Text $_.name) -eq $FlowName })
if ($existing.Count -gt 1) { throw "Mais de um Cloud Flow foi encontrado com o nome '$FlowName'." }
$existingDataverseReference=''; $existingOutlookReference=''
if ($existing.Count -eq 1 -and $existing[0].clientdata) {
  try {
    $existingDefinition = $existing[0].clientdata | ConvertFrom-Json
    $existingDataverseReference = [string]$existingDefinition.properties.connectionReferences.shared_commondataserviceforapps.connection.connectionReferenceLogicalName
    $existingOutlookReference = [string]$existingDefinition.properties.connectionReferences.shared_office365.connection.connectionReferenceLogicalName
  } catch {}
}
$solution = @((Request 'GET' "solutions?`$select=solutionid&`$filter=uniquename eq '$SolutionUniqueName'").value)
if ($solution.Count -ne 1) { throw "Solução não encontrada: $SolutionUniqueName" }
$solutionComponentIds = @((Request 'GET' "solutioncomponents?`$select=objectid&`$filter=_solutionid_value eq $($solution[0].solutionid)").value | ForEach-Object { [string]$_.objectid })
$connectionReferences = @((Request 'GET' "connectionreferences?`$select=connectionreferenceid,connectionreferencelogicalname,connectorid,connectionid,statecode").value)
function Resolve-ConnectionReference($logicalName, $preferredLogicalName, $connectorName) {
  if ([string]::IsNullOrWhiteSpace($logicalName) -and -not [string]::IsNullOrWhiteSpace($preferredLogicalName)) { $logicalName=$preferredLogicalName }
  $matches = @($connectionReferences | Where-Object {
    $_.statecode -eq 0 -and $_.connectionid -and $_.connectorid -eq "/providers/Microsoft.PowerApps/apis/$connectorName" -and
    ([string]::IsNullOrWhiteSpace($logicalName) -or $_.connectionreferencelogicalname -eq $logicalName)
  })
  $solutionMatches = @($matches | Where-Object { $solutionComponentIds -contains [string]$_.connectionreferenceid })
  if ($solutionMatches.Count) { $matches = $solutionMatches }
  if ($matches.Count -ne 1) {
    $available = ($matches.connectionreferencelogicalname -join ', ')
    throw "Connection reference $connectorName ausente ou ambígua no ambiente. Informe o nome lógico explicitamente. Encontradas: $available"
  }
  return [string]$matches[0].connectionreferencelogicalname
}
$dataverseReference = Resolve-ConnectionReference $DataverseConnectionReferenceLogicalName $existingDataverseReference 'shared_commondataserviceforapps'
$outlookReference = Resolve-ConnectionReference $OutlookConnectionReferenceLogicalName $existingOutlookReference 'shared_office365'
$definition.properties.connectionReferences.shared_commondataserviceforapps.connection.connectionReferenceLogicalName = $dataverseReference
$definition.properties.connectionReferences.shared_office365.connection.connectionReferenceLogicalName = $outlookReference
$clientData = $definition | ConvertTo-Json -Depth 100 -Compress
function Choice-Value($field, $labelPattern) {
  $metadata = Request 'GET' "EntityDefinitions(LogicalName='workflow')/Attributes(LogicalName='$field')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?`$select=LogicalName&`$expand=OptionSet"
  $labelPattern = Clean-Text $labelPattern
  $option = @($metadata.OptionSet.Options | Where-Object { (Clean-Text $_.Label.UserLocalizedLabel.Label) -match $labelPattern })
  if ($option.Count -ne 1) { throw "Choice workflow.$field não pôde ser resolvido pela metadata: $labelPattern" }
  return [int]$option[0].Value
}
$categoryValue = Choice-Value 'category' 'Fluxo Moderno|Modern Flow'
$typeValue = Choice-Value 'type' 'Definição|Definition'
$scopeValue = Choice-Value 'scope' 'Organização|Organization'
$modeValue = Choice-Value 'mode' 'Segundo Plano|Background'
$runAsValue = Choice-Value 'runas' 'Usuário da Chamada|Calling User'
$modernFlowTypeValue = Choice-Value 'modernflowtype' '^PowerAutomateFlow$'
$stateMetadata = Request 'GET' "EntityDefinitions(LogicalName='workflow')/Attributes(LogicalName='statecode')/Microsoft.Dynamics.CRM.StateAttributeMetadata?`$select=LogicalName&`$expand=OptionSet"
$statusMetadata = Request 'GET' "EntityDefinitions(LogicalName='workflow')/Attributes(LogicalName='statuscode')/Microsoft.Dynamics.CRM.StatusAttributeMetadata?`$select=LogicalName&`$expand=OptionSet"
$draftState = $stateMetadata.OptionSet.Options | Where-Object { $_.InvariantName -eq 'Draft' -or $_.Label.UserLocalizedLabel.Label -match 'Draft|Rascunho' } | Select-Object -First 1
if (-not $draftState) { throw 'Não foi possível obter o statecode Draft do workflow pela metadata.' }
$draftStatus = $statusMetadata.OptionSet.Options | Where-Object { $_.State -eq $draftState.Value } | Select-Object -First 1
$activeState = $stateMetadata.OptionSet.Options | Where-Object { $_.InvariantName -eq 'Activated' -or $_.Label.UserLocalizedLabel.Label -match 'Activated|Ativado' } | Select-Object -First 1
if (-not $activeState) { throw 'Não foi possível obter o statecode Activated do workflow pela metadata.' }
$activeStatus = $statusMetadata.OptionSet.Options | Where-Object { $_.State -eq $activeState.Value } | Select-Object -First 1
if (-not $draftStatus -or -not $activeStatus) { throw 'Não foi possível obter os statuscode Draft/Activated do workflow pela metadata.' }
$body = @{
  name=$FlowName
  category=$categoryValue
  type=$typeValue
  primaryentity='none'
  scope=$scopeValue
  mode=$modeValue
  runas=$runAsValue
  ondemand=$false
  modernflowtype=$modernFlowTypeValue
  clientdata=$clientData
  description=(Clean-Text 'Sincroniza OPs ativas, registra auditoria, envia alertas diários e resumo de 26 semanas às segundas-feiras.')
}
if ($existing.Count) {
  $flowId = [string]$existing[0].workflowid
  if ([int]$existing[0].statecode -eq [int]$activeState.Value) {
    Step 'deactivate existing flow'
    Request 'PATCH' "workflows($flowId)" @{statecode=[int]$draftState.Value;statuscode=[int]$draftStatus.Value} | Out-Null
  }
  Step "update flow $flowId"
  Request 'PATCH' "workflows($flowId)" $body | Out-Null
} else {
  Step 'create flow'
  $created = Request 'POST' 'workflows' $body
  $flowId = [string]$created.workflowid
  if (-not $flowId) { throw 'Dataverse não retornou workflowid ao criar o Cloud Flow.' }
}
Step 'activate flow'
Request 'PATCH' "workflows($flowId)" @{statecode=[int]$activeState.Value;statuscode=[int]$activeStatus.Value} | Out-Null
$component = @((Request 'GET' "solutioncomponents?`$select=solutioncomponentid&`$filter=_solutionid_value eq $($solution[0].solutionid) and objectid eq $flowId").value)
if (-not $component.Count) {
  $formattedHeaders = @{}; foreach ($key in $headers.Keys) { $formattedHeaders[$key] = $headers[$key] }; $formattedHeaders.Prefer='odata.include-annotations="OData.Community.Display.V1.FormattedValue"'
  $previousHeaders = $headers; $headers = $formattedHeaders
  $types = @((Request 'GET' "solutioncomponents?`$select=componenttype&`$filter=_solutionid_value eq $($solution[0].solutionid)").value)
  $headers = $previousHeaders
  $workflowType = $types | Where-Object { [string]$_['componenttype@OData.Community.Display.V1.FormattedValue'] -match 'Workflow|Processo|Process' } | Select-Object -First 1
  if (-not $workflowType) { throw 'Não foi possível obter o componenttype de Workflow pela metadata formatada da solução.' }
  Request 'POST' 'AddSolutionComponent' @{ComponentId=$flowId;ComponentType=[int]$workflowType.componenttype;SolutionUniqueName=$SolutionUniqueName;AddRequiredComponents=$true;DoNotIncludeSubcomponents=$false;IncludedComponentSettingsValues=$null} | Out-Null
}
$live = Request 'GET' "workflows($flowId)?`$select=workflowid,name,statecode,statuscode,clientdata"
if ([int]$live.statecode -ne [int]$activeState.Value -or [int]$live.statuscode -ne [int]$activeStatus.Value) { throw 'Cloud Flow foi criado, mas não ficou ativado.' }
$parsed = $live.clientdata | ConvertFrom-Json
if ($parsed.properties.definition.triggers.Recurrence.recurrence.timeZone -ne 'E. South America Standard Time') { throw 'Fuso do Cloud Flow não foi persistido.' }
if ($parsed.properties.connectionReferences.shared_commondataserviceforapps.connection.connectionReferenceLogicalName -ne $dataverseReference -or $parsed.properties.connectionReferences.shared_office365.connection.connectionReferenceLogicalName -ne $outlookReference) { throw 'Connection references do ambiente não foram persistidas no Cloud Flow.' }
Step "ok. flow=$flowId active=true dataverse=$dataverseReference outlook=$outlookReference"
