# Plano — categorias, regras e terceiros unificados

## Objetivo

Usar `cr40f_terceirofavorecido` como fonte única de destinatários e permitir
CRUD completo de categorias e regras no módulo de fechamento bancário.

## Alterações

- `[MODIFY] src/lib/dataverse.ts`
  - carregar favorecidos ativos por metadata real;
  - gravar lookups para favorecido unificado;
  - adicionar exclusão de registros e CRUD de regras.
- `[MODIFY] scripts/provision-dataverse.ps1`
  - criar lookups de lançamentos e regras para `cr40f_terceirofavorecido`.
- `[MODIFY] src/main.tsx`
  - lista hierárquica Grupo → Categoria;
  - formulários de criação/edição e exclusão protegida;
  - gestão completa de regras;
  - terceiros favorecidos compartilhados em modo leitura.
- `[MODIFY] src/styles.css`
  - árvore compacta, ações contextuais e formulários responsivos.
- `[MODIFY] data/categorias-dre.csv`
  - remover nomes de pessoas cadastradas como categorias.
- `[MODIFY] tests/*`
  - cobrir metadata, payloads, CRUD e proteção de exclusão.

## Validação

- metadata e dados ativos consultados no DEV;
- `npm run check`;
- desktop 1440/1120 e mobile 390;
- smoke Dataverse para categoria, regra e favorecido;
- publicação com conteúdo remoto idêntico;
- commit e push na `main`.
