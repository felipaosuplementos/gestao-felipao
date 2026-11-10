// Sincronização com a nuvem (Firebase).
// Cada aparelho continua com o seu banco local (funciona sem internet). Tudo o que muda aqui
// é enviado para a nuvem, e o que muda no outro aparelho chega e é gravado aqui.
// Os dados ficam em usuarios/{conta}/{loja} (produtos, fotos, clientes, lançamentos, vendas, tarefas, pedidos…).

import * as db from './db.js';
import { $, esc, avisar, confirmar, lerPreferencia, gravarPreferencia, dataUrlParaBlob } from './comum.js';
import { firebaseConfig, emailPermitido } from './config-nuvem.js';

const params = new URLSearchParams(location.search);
const EMULADOR = ['localhost', '127.0.0.1'].includes(location.hostname) && params.has('emulador');
const config = EMULADOR ? { apiKey: 'demo', authDomain: 'localhost', projectId: 'demo-felipao' } : firebaseConfig;
const emailLiberado = EMULADOR ? (params.get('emulador') || 'felipao@teste.com') : emailPermitido;

const estado = {
  fb: null, auth: null, fs: null, usuario: null,
  pendentes: 0, situacao: 'desligada', paradas: [],
  semNuvem: false, // escolheu "usar só neste aparelho" nesta vez
};

// Identifica este aparelho, para não regravar o que ele mesmo enviou.
let idAparelho = lerPreferencia('idAparelho');
if (!idAparelho) { idAparelho = db.novoId(); gravarPreferencia('idAparelho', idAparelho); }

const chave = (nome) => `nuvem.${estado.usuario.uid}.${nome}`;

// Aparelho que já entrou com a conta Google: daqui em diante só abre com login
// (some o "usar só neste aparelho", para ninguém ver os dados guardados aqui sem entrar).
const jaUsouConta = () => !!lerPreferencia('contaGoogle');
if (jaUsouConta()) {
  $('#tela-login').hidden = false;
  $('#btn-sem-nuvem').hidden = true;
}

// ---------- Situação (aparece no topo das telas) ----------

const TEXTOS = {
  desligada: '📱 Dados só neste aparelho',
  entrando: '☁️ Conectando…',
  ok: '☁️ Sincronizado',
  enviando: '⏳ Enviando para a nuvem…',
  demorando: '⏳ Enviando… (já está salvo no aparelho)',
  offline: '📴 Sem internet: salvo no aparelho',
  erro: '⚠️ Erro na sincronização',
};

// Último problema com a nuvem (aparece ao tocar no aviso do topo).
const problemas = { ultimo: null, envioFalhou: false };
const lotesEsperando = new Map(); // lote → { lojas, desde, qtd }
function anotarProblema(onde, e) {
  console.error(onde, e);
  problemas.ultimo = { onde, quando: new Date(), codigo: e?.code || '', mensagem: String(e?.message || e).slice(0, 300) };
}

// Desde quando tem envio esperando a nuvem responder.
let enviandoDesde = null;
const DEMORA = 15000;

function mostrarSituacao(situacao) {
  estado.situacao = situacao;
  if (!estado.pendentes) enviandoDesde = null;
  else if (!enviandoDesde) enviandoDesde = Date.now();
  const demorando = enviandoDesde && Date.now() - enviandoDesde > DEMORA;
  const texto = situacao === 'ok' && estado.pendentes ? TEXTOS[demorando ? 'demorando' : 'enviando'] : TEXTOS[situacao];
  document.querySelectorAll('.sync-status').forEach((el) => {
    el.textContent = texto;
    el.dataset.situacao = situacao;
  });
}
function atualizarSituacao() {
  if (!estado.usuario) return;
  const caiu = [...escutas.values()].some((e) => e.caiu);
  mostrarSituacao(!navigator.onLine ? 'offline' : problemas.envioFalhou || caiu ? 'erro' : 'ok');
}
addEventListener('online', () => { atualizarSituacao(); reconectar(); religarCaidas(); });
addEventListener('offline', atualizarSituacao);

