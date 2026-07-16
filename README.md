# Fluxo de Caixa V0

Webresource React/TypeScript para Dataverse. Funciona incorporado no
model-driven app por `parent.Xrm`, em URL direta autenticada e em localhost com
dados mock.

## Ambiente

Copie `.env.example` para `.env.local` e ajuste:

```dotenv
DATAVERSE_ENVIRONMENT_URL=https://suaorg.crm2.dynamics.com/
DATAVERSE_SOLUTION_UNIQUE_NAME=appbetinhos
DATAVERSE_WEBRESOURCE_NAME=cr40f_TelaFluxoDeCaixa.html
```

Quando houver mais de uma connection reference ativa para o mesmo conector,
preencha também:

```dotenv
DATAVERSE_CONNECTION_REFERENCE_LOGICAL_NAME=new_sharedcommondataserviceforapps_x
OUTLOOK_CONNECTION_REFERENCE_LOGICAL_NAME=new_sharedoffice365_x
```

Esses valores pertencem ao ambiente. Não são compilados no HTML nem gravados no
template do Flow.

## Comandos

- `npm run dev`: desenvolvimento local com mock.
- `npm run check`: TypeScript, testes, design, build, Axe e HTML único.
- `npm run setup:environment`: provisiona schema, migração, papel, Flow, encoding e webresource.
- `npm run setup:dev`: alias compatível para o mesmo ciclo.
- `npm run smoke:dataverse`: valida importação, duplicidade, edição, conciliação e reversão no ambiente configurado; os registros temporários são removidos.
- `npm run push`: gera e publica `cr40f_TelaFluxoDeCaixa.html`.

## Implantação em outro ambiente

1. Importe ou crie a solução e as connection references de Dataverse e Outlook.
2. Configure `.env.local`.
3. Execute `npm run setup:environment`.
4. Configure o mapeamento de OP no app usando metadata do ambiente.
5. Execute `npm run smoke:dataverse`.

O mapeamento de OP fica bloqueado até entidade, ID, descrição, valor, vencimento,
status ativo e categoria estarem completos. O EntitySet e os campos são
resolvidos pela metadata real do ambiente.
