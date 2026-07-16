param(
  [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
  [string]$SolutionUniqueName = 'appbetinhos',
  [switch]$DeviceCode,
  [switch]$WhatIf
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
function Step($message) { Write-Host "[provision-dataverse] $(Clean-Text $message)" }
function Labels($text) { return @{LocalizedLabels=@(@{Label=(Clean-Text $text);LanguageCode=1046})} }
function Token($url, [switch]$UseDeviceCode) {
  if (-not (Get-Module -ListAvailable MSAL.PS)) { throw 'MSAL.PS não encontrado. Instale: Install-Module MSAL.PS -Scope CurrentUser' }
  Import-Module MSAL.PS -ErrorAction Stop
  $client = New-MsalClientApplication -ClientId '51f81489-12ee-4a9e-aaae-a2591f45987d' -TenantId 'organizations' -RedirectUri ([Uri]'http://localhost')
  Enable-MsalTokenCacheOnDisk -PublicClientApplication $client | Out-Null
  $scope = "$url/user_impersonation"
  try { return (Get-MsalToken -PublicClientApplication $client -Scopes $scope -Silent).AccessToken } catch { if ($UseDeviceCode) { return (Get-MsalToken -PublicClientApplication $client -Scopes $scope -DeviceCode).AccessToken }; return (Get-MsalToken -PublicClientApplication $client -Scopes $scope -Interactive).AccessToken }
}
function Text($name, $label, $length = 500) { return @{'@odata.type'='Microsoft.Dynamics.CRM.StringAttributeMetadata';SchemaName=$name;DisplayName=(Labels $label);RequiredLevel=@{Value='None'};MaxLength=$length} }
function DateField($name, $label) { return @{'@odata.type'='Microsoft.Dynamics.CRM.DateTimeAttributeMetadata';SchemaName=$name;DisplayName=(Labels $label);RequiredLevel=@{Value='None'};Format='DateOnly'} }
function Money($name, $label) { return @{'@odata.type'='Microsoft.Dynamics.CRM.MoneyAttributeMetadata';SchemaName=$name;DisplayName=(Labels $label);RequiredLevel=@{Value='None'};MinValue=-1000000000;MaxValue=1000000000;Precision=2} }
function FileField($name, $label) { return @{'@odata.type'='Microsoft.Dynamics.CRM.FileAttributeMetadata';SchemaName=$name;DisplayName=(Labels $label);RequiredLevel=@{Value='None'};MaxSizeInKB=10240} }
function Exists($base, $headers, $logicalName) { return (Invoke-RestMethod -Method Get -Uri "$base/EntityDefinitions?`$select=LogicalName&`$filter=LogicalName eq '$logicalName'" -Headers $headers).value.Count -gt 0 }
function Attribute-Exists($base, $headers, $table, $logicalName) { return (Invoke-RestMethod -Method Get -Uri "$base/EntityDefinitions(LogicalName='$table')/Attributes?`$select=LogicalName&`$filter=LogicalName eq '$logicalName'" -Headers $headers).value.Count -gt 0 }
function Ensure-Attribute($base, $headers, $table, $attribute) {
  $logicalName = $attribute.SchemaName.ToLowerInvariant()
  if (Attribute-Exists $base $headers $table $logicalName) { Step "exists attribute $table.$logicalName"; return }
  Step "create attribute $table.$logicalName"; if ($WhatIf) { return }
  Invoke-RestMethod -Method Post -Uri "$base/EntityDefinitions(LogicalName='$table')/Attributes" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ($attribute | ConvertTo-Json -Depth 12) | Out-Null
}
function Add-Table($base, $headers, $definition) {
  if (Exists $base $headers $definition.LogicalName) { Step "exists $($definition.LogicalName)"; return }
  Step "create $($definition.LogicalName)"; if ($WhatIf) { return }
  $createHeaders = @{}; foreach ($key in $headers.Keys) { $createHeaders[$key] = $headers[$key] }; $createHeaders.Prefer = 'return=representation'; $body = $definition | ConvertTo-Json -Depth 12
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    try { Invoke-WebRequest -Method Post -Uri "$base/EntityDefinitions" -Headers $createHeaders -ContentType 'application/json; charset=utf-8' -Body $body | Out-Null; Step "created $($definition.LogicalName)"; return }
    catch {
      # The WebException message is generic; Dataverse puts the actionable lock code in ErrorDetails.
      $detail = "$($_.Exception.Message) $($_.ErrorDetails.Message) $($_ | Out-String)"
      if ($detail -notmatch 'CustomizationLockException|0x80071151' -or $attempt -eq 8) { throw }
      Step "customization lock; retry $attempt/8"
      Start-Sleep -Seconds 5
    }
  }
}
function Ensure-Key($base, $headers, $table, $schemaName, $displayName, $attributes) {
  if ($WhatIf) { Step "skip alternate key $schemaName in WhatIf"; return }
  $path = "$base/EntityDefinitions(LogicalName='$table')/Keys"
  $keys = Invoke-RestMethod -Method Get -Uri $path -Headers $headers
  if (@($keys.value | Where-Object { $_.SchemaName -eq $schemaName }).Count -gt 0) { Step "exists alternate key $schemaName"; return }
  Step "create alternate key $schemaName"
  Invoke-RestMethod -Method Post -Uri $path -Headers $headers -ContentType 'application/json; charset=utf-8' -Body (@{'@odata.type'='Microsoft.Dynamics.CRM.EntityKeyMetadata';SchemaName=$schemaName;DisplayName=(Labels $displayName);KeyAttributes=@($attributes)} | ConvertTo-Json -Depth 8) | Out-Null
}
function Ensure-Relationship($base, $headers, $schemaName, $referenced, $referencing, $lookupSchema, $lookupLabel) {
  $escaped = $schemaName.Replace("'", "''")
  $existing = Invoke-RestMethod -Method Get -Uri "$base/RelationshipDefinitions?`$select=SchemaName&`$filter=SchemaName eq '$escaped'" -Headers $headers
  if (@($existing.value).Count -gt 0) { Step "exists relationship $schemaName"; return }
  Step "create relationship $schemaName"; if ($WhatIf) { return }
  $body = @{
    '@odata.type'='Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata'
    SchemaName=$schemaName
    ReferencedEntity=$referenced
    ReferencingEntity=$referencing
    Lookup=@{'@odata.type'='Microsoft.Dynamics.CRM.LookupAttributeMetadata';SchemaName=$lookupSchema;DisplayName=(Labels $lookupLabel);RequiredLevel=@{Value='None'}}
    CascadeConfiguration=@{Assign='NoCascade';Delete='Restrict';Merge='NoCascade';Reparent='NoCascade';Share='NoCascade';Unshare='NoCascade'}
  }
  Invoke-RestMethod -Method Post -Uri "$base/RelationshipDefinitions" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ($body | ConvertTo-Json -Depth 12) | Out-Null
}
$base = "$($EnvironmentUrl.TrimEnd('/'))/api/data/v9.2"; Step 'auth'; $token = Token $EnvironmentUrl $DeviceCode
$headers = @{Authorization="Bearer $token";Accept='application/json';'OData-MaxVersion'='4.0';'OData-Version'='4.0';'MSCRM.SolutionUniqueName'=$SolutionUniqueName}
$tables = @(
  @{LogicalName='cr40f_fluxocaixalancamento';SchemaName='cr40f_FluxoCaixaLancamento';Display='Lançamento de fluxo de caixa';Plural='Lançamentos de fluxo de caixa';IsOptimisticConcurrencyEnabled=$true;Attributes=@((Text 'cr40f_name' 'Nome' 200),(DateField 'cr40f_data' 'Data financeira'),(Money 'cr40f_valor' 'Valor'),(Text 'cr40f_categoria' 'Categoria' 150),(Text 'cr40f_grupo' 'Grupo' 150),(Text 'cr40f_origem' 'Origem' 50),(Text 'cr40f_tipo' 'Tipo' 30),(Text 'cr40f_natureza' 'Natureza' 30),(Text 'cr40f_status' 'Status' 30),(Text 'cr40f_conta' 'Conta bancária' 150),(Text 'cr40f_contraparte' 'Contraparte legada' 200),(Text 'cr40f_chavetransacao' 'Chave da transação' 500),(Text 'cr40f_origemid' 'ID da origem' 50),(Text 'cr40f_conciliadocomid' 'ID do lançamento conciliado' 50),(Text 'cr40f_importacaoid' 'ID da importação OFX' 50),(Text 'cr40f_fitid' 'FITID' 200),(Text 'cr40f_descricaooriginal' 'Descrição original' 500),(DateField 'cr40f_dataoriginal' 'Data original'))},
  @{LogicalName='cr40f_fluxocaixaimportacao';SchemaName='cr40f_FluxoCaixaImportacao';Display='Importação OFX';Plural='Importações OFX';Attributes=@((Text 'cr40f_name' 'Nome' 200),(Text 'cr40f_fingerprint' 'Hash do arquivo' 128),(Text 'cr40f_conta' 'Conta bancária' 150),(Text 'cr40f_status' 'Status' 30),(FileField 'cr40f_arquivoofx' 'Arquivo OFX original'))},
  @{LogicalName='cr40f_fluxocaixaconta';SchemaName='cr40f_FluxoCaixaConta';Display='Conta de fluxo de caixa';Plural='Contas de fluxo de caixa';Attributes=@((Text 'cr40f_name' 'Nome' 150),(Text 'cr40f_banco' 'Banco' 120),(Text 'cr40f_identificador' 'Identificador OFX' 150))},
  @{LogicalName='cr40f_fluxocaixacategoria';SchemaName='cr40f_FluxoCaixaCategoria';Display='Categoria de fluxo de caixa';Plural='Categorias de fluxo de caixa';Attributes=@((Text 'cr40f_name' 'Nome' 150),(Text 'cr40f_grupo' 'Grupo' 150),(Text 'cr40f_natureza' 'Natureza' 30))},
  @{LogicalName='cr40f_fluxocaixarecorrencia';SchemaName='cr40f_FluxoCaixaRecorrencia';Display='Recorrência de fluxo de caixa';Plural='Recorrências de fluxo de caixa';Attributes=@((Text 'cr40f_name' 'Nome' 200),(Money 'cr40f_valor' 'Valor'),(Text 'cr40f_categoria' 'Categoria' 150),(Text 'cr40f_natureza' 'Natureza' 30),(Text 'cr40f_frequencia' 'Frequência' 30),(Text 'cr40f_intervalodias' 'Intervalo customizado em dias' 12),(Text 'cr40f_ajustevencimento' 'Ajuste de vencimento' 20),(DateField 'cr40f_inicio' 'Início'),(DateField 'cr40f_fim' 'Fim'))},
  @{LogicalName='cr40f_fluxocaixacontraparte';SchemaName='cr40f_FluxoCaixaContraparte';Display='Contraparte financeira';Plural='Contrapartes financeiras';Attributes=@((Text 'cr40f_name' 'Nome' 200),(Text 'cr40f_documento' 'Documento' 40))},
  @{LogicalName='cr40f_fluxocaixaregra';SchemaName='cr40f_FluxoCaixaRegra';Display='Regra de fluxo de caixa';Plural='Regras de fluxo de caixa';Attributes=@((Text 'cr40f_name' 'Nome' 200),(Text 'cr40f_expressao' 'Expressão' 500),(Text 'cr40f_categoria' 'Categoria sugerida' 150))},
  @{LogicalName='cr40f_fluxocaixaferiado';SchemaName='cr40f_FluxoCaixaFeriado';Display='Feriado financeiro';Plural='Feriados financeiros';Attributes=@((Text 'cr40f_name' 'Nome' 150),(DateField 'cr40f_data' 'Data'))},
  @{LogicalName='cr40f_fluxocaixaconfiguracao';SchemaName='cr40f_FluxoCaixaConfiguracao';Display='Configuração de fluxo de caixa';Plural='Configurações de fluxo de caixa';Attributes=@((Text 'cr40f_name' 'Nome' 150),(Text 'cr40f_entidadeop' 'Entidade OP' 150),(Text 'cr40f_entitysetop' 'Entity set OP' 150),(Text 'cr40f_campoidop' 'Campo ID OP' 150),(Text 'cr40f_camponomeop' 'Campo nome OP' 150),(Text 'cr40f_campovalorop' 'Campo valor OP' 150),(Text 'cr40f_campodataop' 'Campo data OP' 150),(Text 'cr40f_campostatusop' 'Campo status OP' 150),(Text 'cr40f_valorativoop' 'Valor ativo OP' 150),(Text 'cr40f_categoriaop' 'Categoria padrão OP' 150),(Text 'cr40f_campocontraparteop' 'Campo contraparte OP' 150),(Text 'cr40f_destinatariosalerta' 'Destinatários de alerta' 1000))},
  @{LogicalName='cr40f_fluxocaixaevento';SchemaName='cr40f_FluxoCaixaEvento';Display='Evento de auditoria do fluxo';Plural='Eventos de auditoria do fluxo';Attributes=@((Text 'cr40f_name' 'Nome' 200),(Text 'cr40f_acao' 'Ação' 100),(Text 'cr40f_detalhe' 'Detalhe' 2000),(DateField 'cr40f_data' 'Data do evento'))}
)
foreach ($table in $tables) { $definition = @{'@odata.type'='Microsoft.Dynamics.CRM.EntityMetadata';LogicalName=$table.LogicalName;SchemaName=$table.SchemaName;DisplayName=(Labels $table.Display);DisplayCollectionName=(Labels $table.Plural);OwnershipType='UserOwned';HasNotes=$false;HasActivities=$false;IsActivity=$false;PrimaryNameAttribute='cr40f_name';Attributes=$table.Attributes}; $primary = @($definition.Attributes | Where-Object { $_.SchemaName -eq 'cr40f_name' })[0]; if ($null -eq $primary) { throw "Tabela sem atributo principal cr40f_name: $($table.LogicalName)" }; $primary.IsPrimaryName = $true; if ($table.ContainsKey('IsOptimisticConcurrencyEnabled')) { $definition.IsOptimisticConcurrencyEnabled = $table.IsOptimisticConcurrencyEnabled }; Add-Table $base $headers $definition }
foreach ($attribute in @(
  @{Table='cr40f_fluxocaixalancamento';Definition=(Text 'cr40f_contraparte' 'Contraparte legada' 200)},
  @{Table='cr40f_fluxocaixarecorrencia';Definition=(Text 'cr40f_ajustevencimento' 'Ajuste de vencimento' 20)},
  @{Table='cr40f_fluxocaixaconfiguracao';Definition=(Text 'cr40f_camponomeop' 'Campo nome OP' 150)},
  @{Table='cr40f_fluxocaixaconfiguracao';Definition=(Text 'cr40f_campostatusop' 'Campo status OP' 150)},
  @{Table='cr40f_fluxocaixaconfiguracao';Definition=(Text 'cr40f_valorativoop' 'Valor ativo OP' 150)},
  @{Table='cr40f_fluxocaixaconfiguracao';Definition=(Text 'cr40f_categoriaop' 'Categoria padrão OP' 150)},
  @{Table='cr40f_fluxocaixaconfiguracao';Definition=(Text 'cr40f_campocontraparteop' 'Campo contraparte OP' 150)}
)) { Ensure-Attribute $base $headers $attribute.Table $attribute.Definition }
foreach ($relationship in @(
  @{Schema='cr40f_FluxoConta_Lancamentos';Referenced='cr40f_fluxocaixaconta';Referencing='cr40f_fluxocaixalancamento';Lookup='cr40f_ContaRef';Label='Conta'},
  @{Schema='cr40f_FluxoCategoria_Lancamentos';Referenced='cr40f_fluxocaixacategoria';Referencing='cr40f_fluxocaixalancamento';Lookup='cr40f_CategoriaRef';Label='Categoria'},
  @{Schema='cr40f_FluxoContraparte_Lancamentos';Referenced='cr40f_fluxocaixacontraparte';Referencing='cr40f_fluxocaixalancamento';Lookup='cr40f_ContraparteRef';Label='Contraparte'},
  @{Schema='cr40f_FluxoImportacao_Lancamentos';Referenced='cr40f_fluxocaixaimportacao';Referencing='cr40f_fluxocaixalancamento';Lookup='cr40f_ImportacaoRef';Label='Importação OFX'},
  @{Schema='cr40f_FluxoLancamento_Conciliados';Referenced='cr40f_fluxocaixalancamento';Referencing='cr40f_fluxocaixalancamento';Lookup='cr40f_ConciliadoCom';Label='Conciliado com'},
  @{Schema='cr40f_FluxoConta_Importacoes';Referenced='cr40f_fluxocaixaconta';Referencing='cr40f_fluxocaixaimportacao';Lookup='cr40f_ContaRef';Label='Conta'},
  @{Schema='cr40f_FluxoCategoria_Recorrencias';Referenced='cr40f_fluxocaixacategoria';Referencing='cr40f_fluxocaixarecorrencia';Lookup='cr40f_CategoriaRef';Label='Categoria'},
  @{Schema='cr40f_FluxoContraparte_Recorrencias';Referenced='cr40f_fluxocaixacontraparte';Referencing='cr40f_fluxocaixarecorrencia';Lookup='cr40f_ContraparteRef';Label='Contraparte'},
  @{Schema='cr40f_FluxoCategoria_Regras';Referenced='cr40f_fluxocaixacategoria';Referencing='cr40f_fluxocaixaregra';Lookup='cr40f_CategoriaRef';Label='Categoria'},
  @{Schema='cr40f_FluxoCategoria_Configuracao';Referenced='cr40f_fluxocaixacategoria';Referencing='cr40f_fluxocaixaconfiguracao';Lookup='cr40f_CategoriaOpRef';Label='Categoria padrão OP'}
)) { Ensure-Relationship $base $headers $relationship.Schema $relationship.Referenced $relationship.Referencing $relationship.Lookup $relationship.Label }
Ensure-Key $base $headers 'cr40f_fluxocaixalancamento' 'cr40f_FluxoCaixaLancamento_ChaveTransacao' 'Chave única de transação OFX' @('cr40f_chavetransacao')
Ensure-Key $base $headers 'cr40f_fluxocaixaimportacao' 'cr40f_FluxoCaixaImportacao_Fingerprint' 'Hash único do arquivo OFX' @('cr40f_fingerprint')
Step 'ok. Configure permissões e mapeamento de OP em cr40f_fluxocaixaconfiguracao.'
