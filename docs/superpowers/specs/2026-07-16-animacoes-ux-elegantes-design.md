# Design — Animações e UX elegantes

## Objetivo

Elevar a percepção de qualidade do módulo de fechamento bancário sem alterar regras financeiras, estrutura de dados ou identidade visual. O movimento deve orientar, confirmar ações e reduzir mudanças bruscas.

## Direção

- Seguir os tokens e superfícies do design system Pai.
- Usar movimento discreto, rápido e funcional.
- Permitir `transform`, `opacity` e blur leve.
- Limitar animações comuns a 120–220 ms.
- Evitar bounce, parallax, efeitos decorativos e movimento contínuo.
- Não atrasar interação, foco ou navegação por teclado.

## Sistema de movimento

### Curvas

- Entrada: `cubic-bezier(.23, 1, .32, 1)`.
- Movimento entre estados: `cubic-bezier(.77, 0, .175, 1)`.
- Drawer: `cubic-bezier(.32, .72, 0, 1)`.
- Hover e cores: curva `ease`.

### Performance

- Priorizar `transform` e `opacity`.
- Usar blur de 1–2 px apenas em conteúdo pequeno durante crossfade.
- Não animar blur em modal, drawer, tabela, lista longa ou painel completo.
- Não animar largura, altura, margem ou padding.
- Limitar stagger aos primeiros oito itens, com intervalo de 25–35 ms.
- Respeitar `prefers-reduced-motion`.

## Interações

### Navegação

- Conteúdo da página entra com fade e deslocamento vertical de 6 px.
- Navegação lateral e mobile recebe transição curta de cor e indicador ativo.
- Clique mantém resposta imediata com escala de 0,97.

### Cards e indicadores

- Cards interativos sobem no máximo 2 px no hover com sombra moderada.
- Cards meramente informativos não se movimentam.
- KPIs atualizados usam crossfade curto no valor, sem contagem artificial.
- Badges alteram cor e opacidade suavemente.

### Listas

- Linhas recebem realce de hover sem deslocar conteúdo.
- Chevron desloca 2 px para indicar abertura.
- Primeira exibição pode usar stagger curto, sem bloquear interação.
- Empty states entram por fade simples.

### Modais e drawer

- Backdrop usa fade de 150 ms.
- Modal entra com `translateY(10px)`, escala 0,985 e fade em 200 ms.
- Drawer entra lateralmente em 220 ms.
- Saídas duram aproximadamente 150 ms.
- O fechamento visual termina antes da remoção do DOM.
- Foco continua preso e é restaurado no acionador.

### Formulários

- Inputs e selects transitam borda, fundo e sombra de foco em 150 ms.
- Erros aparecem com fade e deslocamento de 4 px.
- Botões de operação preservam largura ao trocar ícone por spinner.
- Ações concluídas recebem confirmação visual sem bloquear a próxima ação.

### Toasts

- Entrada por fade e deslocamento de 10 px.
- Saída mais rápida que a entrada.
- Mensagens consecutivas substituem conteúdo sem saltos de layout.
- O toast não cobre a navegação mobile.

### Categorias e regras

- Grupos de categorias usam rotação do chevron e revelação suave do conteúdo.
- Ativar ou inativar regra altera opacidade e indicador sem mover a linha.
- Ações destrutivas mantêm cor e confirmação explícitas.

## Acessibilidade

- Movimento reduzido remove deslocamento, escala, blur e stagger.
- Opacidade não será usada como única indicação de estado.
- Hover será aplicado somente em dispositivos compatíveis.
- Foco visível e contraste WCAG AA serão preservados.
- Animações não alteram ordem de leitura nem foco.

## Validação

- Desktop: 1440 px e 1120 px.
- Mobile: 390 px, somente leitura.
- Axe sem violações sérias ou críticas.
- Teste de foco em modal e drawer.
- Teste de `prefers-reduced-motion`.
- Verificação de ausência de overflow e mojibake.
- Build do webresource HTML único.
- Inspeção visual dos fluxos: navegação, OFX, conta sugerida, categorias, regras, validação e toast.

## Fora do escopo

- Alterar regras financeiras.
- Adicionar biblioteca de animação.
- Redesenhar layout, cores ou tipografia.
- Gestos de arrastar.
- Animações de gráficos ou contadores numéricos.
