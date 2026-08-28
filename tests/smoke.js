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

  // mocka os módulos do Firebase pra testar o histórico na nuvem
  // (syncDeliveriesToCloud) sem depender de uma conta/rede reais
  const FAKE_FS_MODULE = `
    window.__FS_CALLS__ = window.__FS_CALLS__ || [];
    export function getFirestore(app){ return { __fake: true, app }; }
    export function doc(...args){ return { __path: args.slice(1).join('/') }; }
    export function collection(){ return {}; }
    export function setDoc(ref, data){ window.__FS_CALLS__.push({ path: ref.__path, data }); return Promise.resolve(); }
  `;
  const FAKE_APP_MODULE = `export function initializeApp(cfg){ return { __fakeApp: true, cfg }; }`;
  await page.route('https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js',
    (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_APP_MODULE }));
  await page.route('https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js',
    (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_FS_MODULE }));

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

    step = 'cabeçalho de números (paradas/pacotes/km/faltam) no mapa';
    const headerStats = await page.evaluate(() => ({
      paradas: document.querySelector('#app .js-paradas').textContent,
      pacotes: document.querySelector('#app .js-pacotes').textContent,
      faltam: document.querySelector('#app .js-faltam').textContent,
      tot: ORDER.length,
      pk: STOPS.reduce((s, x) => s + x.pkgs.length, 0),
    }));
    assert.strictEqual(headerStats.paradas, String(headerStats.tot), 'cabeçalho deveria mostrar o total de paradas');
    assert.strictEqual(headerStats.pacotes, String(headerStats.pk), 'cabeçalho deveria mostrar o total de pacotes');
    assert.strictEqual(headerStats.faltam, String(headerStats.tot), 'no começo da rota, faltam deveria ser igual ao total de paradas');

    step = 'aviso "perto de você" quando o motorista está perto de uma parada fora da ordem';
    const nearTarget = await page.evaluate(() => {
      const nx = nextStop();
      const si = ORDER.find((x) => !DONE.has(x) && x !== nx.si);
      return { si, lat: STOPS[si].lat, lng: STOPS[si].lng, seq: SEQ[si] };
    });
    await context.setGeolocation({ latitude: nearTarget.lat, longitude: nearTarget.lng });
    await page.waitForTimeout(2500);
    const nearBannerVisible = await page.evaluate(() => !document.getElementById('nearBanner').classList.contains('hide'));
    const nearBannerTxt = await page.evaluate(() => document.getElementById('nbSeq').textContent);
    assert.ok(nearBannerVisible, 'deveria avisar quando o motorista está perto de uma parada fora da ordem');
    assert.ok(nearBannerTxt.includes(String(nearTarget.seq)), 'o aviso deveria citar o número certo da parada próxima');
    await page.click('#nbGo');
    await page.waitForTimeout(300);
    assert.strictEqual(await page.evaluate(() => nextStop().si), nearTarget.si, 'tocar em "fazer agora" no aviso deveria promover a parada certa');
    await context.setGeolocation({ latitude: -22.924763, longitude: -42.482856 }); // volta pra posição original

    step = 'paradas muito próximas na tela viram um grupo, não pinos ilegíveis um em cima do outro';
    const clusterCount = await page.evaluate(() => {
      const baseSi = STOPS.length;
      const base = MEPOS || { lat: -22.9, lng: -42.4 };
      for (let i = 0; i < 6; i++) {
        STOPS.push({ lat: base.lat + i * 0.00003, lng: base.lng + i * 0.00003, addr: 'Rua Teste ' + i, hood: '', city: '', cep: '', pkgs: ['PKGTESTE' + i] });
        ORDER.push(baseSi + i);
        SEQ[baseSi + i] = ORDER.length;
      }
      drawPins();
      const n = [...PINS.getLayers()].filter((l) => l.getIcon && l.getIcon().options.html.includes('class="pin cluster"')).length;
      // desfaz a fabricação — o resto do teste simula uma rota real, sem pacotes de mentira misturados
      STOPS.length = baseSi;
      ORDER.length -= 6;
      for (let i = 0; i < 6; i++) delete SEQ[baseSi + i];
      drawPins();
      return n;
    });
    assert.ok(clusterCount >= 1, 'paradas muito próximas na tela deveriam se agrupar em pelo menos 1 pino de grupo');

    step = 'abas ROTA / MAPA / CARREGAR BAÚ navegam e mantêm os números em sincronia';
    await page.click('#btnPkgs'); // aba ROTA
    await page.waitForSelector('#pkScreen:not(.hide)');
    const pkHeaderStats = await page.evaluate(() => ({
      paradas: document.querySelector('#pkScreen .js-paradas').textContent,
      faltam: document.querySelector('#pkScreen .js-faltam').textContent,
    }));
    assert.strictEqual(pkHeaderStats.paradas, headerStats.paradas, 'a aba ROTA deveria mostrar os mesmos números do mapa');
    assert.strictEqual(pkHeaderStats.faltam, headerStats.faltam, 'a aba ROTA deveria mostrar os mesmos números do mapa');
    await page.click('#tabBauFromPk'); // ROTA -> CARREGAR BAÚ
    await page.waitForSelector('#scBau:not(.hide)');
    // volta pro mapa pelo botão da própria tela do baú (fluxo já existente)
    await page.click('#btnBauDone');
    await page.waitForSelector('#app:not(.hide)');

    step = 'linha da rota fica visível sozinha, sem precisar apertar nada';
    assert.ok(await page.evaluate(() => !!ROUTE_LINE), 'a linha ligando as paradas deveria aparecer por padrão no mapa');

    step = 'ver rota inteira (visão geral) não quebra o mapa';
    await page.click('#btnRouteOverview');
    await page.waitForTimeout(300);
    await page.click('#btnRouteOverview'); // desliga de novo
    await page.waitForTimeout(300);

    step = 'busca rápida (lupa) deve mostrar local do baú';
    await page.click('#btnFind');
    await page.waitForTimeout(300);
    const searchTarget = await page.evaluate(() => STOPS[ORDER[3]].pkgs[0]);
    await page.fill('#q', searchTarget.slice(-6));
    await page.waitForTimeout(200);
    const quickSearchHtml = await page.evaluate(() => document.getElementById('sres').innerHTML);
    assert.ok(/pilha/.test(quickSearchHtml), 'busca rápida deveria mostrar onde o pacote está guardado no baú');
    await page.evaluate(() => closeSheet());

    step = 'entregar (entregue) — confirma na hora, sem tela extra';
    const firstSi = await page.evaluate(() => ORDER[0]);
    await page.click('#btnDone');
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.getElementById('dcScreen').classList.contains('hide')),
      'ENTREGUEI deveria confirmar na hora, sem abrir tela extra de confirmação');
    const rec1 = await page.evaluate((si) => DELIVERY[si], firstSi);
    assert.strictEqual(rec1.status, 'entregue');

    step = 'marcar como não entregue com motivo';
    const thirdSi = await page.evaluate(() => nextStop().si);
    await page.click('#btnNaoEntregue');
    await page.waitForSelector('#dcScreen:not(.hide)');
    await page.waitForTimeout(300);
    await page.click('.reasonChip[data-r="Cliente ausente"]');
    await page.click('#btnDcConfirmFail');
    await page.waitForFunction(() => document.getElementById('dcScreen').classList.contains('hide'));
    const rec3 = await page.evaluate((si) => DELIVERY[si], thirdSi);
    assert.strictEqual(rec3.status, 'nao_entregue');
    assert.strictEqual(rec3.reason, 'Cliente ausente');

    step = 'histórico na nuvem: sincroniza as entregas feitas, sem duplicar';
    await page.evaluate(() => { CURRENT_USER = { uid: 'motorista-teste-123', email: 'motorista@teste.com' }; });
    await page.evaluate(() => syncDeliveriesToCloud());
    await page.waitForTimeout(400);
    const fsCallsAfterFirst = await page.evaluate(() => window.__FS_CALLS__ || []);
    assert.strictEqual(fsCallsAfterFirst.length, 2, 'deveria ter sincronizado as 2 entregas já feitas (entregue + não entregue)');
    assert.ok(fsCallsAfterFirst.every((c) => c.path.includes('users/motorista-teste-123/deliveries/')),
      'cada registro deveria ficar isolado dentro do uid do motorista logado');
    await page.evaluate(() => syncDeliveriesToCloud()); // sincroniza de novo sem entregar nada a mais
    await page.waitForTimeout(300);
    const fsCallsAfterSecond = await page.evaluate(() => window.__FS_CALLS__ || []);
    assert.strictEqual(fsCallsAfterSecond.length, 2, 'sincronizar de novo sem novas entregas não deveria duplicar registros');

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
    await page.click(`#pkFullList .promote[data-promote="${promoteTarget}"]`);
    await page.waitForTimeout(300);
    assert.strictEqual(await page.evaluate(() => nextStop().si), promoteTarget);

    step = 'adiantar parada pela lista "Próximas paradas" (painel de baixo no mapa)';
    await page.click('#btnPkgsBack'); // fecha o painel de pacotes e volta pro mapa
    await page.waitForSelector('#app:not(.hide)');
    await page.click('#grip'); // abre o painel de baixo
    await page.waitForTimeout(300);
    const nextListTarget = await page.evaluate(() => {
      const nx = nextStop();
      return ORDER.filter((si) => !DONE.has(si) && si !== nx.si)[2];
    });
    await page.click(`#nextList .promote[data-promote="${nextListTarget}"]`);
    await page.waitForTimeout(300);
    assert.strictEqual(await page.evaluate(() => nextStop().si), nextListTarget, 'tocar em "fazer agora" na lista de próximas paradas deveria tornar essa parada a próxima');

    step = 'desfazer entrega apaga o registro';
    await page.click('#btnPkgs');
    await page.waitForSelector('#pkScreen:not(.hide)');
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

    step = 'botão voltar fecha a tela de "não entregue"';
    await page.click('#btnRptBack');
    await page.waitForSelector('#pkScreen:not(.hide)');
    await page.click('#btnPkgsBack');
    await page.waitForSelector('#app:not(.hide)');
    await page.click('#btnNaoEntregue');
    await page.waitForSelector('#dcScreen:not(.hide)');
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => { handleBack(); return document.getElementById('dcScreen').classList.contains('hide'); }),
      'botão de voltar deveria fechar a tela de "não entregue"');

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
