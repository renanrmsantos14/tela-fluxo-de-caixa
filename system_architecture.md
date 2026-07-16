# Arquitetura do fechamento bancário

## Terceiros favorecidos

Fonte única: `cr40f_terceirofavorecido`, compartilhada com o webresource Tela
Pagamento de Fornecedores.

- O app consulta `EntitySetName`, chave primária, nome primário e Choice de
  status pela metadata do ambiente.
- Somente o valor rotulado como `Ativo` é listado.
- Lançamentos e regras usam o lookup `cr40f_TerceiroFavorecidoRef`.
- O módulo de fluxo não cria nem edita favorecidos; manutenção pertence ao app
  irmão.

## Categorias

`cr40f_fluxocaixacategoria` representa a árvore de dois níveis:

- `cr40f_grupo`: grupo da DRE;
- `cr40f_name`: categoria;
- `cr40f_natureza`: inflow, outflow ou transfer.

A chave alternativa é Grupo + Categoria. Exclusão é restrita quando existem
lançamentos ou regras relacionados.

## Regras

`cr40f_fluxocaixaregra` guarda padrão textual, direção, conta opcional,
categoria obrigatória, favorecido opcional e status ativo. Regras sugerem;
somente validação humana altera o lançamento para `validated`.

## Build

O build usa diretório temporário único por processo e troca atômica do HTML
final. Builds concorrentes não removem `dist/cr40f_TelaFluxoDeCaixa.html`.