// No iPhone, quando o app fica em segundo plano, a ligação com a nuvem "dorme" e os envios
// ficam esperando até ela acordar sozinha (pode levar um tempo). Ao voltar para o app,
// ou se um envio demorar, a ligação é refeita na hora. Nada se perde: o que está esperando
// continua guardado e vai assim que a ligação volta.
let ultimaReconexao = 0;
async function reconectar() {
  if (!estado.usuario || !navigator.onLine || Date.now() - ultimaReconexao < 5000) return;
  ultimaReconexao = Date.now();
  try {
    await estado.fb.disableNetwork(estado.fs);
    await estado.fb.enableNetwork(estado.fs);
  } catch (e) {
    anotarProblema('Reconectar', e);
  }
}
// Ao voltar para o app: refaz a ligação, religa escutas que caíram e confere com a nuvem (no máximo a cada 30 min).
function aoVoltar() { reconectar(); religarCaidas(); conferirComNuvem(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) aoVoltar(); });
addEventListener('pageshow', aoVoltar);
setInterval(() => { if (!document.hidden) { religarCaidas(); conferirComNuvem(); } }, 5 * 60 * 1000);
// Envio demorando: atualiza o aviso e tenta refazer a ligação (no máximo a cada 30 segundos).
setInterval(() => {
  if (!estado.pendentes) return;
  atualizarSituacao();
  if (Date.now() - enviandoDesde > DEMORA && Date.now() - ultimaReconexao > 30000) reconectar();
}, 5000);
// Tocar no aviso do topo também refaz a ligação.
// e mostra os detalhes (o que está esperando e o último problema), para descobrir o que houve.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.sync-status') || !estado.usuario) return;
  ultimaReconexao = 0;
  reconectar();
  mostrarDetalhes();
});

async function mostrarDetalhes() {
  const hora = (d) => d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const esperando = [...lotesEsperando.values()];
  const versao = await fetch('sw.js').then((r) => r.text()).then((t) => (t.match(/felipao-v\d+/) || ['?'])[0]).catch(() => '?');
  const linhas = [
    `<strong>Situação:</strong> ${esc(document.querySelector('.sync-status')?.textContent || '')}`,
    `<strong>Internet:</strong> ${navigator.onLine ? 'sim' : 'não'}`,
    `<strong>Esperando a nuvem:</strong> ${esperando.length
      ? esperando.map((l) => `${l.qtd} ${l.qtd === 1 ? 'registro' : 'registros'} de ${esc(l.lojas.join(', '))} desde ${hora(l.desde)}`).join('; ')
      : 'nada'}`,
    `<strong>Último problema:</strong> ${problemas.ultimo
      ? `${esc(problemas.ultimo.onde)} às ${hora(problemas.ultimo.quando)}: ${esc(problemas.ultimo.codigo)} ${esc(problemas.ultimo.mensagem)}`
      : 'nenhum'}`,
    `<strong>Última conferência com a nuvem:</strong> ${conferencia.ultima ? `${hora(new Date(conferencia.ultima))} (${esc(conferencia.resultado)})` : conferencia.rodando ? 'conferindo agora…' : 'ainda não'}`,
    `<strong>Conta:</strong> ${esc(estado.usuario?.email || '')} · <strong>Versão:</strong> ${esc(versao)}`,
    '<br>Já pedi para refazer a ligação com a nuvem. Se algo estiver diferente entre o celular e o computador, toque em <strong>Conferir tudo com a nuvem agora</strong>.',
  ];
  const escolha = await escolher('Sincronização', linhas.join('<br>'), [
    { rotulo: '🔄 Conferir tudo com a nuvem agora', valor: 'conferir', principal: true },
    { rotulo: 'Fechar', valor: null },
  ]);
  if (escolha !== 'conferir') return;
  avisar('Conferindo com a nuvem…');
  religarCaidas();
  const r = await conferirComNuvem({ forcar: true });
  avisar(!r ? 'Não deu para conferir agora (sem internet ou ainda enviando). Tente de novo em instantes.'
    : r.trazidos || r.enviados ? `Pronto: ${conferencia.resultado}.` : 'Pronto: está tudo igual à nuvem. ✅');
}

// ---------- Conversões ----------

function blobParaTexto(blob) {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => erro(r.error);
    r.readAsDataURL(blob);
  });
}
function idDo(m) {
  if (m.loja === 'fotos' || m.removido) return String(m.chave);
  return String(m.valor.id);
}

// ---------- Envio ----------

function refDoc(loja, id) {
  const { doc } = estado.fb;
  return doc(estado.fs, 'usuarios', estado.usuario.uid, loja, id);
}

async function paraNuvem(m) {
  const { serverTimestamp } = estado.fb;
  const base = { _sync: serverTimestamp(), _origem: idAparelho };
  if (m.removido) return { ...base, _excluido: true };
  if (m.loja === 'fotos') return { ...base, dados: await blobParaTexto(m.valor) };
  return { ...m.valor, ...base };
}

