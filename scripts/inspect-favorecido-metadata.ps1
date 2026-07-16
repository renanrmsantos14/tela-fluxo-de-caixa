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

$url = $EnvironmentUrl.TrimEnd('/')
$base = "$url/api/data/v9.2"
$headers = @{Authorization="Bearer $(Token $url $DeviceCode)";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0'}
$entity = Invoke-RestMethod -Method Get -Uri "$base/EntityDefinitions(LogicalName='cr40f_terceirofavorecido')?`$select=LogicalName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute" -Headers $headers
$attributes = Invoke-RestMethod -Method Get -Uri "$base/EntityDefinitions(LogicalName='cr40f_terceirofavorecido')/Attributes?`$select=LogicalName,AttributeType,IsValidForRead,IsValidForCreate,IsValidForUpdate" -Headers $headers
$status = Invoke-RestMethod -Method Get -Uri "$base/EntityDefinitions(LogicalName='cr40f_terceirofavorecido')/Attributes(LogicalName='cr40f_status')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?`$select=LogicalName&`$expand=OptionSet" -Headers $headers
$rows = Invoke-RestMethod -Method Get -Uri "$base/$($entity.EntitySetName)?`$select=$($entity.PrimaryIdAttribute),$($entity.PrimaryNameAttribute),cr40f_nomerazaosocial,cr40f_cpfcnpj,cr40f_chavepix,cr40f_status&`$top=5000" -Headers $headers
$relationships = Invoke-RestMethod -Method Get -Uri "$base/RelationshipDefinitions/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?`$select=SchemaName,ReferencingEntity,ReferencingEntityNavigationPropertyName&`$filter=SchemaName eq 'cr40f_Favorecido_FluxoLancamentos' or SchemaName eq 'cr40f_Favorecido_FluxoRegras'" -Headers $headers

$result = @{
  logicalName = $entity.LogicalName
  entitySetName = $entity.EntitySetName
  primaryId = $entity.PrimaryIdAttribute
  primaryName = $entity.PrimaryNameAttribute
  attributes = @($attributes.value | Where-Object { $_.LogicalName -like 'cr40f_*' } | Sort-Object LogicalName | ForEach-Object {
    @{logicalName=$_.LogicalName;type=$_.AttributeType;read=$_.IsValidForRead;create=$_.IsValidForCreate;update=$_.IsValidForUpdate}
  })
  statusOptions = @($status.OptionSet.Options | ForEach-Object {
    @{value=$_.Value;label=$_.Label.UserLocalizedLabel.Label}
  })
  rowCount = @($rows.value).Count
  statusCounts = @($rows.value | Group-Object cr40f_status | ForEach-Object {
    @{value=[int]$_.Name;count=$_.Count}
  })
  relationships = @($relationships.value | ForEach-Object {
    @{schemaName=$_.SchemaName;referencingEntity=$_.ReferencingEntity;navigationProperty=$_.ReferencingEntityNavigationPropertyName}
  })
}
$result | ConvertTo-Json -Depth 10
