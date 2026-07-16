# Cloud Flow — Fluxo de Caixa

O arquivo `fluxo-caixa-diario.json` é a definição versionada do Flow. O script
`provision-flow.ps1` injeta as connection references do ambiente de destino,
cria ou atualiza o processo dentro da solução e o ativa.

Configuração:

1. Copie `.env.example` para `.env.local`.
2. Informe a URL, a solução e, quando houver ambiguidade, os nomes lógicos das
   connection references de Dataverse e Office 365 Outlook.
3. Execute `npm run provision:flow`.

O Flow:

- executa diariamente às 07:00 no fuso de Brasília;
- lê o mapeamento de OP salvo pelo app, sem nomes lógicos fixos da tabela fonte;
- processa somente OPs ativas com valor preenchido;
- cria, atualiza e ignora previsões abertas, preservando conciliadas;
- registra execução, bloqueio de configuração e erro na auditoria;
- envia alerta de vencidos ou semana negativa;
- envia às segundas-feiras o resumo consolidado das próximas 26 semanas.

O app e o Flow compartilham as mesmas tabelas e a mesma configuração Dataverse.
Nenhuma URL de organização ou connection reference fica gravada na definição.