async function enviar(mudancas) {
  if (!estado.usuario) return;
  envios++;
  const { writeBatch } = estado.fb;
  for (let i = 0; i < mudancas.length; i += 400) {
    const lote = writeBatch(estado.fs);
    for (const m of mudancas.slice(i, i + 400)) lote.set(refDoc(m.loja, idDo(m)), await paraNuvem(m));
    const parte = mudancas.slice(i, i + 400);
    lotesEsperando.set(lote, { lojas: [...new Set(parte.map((m) => m.loja))], qtd: parte.length, desde: new Date() });
    estado.pendentes++;
    atualizarSituacao();
    // Sem internet, o Firebase guarda e envia sozinho quando a conexão voltar.
    lote.commit()
      .then(() => { problemas.envioFalhou = false; })
      .catch((e) => { anotarProblema(`Envio (${lotesEsperando.get(lote)?.lojas.join(', ')})`, e); problemas.envioFalhou = true; })
      .finally(() => { lotesEsperando.delete(lote); estado.pendentes--; atualizarSituacao(); });
  }
}

async function enviarTudo() {
  const tudo = await db.lerTudo();
  const mudancas = [];
  for (const loja of db.LOJAS) {
    if (loja === 'fotos') tudo.fotos.forEach((f) => mudancas.push({ loja, chave: f.chave, valor: f.valor }));
    else tudo[loja].forEach((valor) => mudancas.push({ loja, valor }));
  }
  await enviar(mudancas);
  return mudancas.length;
}

// ---------- Recebimento ----------

// Cada parte (produtos, clientes…) tem uma "escuta" ligada na nuvem. Se ela cair por qualquer erro,
// é religada sozinha (antes ficava parada até recarregar o sistema, e o outro aparelho não recebia nada).
const escutas = new Map(); // loja → { parar, caiu }
let fila = Promise.resolve(); // processa o que chega um de cada vez, na ordem

function ouvir(loja) {
  const { collection, query, where, onSnapshot, Timestamp } = estado.fb;
  const desde = Number(lerPreferencia(chave(`ultimo.${loja}`)) || 0);
  const consulta = query(collection(estado.fs, 'usuarios', estado.usuario.uid, loja), where('_sync', '>', Timestamp.fromMillis(desde)));
  const escuta = { caiu: false, parar: () => {} };
  escuta.parar = onSnapshot(consulta, (snap) => {
    fila = fila.then(() => receber(loja, snap)).catch((e) => anotarProblema(`Gravar o que chegou (${loja})`, e));
  }, (erro) => {
    anotarProblema(`Recebimento (${loja})`, erro);
    escuta.caiu = true;
    mostrarSituacao('erro');
    setTimeout(() => { if (escutas.get(loja) === escuta) religar(loja); }, 10000);
  });
  escutas.set(loja, escuta);
}

function religar(loja) {
  if (!estado.usuario) return;
  escutas.get(loja)?.parar();
  ouvir(loja);
  atualizarSituacao();
}
const religarCaidas = () => { for (const [loja, e] of escutas) if (e.caiu) religar(loja); };
function pararEscutas() { for (const e of escutas.values()) e.parar(); escutas.clear(); }

async function receber(loja, snap) {
  const itens = [];
  let maior = 0;
  for (const mudanca of snap.docChanges()) {
    if (mudanca.type === 'removed') continue;
    const d = mudanca.doc;
    if (d.metadata.hasPendingWrites) continue;
    const { _sync, _origem, _excluido, ...dados } = d.data();
    if (_sync) maior = Math.max(maior, _sync.toMillis());
    if (_origem === idAparelho) continue; // já está aqui
    if (_excluido) itens.push({ loja, chave: d.id, removido: true });
    else if (loja === 'fotos') itens.push({ loja, chave: d.id, valor: dataUrlParaBlob(dados.dados) });
    else itens.push({ loja, valor: dados });
  }
  if (itens.length) {
    await db.aplicarDaNuvem(itens);
    document.dispatchEvent(new CustomEvent('dados-mudaram'));
  }
  // Marca até onde já recebeu (nunca volta para trás).
  const atual = Number(lerPreferencia(chave(`ultimo.${loja}`)) || 0);
  if (maior > atual) gravarPreferencia(chave(`ultimo.${loja}`), String(maior));
}

