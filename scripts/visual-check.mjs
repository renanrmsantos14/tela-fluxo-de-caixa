import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const html = await readFile(new URL('../dist/cr40f_TelaFluxoDeCaixa.html', import.meta.url));
const server = createServer((request, response) => {
  if (request.url === '/' || request.url?.startsWith('/?')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
    return;
  }
  response.writeHead(404);
  response.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Servidor visual não abriu uma porta TCP.');
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const output = new URL('../output/playwright/', import.meta.url);
await mkdir(output, { recursive: true });
const settleMotion = (page) => page.waitForTimeout(260);

try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1120, height: 820 },
    { width: 390, height: 844 }
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Fechamento mensal' }).waitFor();
    await settleMotion(page);
    const family = await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily);
    if (!family.toLowerCase().includes('manrope')) throw new Error(`Manrope não aplicada em ${viewport.width}px: ${family}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error(`Overflow horizontal do documento em ${viewport.width}px: ${overflow}px`);
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
    if (blocking.length) throw new Error(`Axe ${viewport.width}px: ${blocking.map((item) => `${item.id}: ${item.nodes.map((node) => `${node.target.join(' ')} — ${node.failureSummary}`).join(' | ')}`).join(' || ')}`);
    if (consoleErrors.length) throw new Error(`Console ${viewport.width}px: ${consoleErrors.join(' | ')}`);
    if (viewport.width === 390) {
      const mobileItems = await page.locator('.mobile-nav button').count();
      if (mobileItems !== 8) throw new Error(`Navegação mobile incompleta: ${mobileItems}/8 itens.`);
      const navigation = page.locator('.mobile-nav');
      const navigationBox = await navigation.boundingBox();
      const lastItemBox = await navigation.locator('button').last().boundingBox();
      if (!navigationBox || navigationBox.height < 100 || !lastItemBox || lastItemBox.y + lastItemBox.height > navigationBox.y + navigationBox.height + 1) {
        throw new Error('Navegação mobile não está disposta em grade 4x2 totalmente visível.');
      }
    }
    await page.screenshot({ path: fileURLToPath(new URL(`fluxo-${viewport.width}.png`, output)) });
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  const importButton = page.getByRole('button', { name: 'Importar OFX' }).first();
  await importButton.focus();
  await importButton.click();
  await page.getByRole('dialog', { name: 'Importar OFX' }).waitFor();
  const modalMotion = await page.locator('.modal').evaluate((element) => {
    const style = getComputedStyle(element);
    return { duration: style.transitionDuration, state: element.getAttribute('data-state') };
  });
  if (!modalMotion.duration.includes('0.2s') || modalMotion.state !== 'open') {
    throw new Error(`Contrato de movimento do modal inválido: ${JSON.stringify(modalMotion)}`);
  }
  await page.locator('input[type="file"][accept=".ofx"]').setInputFiles({
    name: 'conta-nova.ofx',
    mimeType: 'application/x-ofx',
    buffer: Buffer.from('<OFX><CURDEF>BRL<BANKACCTFROM><BANKID>341<ACCTID>VISUAL-001<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260715120000[-3]<TRNAMT>-10<FITID>visual-1<NAME>TESTE</STMTTRN></BANKTRANLIST></OFX>'),
  });
  await page.getByText('Conta ainda não cadastrada').waitFor();
  if (await page.locator('input[name="bank"]').inputValue() !== '341') throw new Error('Popup não preencheu BANKID.');
  if (await page.locator('input[name="identifier"]').inputValue() !== 'VISUAL-001') throw new Error('Popup não preencheu ACCTID.');
  const accountPopupAxe = await new AxeBuilder({ page }).analyze();
  const accountPopupBlocking = accountPopupAxe.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  if (accountPopupBlocking.length) throw new Error(`Axe popup de conta: ${accountPopupBlocking.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(' ')).join(' | ')}`).join(', ')}`);
  await page.screenshot({ path: fileURLToPath(new URL('ofx-conta-nova-1440.png', output)) });
  await page.keyboard.press('Escape');
  if (await page.locator('.modal').getAttribute('data-state') !== 'closed') throw new Error('Modal não iniciou a saída elegante.');
  await page.locator('.modal').waitFor({ state: 'detached' });
  if (!(await importButton.evaluate((element) => element === document.activeElement))) throw new Error('O modal OFX não restaurou o foco no acionador.');
  await page.getByRole('button', { name: 'Categorias DRE' }).click();
  await page.getByRole('heading', { name: 'Grupos e categorias' }).waitFor();
  await settleMotion(page);
  await page.screenshot({ path: fileURLToPath(new URL('categorias-1440.png', output)) });
  const newCategory = page.getByRole('button', { name: 'Nova categoria' });
  await newCategory.focus();
  await newCategory.click();
  await page.getByRole('heading', { name: 'Nova categoria' }).waitFor();
  await page.keyboard.press('Escape');
  if (!(await newCategory.evaluate((element) => element === document.activeElement))) throw new Error('O modal de categoria não restaurou o foco.');
  await page.getByRole('button', { name: 'Regras' }).click();
  await page.getByRole('heading', { name: 'Regras de reconhecimento' }).waitFor();
  await settleMotion(page);
  await page.screenshot({ path: fileURLToPath(new URL('regras-1440.png', output)) });
  await page.getByRole('button', { name: 'Nova regra' }).click();
  await page.getByRole('heading', { name: 'Nova regra' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.modal').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Fechamento' }).click();
  const pendingEntry = page.locator('.attention-list button').first();
  await pendingEntry.focus();
  await pendingEntry.click();
  await page.getByRole('dialog', { name: 'Classificar movimentação' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.drawer[data-state="closed"]').waitFor();
  await page.locator('.drawer').waitFor({ state: 'detached' });
  if (!(await pendingEntry.evaluate((element) => element === document.activeElement))) throw new Error('O drawer não restaurou o foco no lançamento.');
  await context.close();

  const reducedContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(url, { waitUntil: 'networkidle' });
  await reducedPage.getByRole('button', { name: 'Importar OFX' }).first().click();
  const reducedDurations = await reducedPage.locator('.modal').evaluate((element) => {
    const style = getComputedStyle(element);
    const toMs = (value) => value.trim().endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
    return style.transitionDuration.split(',').map(toMs);
  });
  if (Math.max(...reducedDurations) > 1) throw new Error(`Movimento reduzido excedeu 1ms: ${reducedDurations.join(', ')}`);
  await reducedContext.close();
  console.log('[visual-check] 1440/1120/390, Axe, Manrope, overflow, foco, saída e movimento reduzido: ok');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
