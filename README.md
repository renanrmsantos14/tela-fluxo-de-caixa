# Fechamento bancário assistido V0

Webresource React/TypeScript para classificar movimentações bancárias realizadas.
Funciona no model-driven app por `parent.Xrm`, em URL direta autenticada e em
localhost com dados de demonstração.

## Fluxo do usuário

1. Cadastre as contas bancárias.
2. Importe as categorias da DRE por `.xlsx` com `Grupo`, `Categoria` e `Natureza`.
3. Importe o OFX.
4. Revise destinatário e categoria sugeridos.
5. Valide individualmente ou em lote.
6. Consulte entradas, saídas e resultado líquido do mês.

Somente movimentações `validated` entram no fechamento. Transferências internas
são neutras. Regras apenas sugerem classificações futuras.

## Ambiente

Copie `.env.example` para `.env.local`:

```dotenv
DATAVERSE_ENVIRONMENT_URL=https://suaorg.crm2.dynamics.com/
DATAVERSE_SOLUTION_UNIQUE_NAME=appbetinhos
DATAVERSE_WEBRESOURCE_NAME=cr40f_TelaFluxoDeCaixa.html
```

Nenhuma URL de organização ou connection reference é compilada no HTML.

## Comandos

- `npm run dev`: desenvolvimento local com mock.
- `npm run check`: TypeScript, testes, encoding, design, build, Axe e HTML único.
- `npm run provision:dataverse`: cria/atualiza tabelas, campos, lookups e chaves.
- `npm run provision:security`: provisiona o papel operacional.
- `npm run remove:legacy-flow`: remove somente o Flow financeiro legado.
- `npm run reset:v0-test-data`: faz backup e remove os dados de teste autorizados.
- `npm run push`: gera e publica `cr40f_TelaFluxoDeCaixa.html`.
- `npm run setup:environment`: prepara um ambiente e publica o webresource.

O reset não exclui tabelas, soluções ou connection references compartilhadas.

## Categorias da DRE

A planilha deve ter as colunas:

| Grupo | Categoria | Natureza |
| --- | --- | --- |
| Custo operacional | Combustível | Saída |

Naturezas aceitas: `Entrada`, `Saída` e `Transferência`. O arquivo inteiro é
rejeitado antes da gravação se qualquer linha estiver inválida.

## OFX e integridade

- SGML 1.x e XML 2.x.
- UTF-8 estrito antes de Windows-1252.
- Preserva NAME, MEMO, TRNTYPE, CHECKNUM, REFNUM, FITID, data e valor.
- Chave preferencial: conta + FITID.
- Importação, validação em lote e reversão são atômicas.
- ETags protegem contra validação concorrente.
- Mobile é somente leitura.