// ---------- Conferência completa com a nuvem ----------
// De tempos em tempos (ao abrir o app, ao voltar para ele e no botão "Conferir agora"),
// compara tudo o que está no aparelho com o que está na nuvem e acerta as diferenças:
// - mudou em outro aparelho e não chegou aqui → traz para cá;
// - mudou aqui e não chegou na nuvem (ou nem existe lá) → manda de novo.
// As fotos ficam de fora (são pesadas); elas continuam chegando pela escuta normal.
const conferencia = { ultima: null, resultado: '', rodando: false };
const INTERVALO_CONFERENCIA = 30 * 60 * 1000;
let envios = 0; // conta envios, para não misturar a conferência com uma mudança feita no meio dela

const ordenado = (v) => (Array.isArray(v) ? v.map(ordenado)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenado(v[k])])) : v);
const igual = (a, b) => JSON.stringify(ordenado(JSON.parse(JSON.stringify(a)))) === JSON.stringify(ordenado(JSON.parse(JSON.stringify(b))));

export async function conferirComNuvem({ forcar = false } = {}) {
  if (!estado.usuario || conferencia.rodando || !navigator.onLine) return null;
  if (!forcar && conferencia.ultima && Date.now() - conferencia.ultima < INTERVALO_CONFERENCIA) return null;
  conferencia.rodando = true;
  try {
    // Primeiro espera tudo o que está na fila sair (inclusive de antes de fechar o app).
    const saiu = await Promise.race([
      estado.fb.waitForPendingWrites(estado.fs).then(() => true),
      new Promise((ok) => setTimeout(() => ok(false), 20000)),
    ]);
    if (!saiu) return null;
    const inicio = envios;
    const { collection, getDocsFromServer } = estado.fb;
    const local = await db.lerTudo();
    const trazer = []; const mandar = []; const antigos = [];
    for (const loja of db.LOJAS.filter((l) => l !== 'fotos')) {
      const snap = await getDocsFromServer(collection(estado.fs, 'usuarios', estado.usuario.uid, loja));
      const aqui = new Map(local[loja].map((v) => [String(v.id), v]));
      const la = new Set();
      for (const d of snap.docs) {
        la.add(d.id);
        const { _sync, _origem, _excluido, ...dados } = d.data();
        const meu = aqui.get(d.id);
        if (_excluido) { if (meu && _origem !== idAparelho) { trazer.push({ loja, chave: d.id, removido: true }); antigos.push({ loja, antes: meu, depois: null }); } continue; }
        if (meu && igual(meu, dados)) continue;
        // Qual é a mais nova? Pela hora da última mudança; sem essa hora (registros antigos),
        // vale a da nuvem se foi outro aparelho que mexeu por último.
        const aquiMaisNovo = meu && (meu.mudouEm && dados.mudouEm ? meu.mudouEm > dados.mudouEm : _origem === idAparelho);
        if (aquiMaisNovo) mandar.push({ loja, valor: meu });
        else {
          trazer.push({ loja, valor: dados });
          if (meu) antigos.push({ loja, antes: meu, depois: dados });
        }
      }
      for (const [id, valor] of aqui) if (!la.has(id)) mandar.push({ loja, valor });
    }
    if (envios !== inicio) return null; // mexeu em algo durante a conferência: tenta de novo depois
    // Guarda uma cópia do que vai ser substituído aqui (vai junto no backup completo), por segurança.
    if (antigos.length) await db.salvarAjuste({ id: `conferencia-${Date.now()}`, tipo: 'conferencia', quando: new Date().toISOString(), aparelho: idAparelho, substituidos: antigos });
    if (trazer.length) {
      await db.aplicarDaNuvem(trazer);
      document.dispatchEvent(new CustomEvent('dados-mudaram'));
    }
    if (mandar.length) await enviar(mandar);
    conferencia.ultima = Date.now();
    conferencia.resultado = trazer.length || mandar.length
      ? `${trazer.length} ${trazer.length === 1 ? 'item trazido' : 'itens trazidos'} da nuvem, ${mandar.length} ${mandar.length === 1 ? 'enviado' : 'enviados'} de novo`
      : 'tudo igual';
    if (trazer.length || mandar.length) console.info('Conferência:', conferencia.resultado, { trazer, mandar });
    return { trazidos: trazer.length, enviados: mandar.length };
  } catch (e) {
    anotarProblema('Conferência com a nuvem', e);
    return null;
  } finally {
    conferencia.rodando = false;
  }
}

// ---------- Primeira vez neste aparelho ----------

