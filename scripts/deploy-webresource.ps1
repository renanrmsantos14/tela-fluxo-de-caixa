param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [string]$WebResourceName = 'cr40f_TelaFluxoDeCaixa.html',
  [string]$DisplayName = 'Tela - Fluxo de Caixa',
  [string]$SolutionUniqueName = 'appbetinhos',
  [string]$FilePath = 'dist/cr40f_TelaFluxoDeCaixa.html',
  [switch]$DeviceCode,
  [switch]$NoPublish
)
$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
function Step($message) { Write-Host "[deploy-webresource] $message" }
function OData($value) { $value.Replace("'", "''") }
function Property($object, $name) { if ($null -ne $object -and $null -ne $object.PSObject.Properties[$name]) { return $object.PSObject.Properties[$name].Value }; return $null }
function Token($url, [switch]$UseDeviceCode) {
  if (-not (Get-Module -ListAvailable MSAL.PS)) { throw 'MSAL.PS não encontrado. Instale: Install-Module MSAL.PS -Scope CurrentUser' }
  Import-Module MSAL.PS -ErrorAction Stop
  $client = New-MsalClientApplication -ClientId '51f81489-12ee-4a9e-aaae-a2591f45987d' -TenantId 'organizations' -RedirectUri ([Uri]'http://localhost')
  Enable-MsalTokenCacheOnDisk -PublicClientApplication $client | Out-Null
  $scope = "$url/user_impersonation"
  try { return (Get-MsalToken -PublicClientApplication $client -Scopes $scope -Silent).AccessToken } catch { if ($UseDeviceCode) { return (Get-MsalToken -PublicClientApplication $client -Scopes $scope -DeviceCode).AccessToken }; return (Get-MsalToken -PublicClientApplication $client -Scopes $scope -Interactive).AccessToken }
}
if ($WebResourceName -notmatch '^cr40f_Tela') { throw "Nome inválido: $WebResourceName. Use prefixo cr40f_Tela." }
$root = Resolve-Path (Join-Path $PSScriptRoot '..'); Set-Location $root; $base = "$($EnvironmentUrl.TrimEnd('/'))/api/data/v9.2"
Step 'build'; npm run build; if ($LASTEXITCODE -ne 0) { throw 'Build falhou.' }
$content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content -LiteralPath (Resolve-Path $FilePath) -Raw -Encoding UTF8)))
Step 'auth'; $token = Token $EnvironmentUrl $DeviceCode; if ([string]::IsNullOrWhiteSpace($token)) { throw 'Token MSAL vazio.' }
$headers = @{Authorization="Bearer $token";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0';'MSCRM.SolutionUniqueName'=$SolutionUniqueName}
$solution = Invoke-RestMethod -Method Get -Uri "$base/solutions?`$select=solutionid&`$filter=uniquename eq '$(OData $SolutionUniqueName)'" -Headers $headers
$solutionItems = @($solution.value | Where-Object { $null -ne $_ })
if ($solutionItems.Count -ne 1) { throw "Solução ausente ou ambígua: $SolutionUniqueName" }
Step "lookup $WebResourceName"; $found = Invoke-RestMethod -Method Get -Uri "$base/webresourceset?`$select=webresourceid&`$filter=name eq '$(OData $WebResourceName)'" -Headers $headers
$foundItems = @($found.value | Where-Object { $null -ne $_ })
if ($foundItems.Count -gt 1) { throw "Mais de um webresource: $WebResourceName" }
$id = if ($foundItems.Count -eq 1) { Property $foundItems[0] 'webresourceid' } else { $null }
if (-not $id) {
  Step 'create'; $createHeaders = @{}; foreach ($key in $headers.Keys) { $createHeaders[$key] = $headers[$key] }; $createHeaders.Prefer = 'return=representation'; $response = Invoke-WebRequest -Method Post -Uri "$base/webresourceset" -Headers $createHeaders -ContentType 'application/json; charset=utf-8' -Body (@{name=$WebResourceName;displayname=$DisplayName;webresourcetype=1;content=$content}|ConvertTo-Json)
  try { $id = (ConvertFrom-Json $response.Content).webresourceid } catch {}
  if (-not $id -and $response.Headers['OData-EntityId'] -match '\(([0-9a-f-]{36})\)$') { $id = $Matches[1] }
  if (-not $id) { $retry = Invoke-RestMethod -Method Get -Uri "$base/webresourceset?`$select=webresourceid&`$filter=name eq '$(OData $WebResourceName)'" -Headers $headers; $retryItems = @($retry.value | Where-Object { $null -ne $_ }); if ($retryItems.Count -eq 1) { $id = Property $retryItems[0] 'webresourceid' } }
}
if (-not $id) { throw "ID não retornado para $WebResourceName" }
Step "patch $id"; Invoke-RestMethod -Method Patch -Uri "$base/webresourceset($id)" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body (@{content=$content}|ConvertTo-Json) | Out-Null
$component = Invoke-RestMethod -Method Get -Uri "$base/solutioncomponents?`$select=solutioncomponentid&`$filter=_solutionid_value eq $($solutionItems[0].solutionid) and objectid eq $id and componenttype eq 61" -Headers $headers
if (@($component.value).Count -eq 0) { Step "add to $SolutionUniqueName"; Invoke-RestMethod -Method Post -Uri "$base/AddSolutionComponent" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body (@{ComponentId=$id;ComponentType=61;SolutionUniqueName=$SolutionUniqueName;AddRequiredComponents=$false;DoNotIncludeSubcomponents=$true}|ConvertTo-Json) | Out-Null }
if (-not $NoPublish) { Step "publish $id"; Invoke-RestMethod -Method Post -Uri "$base/PublishXml" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body (@{ParameterXml="<importexportxml><webresources><webresource>$id</webresource></webresources></importexportxml>"}|ConvertTo-Json) | Out-Null }
Step "ok $WebResourceName | solution=$SolutionUniqueName"
