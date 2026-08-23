/* ===================== TESTE DE FUMAÇA (smoke test) =====================
   Simula um motorista usando o app do começo ao fim: importar rota,
   carregar o baú, escanear pacote certo/errado, entregar (entregue e
   não entregue com motivo), pular, adiantar parada, recalcular, ver
   relatório, salvar arquivo, encerrar — e testa o botão físico de
   voltar do Android em cada tela.

   Como rodar:
     npm test
   (isso sobe um servidor local só pra servir www/index.html e roda
   este arquivo com Node — não precisa de nada além de `npm install`
   ter baixado o Playwright uma vez; na primeira vez rode também
   `npx playwright install chromium`.)

   Se algo aqui quebrar, é sinal de que uma mudança recente afetou o
   fluxo real do motorista — vale a pena investigar antes de publicar
   uma atualização. */
const assert = require('assert');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const APP_DIR = path.join(__dirname, '..', 'www');
const PORT = 8973;
const BASE_URL = `http://localhost:${PORT}/index.html`;

function startServer() {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const filePath = path.join(APP_DIR, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: -22.924763, longitude: -42.482856 },
    permissions: ['geolocation', 'camera'],
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  // pula o login de verdade (não testamos Firebase Auth aqui — precisa de
  // credenciais reais e depende de rede; ver initAuth() em www/index.html)
  await page.addInitScript(() => { window.__TEST_BYPASS_LOGIN__ = true; });

  let step = 'início';
  try {
    step = 'carregar a página';
    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    step = 'tela de ajuda (?) e voltar';
    await page.click('#btnHelp');
    await page.waitForSelector('#scHelp:not(.hide)');
    assert.ok(await page.evaluate(() => { handleBack(); return document.getElementById('scHelp').classList.contains('hide'); }),
      'botão de voltar deveria fechar a tela de ajuda');

    step = 'importar rota de exemplo';
    await page.click('#btnDemo');
    await page.waitForSelector('#scBrief:not(.hide)');
    const briefText = await page.evaluate(() => document.getElementById('bSave').textContent);
    assert.ok(/km/.test(briefText), 'resumo da rota deveria comparar km da planilha x rota otimizada');
    assert.ok(await page.isVisible('#btnRefineRoute'), 'botão de refinar a rota com dados de rua deveria estar sempre visível, não só quando cai pra linha reta');

    step = 'carregar o baú: escanear pacote válido';
    await page.click('#btnToBau');
    await page.waitForSelector('#scBau:not(.hide)');
    const firstPkg = await page.evaluate(() => STOPS[ORDER[0]].pkgs[0]);
    await page.fill('#bauInput', firstPkg.slice(-6));
    await page.waitForTimeout(700); // debounce de 450ms do campo
    const bauBannerOk = await page.evaluate(() => document.getElementById('bauBanner').textContent);
    assert.ok(/pilha/i.test(bauBannerOk), 'escanear um pacote válido deveria dizer onde guardar (pilha/setor)');

    step = 'carregar o baú: escanear pacote que não é da rota';
    await page.fill('#bauInput', 'ZZZ99999');
    await page.waitForTimeout(700);
    const bauBannerWrong = await page.evaluate(() => document.getElementById('bauBanner').className);
    assert.strictEqual(bauBannerWrong, 'warn', 'escanear um pacote de fora da rota deveria mostrar aviso');

    step = 'pular a tela do baú e entrar no mapa';
    await page.click('#btnBauSkip');
    await page.waitForSelector('#app:not(.hide)');
    await page.waitForTimeout(800);

    step = 'busca rápida (lupa) deve mostrar local do baú';
    await page.click('#btnFind');
    await page.waitForTimeout(300);
    const searchTarget = await page.evaluate(() => STOPS[ORDER[3]].pkgs[0]);
    await page.fill('#q', searchTarget.slice(-6));
    await page.waitForTimeout(200);
    const quickSearchHtml = await page.evaluate(() => document.getElementById('sres').innerHTML);
    assert.ok(/pilha/.test(quickSearchHtml), 'busca rápida deveria mostrar onde o pacote está guardado no baú');
    await page.evaluate(() => closeSheet());

    step = 'entregar (entregue)';
    await page.click('#btnDone');
    await page.waitForSelector('#dcScreen:not(.hide)');
    await page.waitForTimeout(300);
    const firstSi = await page.evaluate(() => ORDER[0]);
    await page.click('#btnDcOk');
    await page.waitForFunction(() => document.getElementById('dcScreen').classList.contains('hide'));
    const rec1 = await page.evaluate((si) => DELIVERY[si], firstSi);
    assert.strictEqual(rec1.status, 'entregue');

    step = 'marcar como não entregue com motivo';
    await page.click('#btnDone');
    await page.waitForSelector('#dcScreen:not(.hide)');
    await page.waitForTimeout(300);
    const thirdSi = await page.evaluate(() => nextStop().si);
    await page.click('#btnDcFail');
    await page.waitForSelector('#dcReasons:not(.hide)');
    await page.click('.reasonChip[data-r="Cliente ausente"]');
    await page.click('#btnDcConfirmFail');
    await page.waitForFunction(() => document.getElementById('dcScreen').classList.contains('hide'));
    const rec3 = await page.evaluate((si) => DELIVERY[si], thirdSi);
    assert.strictEqual(rec3.status, 'nao_entregue');
    assert.strictEqual(rec3.reason, 'Cliente ausente');

    step = 'pular parada (e recalcular sozinho a partir de onde está)';
    // mocka o OSRM pra esse recálculo automático não depender de rede real —
    // o tamanho da matriz precisa bater com a quantidade de pontos que o
    // pedido realmente tem (MEPOS + pendentes, sem a que acabou de ser pulada)
    await page.route('**router.project-osrm.org**', (route) => {
      const url = route.request().url();
      const coordsPart = decodeURIComponent(url.split('/driving/')[1].split('?')[0]);
      const n = coordsPart.split(';').length;
      const distances = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 1000 + Math.abs(i - j) * 300)));
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ distances }) });
    });
    const beforeSkip = await page.evaluate(() => nextStop().si);
    const orderLenBefore = await page.evaluate(() => ORDER.length);
    await page.click('#btnSkip');
    await page.waitForTimeout(200);
    const skippedPosRightAfter = await page.evaluate((si) => ORDER.indexOf(si), beforeSkip);
    assert.strictEqual(skippedPosRightAfter, orderLenBefore - 1, 'parada pulada deveria ir pro fim da fila na hora');
    await page.waitForFunction(() => document.getElementById('load').classList.contains('hide'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(200);
    const orderLenAfter = await page.evaluate(() => ORDER.length);
    const skippedPosAfterRecalc = await page.evaluate((si) => ORDER.indexOf(si), beforeSkip);
    assert.strictEqual(orderLenAfter, orderLenBefore, 'nenhuma parada pode sumir no recálculo automático');
    assert.strictEqual(skippedPosAfterRecalc, orderLenAfter - 1, 'parada pulada continua sendo a última depois do recálculo automático');
    await page.unroute('**router.project-osrm.org**');

    step = 'adiantar parada (promover)';
    await page.click('#btnPkgs');
    await page.waitForSelector('#pkScreen:not(.hide)');
    const promoteTarget = await page.evaluate(() => {
      const nx = nextStop();
      return ORDER.filter((si) => !DONE.has(si) && si !== nx.si)[3];
    });
    await page.click(`.promote[data-promote="${promoteTarget}"]`);
    await page.waitForTimeout(300);
    assert.strictEqual(await page.evaluate(() => nextStop().si), promoteTarget);

    step = 'desfazer entrega apaga o registro';
    const doneRow = await page.evaluate(() => [...document.querySelectorAll('.pkrow')].find((r) => r.classList.contains('d') || r.classList.contains('f')).dataset.si);
    await page.click(`.pkrow[data-si="${doneRow}"]`);
    await page.waitForTimeout(300);
    const recAfterUndo = await page.evaluate((si) => DELIVERY[si], +doneRow);
    assert.strictEqual(recAfterUndo, undefined, 'desfazer deveria apagar o registro da entrega');

    step = 'relatório do dia e voltar';
    await page.click('#btnOpenReport');
    await page.waitForSelector('#rptScreen:not(.hide)');
    assert.ok(await page.evaluate(() => { handleBack(); return document.getElementById('rptScreen').classList.contains('hide'); }),
      'botão de voltar deveria fechar o relatório');

    step = 'salvar rota em arquivo';
    // o voltar do passo anterior já deixou a gente de volta na aba "conferir pacotes"
    await page.click('#btnOpenReport');
    await page.waitForSelector('#rptScreen:not(.hide)');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.click('#btnRptSaveFile'),
    ]);
    const filePath = await download.path();
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('Trajeto percorrido') || content.includes('ROTA FÁCIL'), 'arquivo salvo deveria ter o conteúdo esperado');

    step = 'botão voltar fecha a tela de comprovante de entrega';
    await page.click('#btnRptBack');
    await page.waitForSelector('#pkScreen:not(.hide)');
    await page.click('#btnPkgsBack');
    await page.waitForSelector('#app:not(.hide)');
    await page.click('#btnDone');
    await page.waitForSelector('#dcScreen:not(.hide)');
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => { handleBack(); return document.getElementById('dcScreen').classList.contains('hide'); }),
      'botão de voltar deveria fechar a tela de comprovante de entrega');

    step = 'nenhum erro de JS durante o teste todo';
    assert.deepStrictEqual(pageErrors, [], `erros de JS encontrados: ${pageErrors.join(' | ')}`);

    console.log('✔ todos os passos do smoke test passaram');
  } catch (err) {
    console.error(`✘ falhou no passo: "${step}"`);
    throw err;
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