async function nuvemTemDados() {
  const { collection, query, limit, getDocsFromServer } = estado.fb;
  for (const loja of ['produtos', 'clientes', 'vendas']) {
    const snap = await getDocsFromServer(query(collection(estado.fs, 'usuarios', estado.usuario.uid, loja), limit(1)));
    if (!snap.empty) return true;
  }
  return false;
}

function escolher(titulo, texto, opcoes) {
  const dlg = $('#dlg-nuvem');
  $('#nuvem-titulo').textContent = titulo;
  $('#nuvem-texto').innerHTML = texto;
  $('#nuvem-opcoes').innerHTML = opcoes.map((o, i) => `<button class="btn ${o.principal ? 'btn-primario' : ''}" data-opcao="${i}">${o.rotulo}</button>`).join('');
  return new Promise((resolve) => {
    $('#nuvem-opcoes').onclick = (e) => {
      const b = e.target.closest('[data-opcao]');
      if (!b) return;
      dlg.close();
      resolve(opcoes[Number(b.dataset.opcao)].valor);
    };
    dlg.oncancel = (e) => e.preventDefault(); // precisa escolher
    dlg.showModal();
  });
}

async function primeiraVez() {
  const conta = await db.contarLocal();
  const temLocal = conta.produtos + conta.clientes + conta.vendas > 0;
  if (!temLocal) return true;
  if (!navigator.onLine) {
    avisar('Conecte na internet para fazer a primeira sincronização.');
    return false;
  }
  const naNuvem = await nuvemTemDados();
  const resumo = `<strong>${conta.produtos}</strong> produtos, <strong>${conta.clientes}</strong> clientes e <strong>${conta.vendas}</strong> vendas`;
  let escolha;
  if (!naNuvem) {
    escolha = await escolher('Enviar seus dados para a nuvem',
      `Este aparelho tem ${resumo}. Eles vão ser enviados para a nuvem e vão aparecer também nos seus outros aparelhos.`,
      [{ rotulo: '☁️ Enviar para a nuvem', valor: 'enviar', principal: true }]);
  } else {
    escolha = await escolher('A nuvem já tem dados',
      `A nuvem já tem os dados enviados pelo seu outro aparelho. Este aparelho também tem ${resumo}.<br><br>
       <strong>Recomendado:</strong> usar os dados da nuvem. O que está neste aparelho é trocado pelo que está na nuvem.<br><br>
       Só escolha "juntar" se este aparelho tiver coisas que não existem no outro (pode repetir produtos e clientes).`,
      [
        { rotulo: '☁️ Usar os dados da nuvem (recomendado)', valor: 'nuvem', principal: true },
        { rotulo: 'Juntar com os dados deste aparelho', valor: 'juntar' },
      ]);
  }
  if (escolha === 'nuvem') {
    await db.limparTudoLocal();
    document.dispatchEvent(new CustomEvent('dados-mudaram'));
  } else {
    const n = await enviarTudo();
    avisar(`${n} registros enviados para a nuvem`);
  }
  return true;
}

// ---------- Entrar / sair ----------

function mostrarLogin(mensagem = '') {
  if (estado.semNuvem && !mensagem) return;
  $('#tela-login').hidden = false;
  $('#login-erro').textContent = mensagem;
  $('#login-email').textContent = emailLiberado || 'a sua conta Google';
  $('#btn-sem-nuvem').hidden = jaUsouConta();
}

async function aoEntrar(usuario) {
  if (emailLiberado && usuario.email?.toLowerCase() !== emailLiberado.toLowerCase()) {
    await estado.fb.signOut(estado.auth);
    mostrarLogin(`A conta ${usuario.email} não tem acesso. Entre com ${emailLiberado}.`);
    return;
  }
  estado.usuario = usuario;
  estado.semNuvem = false;
  gravarPreferencia('contaGoogle', new Date().toISOString());
  $('#tela-login').hidden = true;
  document.body.classList.add('com-nuvem');
  mostrarSituacao('entrando');

  if (!lerPreferencia(chave('pronto'))) {
    const pronto = await primeiraVez();
    if (!pronto) { mostrarSituacao('offline'); setTimeout(() => aoEntrar(usuario), 15000); return; }
    gravarPreferencia(chave('pronto'), new Date().toISOString());
  }
  estado.paradas.push(db.aoMudar(enviar));
  for (const loja of db.LOJAS) ouvir(loja);
  estado.paradas.push(pararEscutas);
  atualizarSituacao();
  setTimeout(() => conferirComNuvem({ forcar: true }), 3000);
}

