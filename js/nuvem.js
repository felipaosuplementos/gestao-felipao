// Sincronização com a nuvem (Firebase).
// Cada aparelho continua com o seu banco local (funciona sem internet). Tudo o que muda aqui
// é enviado para a nuvem, e o que muda no outro aparelho chega e é gravado aqui.
// Os dados ficam em usuarios/{conta}/{loja} (produtos, fotos, clientes, lançamentos, vendas, tarefas, pedidos…).

import * as db from './db.js';
import { $, avisar, confirmar, lerPreferencia, gravarPreferencia, dataUrlParaBlob } from './comum.js';
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
  mostrarSituacao(navigator.onLine ? 'ok' : 'offline');
}
addEventListener('online', () => { atualizarSituacao(); reconectar(); });
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
    console.error(e);
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) reconectar(); });
addEventListener('pageshow', () => reconectar());
// Envio demorando: atualiza o aviso e tenta refazer a ligação (no máximo a cada 30 segundos).
setInterval(() => {
  if (!estado.pendentes) return;
  atualizarSituacao();
  if (Date.now() - enviandoDesde > DEMORA && Date.now() - ultimaReconexao > 30000) reconectar();
}, 5000);
// Tocar no aviso do topo também refaz a ligação.
document.addEventListener('click', (e) => { if (e.target.closest('.sync-status')) { ultimaReconexao = 0; reconectar(); } });

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
  const { writeBatch } = estado.fb;
  for (let i = 0; i < mudancas.length; i += 400) {
    const lote = writeBatch(estado.fs);
    for (const m of mudancas.slice(i, i + 400)) lote.set(refDoc(m.loja, idDo(m)), await paraNuvem(m));
    estado.pendentes++;
    atualizarSituacao();
    // Sem internet, o Firebase guarda e envia sozinho quando a conexão voltar.
    lote.commit()
      .catch((e) => { console.error(e); mostrarSituacao('erro'); })
      .finally(() => { estado.pendentes--; atualizarSituacao(); });
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

function ouvir(loja) {
  const { collection, query, where, onSnapshot, Timestamp } = estado.fb;
  const desde = Number(lerPreferencia(chave(`ultimo.${loja}`)) || 0);
  const consulta = query(collection(estado.fs, 'usuarios', estado.usuario.uid, loja), where('_sync', '>', Timestamp.fromMillis(desde)));
  return onSnapshot(consulta, async (snap) => {
    const itens = [];
    let maior = desde;
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
    if (maior > desde) gravarPreferencia(chave(`ultimo.${loja}`), String(maior));
  }, (erro) => { console.error(erro); mostrarSituacao('erro'); });
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
  for (const loja of db.LOJAS) estado.paradas.push(ouvir(loja));
  atualizarSituacao();
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
