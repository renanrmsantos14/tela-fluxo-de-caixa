# Animações e UX Elegantes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar movimento elegante, acessível e performático em todas as interações do app sem alterar regras financeiras.

**Architecture:** Usar somente React existente e CSS, com estado mínimo para permitir saídas de modal, drawer e toast antes da remoção do DOM. Centralizar tempos e curvas em variáveis CSS e validar o comportamento por Playwright em movimento normal e reduzido.

**Tech Stack:** React 18, TypeScript strict, CSS, Playwright, Axe e Vite single-file.

## Global Constraints

- Seguir o design system Pai e manter light-only.
- Não adicionar biblioteca de animação.
- Priorizar `transform` e `opacity`; blur máximo de 2 px em conteúdo pequeno.
- Não animar largura, altura, margem ou padding.
- Duração comum entre 120 e 220 ms.
- Preservar foco, teclado, WCAG AA, mobile somente leitura e `prefers-reduced-motion`.
- Não alterar regras financeiras, dados, layout estrutural, cores ou tipografia.

---

### Task 1: Criar contrato verificável de movimento

**Files:**
- Modify: `scripts/visual-check.mjs`

**Interfaces:**
- Consumes: HTML gerado em `dist/cr40f_TelaFluxoDeCaixa.html`.
- Produces: verificações de tokens, entrada/saída e movimento reduzido.

- [ ] **Step 1: Escrever verificações que falham**

Adicionar assertions para:

```js
const motionDuration = await page.locator('.modal').evaluate((element) => getComputedStyle(element).transitionDuration);
if (!motionDuration.includes('0.2s')) throw new Error('Modal sem duração elegante.');
```

Criar um contexto com `reducedMotion: 'reduce'` e confirmar duração máxima de `0.01s`.

- [ ] **Step 2: Executar o teste e confirmar RED**

Run: `npm run build && npm run visual:check`

Expected: FAIL porque modal/drawer ainda usam keyframes sem contrato de saída e a página não possui camada animada.

- [ ] **Step 3: Manter o teste para guiar as próximas tarefas**

Não alterar o teste para fazê-lo passar artificialmente.

### Task 2: Implementar presença e saídas acessíveis

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `useAnimatedPresence<T>(value, exitMs)` retornando `{ rendered, phase }`.
- Consumes: modal, drawer e toast existentes.

- [ ] **Step 1: Implementar hook mínimo**

Manter o último conteúdo durante 150 ms, marcar `data-state="open|closed"` e remover após a saída.

- [ ] **Step 2: Aplicar ao modal, drawer e toast**

Preservar focus trap, Escape e restauração de foco. Backdrop e superfície devem compartilhar a fase.

- [ ] **Step 3: Rodar TypeScript e teste visual**

Run: `npx tsc --noEmit && npm run build && npm run visual:check`

Expected: PASS nas saídas, foco e Axe.

### Task 3: Aplicar sistema de movimento global

**Files:**
- Modify: `src/styles.css`

**Interfaces:**
- Produces: variáveis `--motion-fast`, `--motion-base`, `--motion-slow`, `--ease-out-strong`, `--ease-in-out-strong`.

- [ ] **Step 1: Centralizar tokens**

Definir tempos entre 120 e 220 ms e curvas aprovadas.

- [ ] **Step 2: Melhorar controles e navegação**

Aplicar transições específicas a botões, ícones, inputs, selects, navegação lateral/mobile, filtros, dropzone e estados ativos.

- [ ] **Step 3: Melhorar superfícies e listas**

Aplicar hover somente em dispositivos compatíveis, realce sem layout shift, stagger limitado, chevrons e empty states.

- [ ] **Step 4: Melhorar feedback**

Aplicar crossfade curto em KPIs e badges, blur de no máximo 2 px apenas em conteúdo pequeno e spinner estável.

- [ ] **Step 5: Validar reduced motion**

Garantir que transform, blur, stagger e transições sejam removidos em `prefers-reduced-motion`.

### Task 4: Identificar conteúdos e estados no React

**Files:**
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: classes CSS da Task 3.
- Produces: `key` por tela, classes de itens interativos e chevron de categoria.

- [ ] **Step 1: Adicionar camada de conteúdo por view**

Usar `key={view}` para executar apenas a entrada curta da tela selecionada.

- [ ] **Step 2: Marcar itens interativos**

Adicionar classes sem alterar handlers ou DOM necessário.

- [ ] **Step 3: Adicionar chevron sem controlar altura**

Usar o estado nativo de `<details>` e rotação do ícone.

### Task 5: Verificação final e documentação

**Files:**
- Modify: `scripts/visual-check.mjs`
- Modify: `system_architecture.md`

**Interfaces:**
- Produces: gate completo de qualidade e registro da arquitetura de movimento.

- [ ] **Step 1: Executar gate completo**

Run: `npm run check`

Expected: TypeScript, testes, design check, build, Axe, foco, responsividade, UTF-8 e portabilidade aprovados.

- [ ] **Step 2: Inspecionar screenshots**

Revisar 1440, 1120, 390, popup OFX, categorias, regras e drawer.

- [ ] **Step 3: Revisar diff**

Run: `git diff --check`

Expected: sem erro de whitespace ou encoding.

- [ ] **Step 4: Registrar arquitetura**

Documentar tokens, presença animada, limites de blur e reduced motion.

- [ ] **Step 5: Commit**

Criar commit em português detalhando movimento, UX, acessibilidade e validações.