function aoSair() {
  estado.paradas.forEach((parar) => parar());
  estado.paradas = [];
  estado.usuario = null;
  document.body.classList.remove('com-nuvem');
  mostrarSituacao('desligada');
  mostrarLogin();
}

async function iniciar() {
  if (!config) { mostrarSituacao('desligada'); return; }
  mostrarSituacao('entrando');
  const fb = await import('./vendor/firebase.js');
  estado.fb = fb;
  const app = fb.initializeApp(config);
  estado.auth = fb.getAuth(app);
  estado.fs = fb.initializeFirestore(app, {
    localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
  if (EMULADOR) {
    fb.connectAuthEmulator(estado.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fb.connectFirestoreEmulator(estado.fs, '127.0.0.1', 8080);
    // Para os testes automáticos entrarem sem a janela do Google.
    window.entrarTeste = (email) => fb.signInWithCredential(estado.auth,
      fb.GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true })));
  }

  $('#btn-entrar-google').addEventListener('click', async () => {
    $('#login-erro').textContent = '';
    try {
      await fb.signInWithPopup(estado.auth, new fb.GoogleAuthProvider());
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        $('#login-erro').textContent = 'Não consegui entrar. Verifique a internet e tente de novo.';
        console.error(e);
      }
    }
  });
  $('#btn-sem-nuvem').addEventListener('click', () => {
    estado.semNuvem = true;
    $('#tela-login').hidden = true;
    mostrarSituacao('desligada');
  });
  $('#menu-entrar').addEventListener('click', () => {
    $('#dlg-menu').close();
    estado.semNuvem = false;
    mostrarLogin();
  });
  $('#menu-sair').addEventListener('click', async () => {
    $('#dlg-menu').close();
    const escolha = await escolher('Sair da conta?',
      `Para voltar a usar o sistema neste aparelho, é preciso entrar de novo com a sua conta Google. Nada é apagado da nuvem.<br><br>
       Se este aparelho não é seu (ou foi perdido/emprestado), escolha <strong>apagar deste aparelho</strong>: os dados somem só daqui e voltam quando você entrar de novo.`,
      [
        { rotulo: 'Sair e manter os dados aqui', valor: 'manter' },
        { rotulo: '🔒 Sair e apagar deste aparelho', valor: 'apagar' },
        { rotulo: 'Cancelar', valor: null, principal: true },
      ]);
    if (!escolha) return;
    if (escolha === 'apagar' && (estado.pendentes > 0 || !navigator.onLine)) {
      avisar(estado.pendentes > 0
        ? 'Ainda tem coisa sendo enviada para a nuvem. Espere aparecer "☁️ Sincronizado" e tente de novo.'
        : 'Sem internet: conecte antes de apagar, para garantir que tudo já está na nuvem.');
      return;
    }
    const uid = estado.usuario?.uid;
    await fb.signOut(estado.auth);
    if (escolha === 'apagar') await apagarDesteAparelho(uid);
  });

  fb.onAuthStateChanged(estado.auth, (usuario) => {
    if (usuario) aoEntrar(usuario).catch((e) => { console.error(e); mostrarSituacao('erro'); });
    else aoSair();
  });
}

// Apaga a cópia local (sistema + memória da nuvem) e recomeça do zero na próxima entrada.
async function apagarDesteAparelho(uid) {
  try {
    await db.limparTudoLocal();
    // Esquece o que já tinha recebido e ganha uma identidade nova (senão ignoraria o que ele mesmo enviou).
    Object.keys(localStorage).filter((k) => k.startsWith(`felipao.nuvem.${uid}.`) || k === 'felipao.idAparelho')
      .forEach((k) => localStorage.removeItem(k));
    await estado.fb.terminate(estado.fs);
    await estado.fb.clearIndexedDbPersistence(estado.fs);
  } catch (e) { console.error(e); }
  location.reload();
}

// Informações da conta no menu.
document.querySelectorAll('.btn-abrir-menu').forEach((b) => b.addEventListener('click', () => {
  $('#menu-nuvem').hidden = !estado.usuario;
  $('#menu-entrar').hidden = !!estado.usuario || !config;
  if (estado.usuario) $('#menu-nuvem-info').textContent = `Conectado como ${estado.usuario.email}. ${TEXTOS[estado.situacao] || ''}`;
}));

iniciar().catch((e) => { console.error(e); mostrarSituacao('erro'); });
