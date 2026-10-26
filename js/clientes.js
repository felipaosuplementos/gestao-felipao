import * as db from './db.js';
import { lerCsv, lerNumero, linhasParaDevedores, csvClientes, csvFiadoSeparado, baixarArquivo } from './planilha.js';
import {
  $, moedaCentavos, paraCentavos, esc, semAcento, dataHora, hojeISO, dataCurta,
  avisar, confirmar, confirmarComMotivo, lerPreferencia, gravarPreferencia,
} from './comum.js';
import { situacaoCliente, dividirParcelas, somarMeses, linkWhatsApp } from './fiado.js';
import {
  TEXTO_PADRAO, textoCobranca, valorCobrar, mensagemCobranca, linkCobranca, dataAtalho, comCobrancaFeita, resumoCobrancas,
} from './lembrete.js';

const DIAS_ATRASO = 30;
const DIAS_AVISO_BACKUP = 7;
const FORMAS = ['Pix', 'Dinheiro', 'Cartão', 'Outro'];

const estado = {
  itens: [], // { cliente, lancamentos, situacao }
  filtro: 'devendo',
  busca: '',
  modo: 'clientes', // 'clientes' (lista) ou 'cobrancas'
};

const chaveNome = (nome) => semAcento(nome).replace(/\s+/g, ' ').trim();
const iniciaisCliente = (nome) => esc((nome || '?').split(/\s+/).filter((w) => /^[\p{L}\d]/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase());

// ---------- Carregar ----------

async function carregar() {
  const [clientes, lancamentos] = await Promise.all([db.listarClientes(), db.listarLancamentos()]);
  const porCliente = new Map(clientes.map((c) => [c.id, []]));
  for (const l of lancamentos) porCliente.get(l.clienteId)?.push(l);
  const hoje = hojeISO();
  estado.itens = clientes.map((cliente) => {
    const lancs = porCliente.get(cliente.id);
    return { cliente, lancamentos: lancs, situacao: situacaoCliente(lancs, hoje) };
  });
  render();
}

// ---------- Lista ----------

const FILTROS = [
  { id: 'devendo', nome: 'Devendo', teste: (i) => i.situacao.saldo > 0 },
  { id: 'atrasados', nome: `Mais de ${DIAS_ATRASO} dias`, teste: (i) => i.situacao.vencido > 0 && i.situacao.diasAtraso > DIAS_ATRASO },
  { id: 'lembretes', nome: '⏰ Cobrar', teste: (i) => !!i.cliente.lembrete },
  { id: 'quitados', nome: 'Quitados', teste: (i) => i.situacao.saldo === 0 },
  { id: 'todos', nome: 'Todos', teste: () => true },
];

// Quem deve há mais tempo primeiro; na mesma data, a ordem da planilha; depois quem deve mais.
const ordemDevendo = (a, b) => (a.situacao.chaveDesde || '9999').localeCompare(b.situacao.chaveDesde || '9999')
  || a.situacao.ordemDesde - b.situacao.ordemDesde || b.situacao.saldo - a.situacao.saldo;
const ordemNome = (a, b) => a.cliente.nome.localeCompare(b.cliente.nome, 'pt-BR');

const quandoLembrete = (c) => `${c.lembrete.data}T${c.lembrete.hora}`;
const ordemLembrete = (a, b) => quandoLembrete(a.cliente).localeCompare(quandoLembrete(b.cliente));

function ordenar(lista) {
  if (estado.filtro === 'lembretes') return lista.sort(ordemLembrete);
  return lista.sort(estado.filtro === 'devendo' || estado.filtro === 'atrasados' ? ordemDevendo : ordemNome);
}

// Para as planilhas: quem deve (na ordem da tela) e quem já pagou (por nome).
function separarDevendoQuitados() {
  const devendo = estado.itens.filter((i) => i.situacao.saldo > 0).sort(ordemDevendo);
  const quitados = estado.itens.filter((i) => i.situacao.saldo === 0).sort(ordemNome);
  return { devendo, quitados };
}

function visiveis() {
  const termos = semAcento(estado.busca).split(/\s+/).filter(Boolean);
  const verArquivados = estado.filtro === 'arquivados';
  const filtro = FILTROS.find((f) => f.id === estado.filtro);
  return ordenar(estado.itens.filter((i) => {
    if (!!i.cliente.arquivado !== verArquivados) return false;
    if (filtro && !filtro.teste(i)) return false;
    const texto = semAcento(`${i.cliente.nome} ${i.cliente.whatsapp || ''} ${i.cliente.observacao || ''}`);
    return termos.every((t) => texto.includes(t));
  }));
}

function textoDesde(s) {
  if (!s.desde) return '';
  const dias = s.diasAtraso;
  if (s.desdeAproximado) return `deve desde antes de ${dataCurta(s.desde)}`;
  return `deve desde ${dataCurta(s.desde)} · ${dias === 0 ? 'hoje' : dias === 1 ? '1 dia' : `${dias} dias`}`;
}

// Valor a cobrar: o que já venceu; se nada venceu, o total.
function textoLembrete(c) {
  if (!c.lembrete) return '';
  const { data } = c.lembrete;
  const hoje = hojeISO();
  const quando = data < hoje ? `atrasado (era ${dataCurta(data)})` : data === hoje ? 'hoje' : data === dataAtalho('+1') ? 'amanhã' : dataCurta(data);
  return `⏰ cobrar ${quando}`;
}

function linhaSituacao(s, c = null) {
  const partes = [];
  if (c?.lembrete) partes.push(textoLembrete(c));
  if (s.saldo === 0) partes.push(s.credito ? `crédito de ${moedaCentavos(s.credito)}` : 'nada a pagar');
  if (s.desde) partes.push(textoDesde(s));
  if (s.proximoVencimento) partes.push(`a vencer ${dataCurta(s.proximoVencimento.data)}: ${moedaCentavos(s.proximoVencimento.valor)}`);
  return partes.join(' · ');
}

function classeSaldo(s) {
  if (s.saldo === 0) return 'quitado';
  if (s.vencido === 0) return 'a-vencer';
  return s.diasAtraso > DIAS_ATRASO ? 'atrasado' : 'vencido';
}

function render() {
  const ativos = estado.itens.filter((i) => !i.cliente.arquivado);
  const soma = (campo) => ativos.reduce((t, i) => t + i.situacao[campo], 0);
  $('#total-receber').textContent = moedaCentavos(soma('saldo'));
  $('#total-vencido').textContent = moedaCentavos(soma('vencido'));
  $('#total-a-vencer').textContent = moedaCentavos(soma('aVencer'));

  const chips = FILTROS.map((f) => `<button class="chip" data-filtro="${f.id}" aria-pressed="${estado.filtro === f.id}">${f.nome} (${ativos.filter(f.teste).length})</button>`);
  if (estado.filtro === 'arquivados') chips.push('<button class="chip" data-filtro="arquivados" aria-pressed="true">Arquivados</button>');
  $('#chips-clientes').innerHTML = chips.join('');

  $('#vazio-clientes').hidden = estado.itens.length > 0;
  const lista = visiveis();
  $('#contagem-clientes').textContent = estado.itens.length ? `${lista.length} ${lista.length === 1 ? 'cliente' : 'clientes'}` : '';
  $('#lista-clientes').innerHTML = lista.map(({ cliente: c, situacao: s }) => `
    <li><button class="item" data-id="${c.id}">
      <div class="miniatura avatar">${iniciaisCliente(c.nome)}</div>
      <div class="item-info">
        <div class="item-nome">${esc(c.nome)}</div>
        <div class="item-sub item-sub-quebra">${esc(linhaSituacao(s, c))}</div>
      </div>
      <div class="saldo ${classeSaldo(s)}">${s.saldo ? moedaCentavos(s.saldo) : '✓'}</div>
    </button></li>`).join('');
  renderAvisoBackup();
  renderCobrancas();
  aplicarModo();
}

// ---------- Cobranças (tudo dentro do sistema) ----------

function gruposCobranca() {
  const hoje = hojeISO();
  const ativos = estado.itens.filter((i) => !i.cliente.arquivado && i.situacao.saldo > 0);
  const marcados = ativos.filter((i) => i.cliente.lembrete)
    .sort((a, b) => a.cliente.lembrete.data.localeCompare(b.cliente.lembrete.data) || ordemDevendo(a, b));
  return {
    atrasadas: marcados.filter((i) => i.cliente.lembrete.data < hoje),
    hoje: marcados.filter((i) => i.cliente.lembrete.data === hoje),
    proximas: marcados.filter((i) => i.cliente.lembrete.data > hoje),
    // Quem deve há bastante tempo e ainda não tem dia marcado para cobrar.
    semMarcar: ativos.filter((i) => !i.cliente.lembrete && i.situacao.vencido > 0 && i.situacao.diasAtraso > DIAS_ATRASO).sort(ordemDevendo),
  };
}

function cartaoCobranca(item, grupo) {
  const { cliente: c, situacao: s } = item;
  const valor = valorCobrar(s);
  const link = linkCobranca(c, mensagemCobranca(textoCobranca(), c, valor));
  const partes = [];
  if (grupo === 'atrasadas') partes.push(`era para ${dataCurta(c.lembrete.data)}`);
  if (grupo === 'proximas') partes.push(`cobrar ${c.lembrete.data === dataAtalho('+1') ? 'amanhã' : dataCurta(c.lembrete.data)}`);
  if (s.desde) partes.push(textoDesde(s));
  const historico = resumoCobrancas(c);
  if (historico) partes.push(historico);
  return `
    <li class="cobranca">
      <button class="cobranca-topo" data-id="${c.id}">
        <div class="miniatura avatar">${iniciaisCliente(c.nome)}</div>
        <div class="item-info">
          <div class="item-nome">${esc(c.nome)}</div>
          <div class="item-sub item-sub-quebra">${esc(partes.join(' · '))}</div>
        </div>
        <div class="saldo ${classeSaldo(s)}">${moedaCentavos(valor)}</div>
      </button>
      <div class="cobranca-acoes">
        <a class="btn" href="${link}" target="_blank" rel="noopener" data-cobrar>💬 Cobrar</a>
        ${grupo === 'semMarcar'
    ? `<button class="btn btn-primario" data-remarcar="${c.id}">📅 Marcar dia</button>`
    : `<button class="btn btn-primario" data-cobrei="${c.id}">✓ Cobrei</button>
        <button class="btn" data-remarcar="${c.id}">📅 Remarcar</button>`}
      </div>
    </li>`;
}

function renderCobrancas() {
  const g = gruposCobranca();
  const blocos = [
    ['atrasadas', 'Atrasadas', 'grupo-atrasado'],
    ['hoje', 'Hoje', ''],
    ['proximas', 'Próximos dias', ''],
    ['semMarcar', `Devendo há mais de ${DIAS_ATRASO} dias sem cobrança marcada`, 'grupo-suave'],
  ].filter(([id]) => g[id].length || id === 'hoje').map(([id, nome, classe]) => `
    <h2 class="grupo-titulo ${classe}">${nome}${g[id].length ? ` <span>${g[id].length}</span>` : ''}</h2>
    ${g[id].length ? `<ul class="lista lista-cobrancas">${g[id].map((i) => cartaoCobranca(i, id)).join('')}</ul>`
    : '<p class="tarefas-vazio">Nenhuma cobrança para hoje 🎉</p>'}`);
  $('#lista-cobrancas').innerHTML = blocos.join('') + (g.atrasadas.length + g.hoje.length + g.proximas.length ? ''
    : '<p class="descricao">Para marcar uma cobrança, abra o cliente e toque em ⏰ Marcar cobrança.</p>');
  const n = g.atrasadas.length + g.hoje.length;
  for (const el of [$('#clientes-contador'), $('#cobrancas-contador')]) {
    el.textContent = String(n);
    el.hidden = !n;
  }
}

function aplicarModo() {
  const cobrancas = estado.modo === 'cobrancas';
  $('#clientes-modo').querySelectorAll('[data-modo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === estado.modo)));
  $('#clientes-filtros').hidden = cobrancas;
  $('#clientes-area').hidden = cobrancas;
  $('#lista-cobrancas').hidden = !cobrancas;
  $('#btn-novo-cliente').hidden = cobrancas;
}

$('#clientes-modo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-modo]');
  if (!b) return;
  estado.modo = b.dataset.modo;
  aplicarModo();
  window.scrollTo(0, 0);
});

$('#lista-cobrancas').addEventListener('click', (e) => {
  if (e.target.closest('[data-cobrar]')) { avisar('Depois de mandar a mensagem, toque em ✓ Cobrei'); return; }
  const cobrei = e.target.closest('[data-cobrei]');
  if (cobrei) { abrirCobrei(itemDo(cobrei.dataset.cobrei)); return; }
  const remarcar = e.target.closest('[data-remarcar]');
  if (remarcar) { abrirLembrete(itemDo(remarcar.dataset.remarcar)); return; }
  const abrir = e.target.closest('[data-id]');
  if (abrir) abrirCliente(abrir.dataset.id);
});

// Painel → "cobranças para hoje" abre direto esta lista.
document.addEventListener('mostrar-cobrancas', () => {
  estado.modo = 'cobrancas';
  document.dispatchEvent(new CustomEvent('mostrar-tela', { detail: 'clientes' }));
});

function renderAvisoBackup() {
  const el = $('#aviso-backup-clientes');
  if (!estado.itens.length) { el.hidden = true; return; }
  const ultimo = lerPreferencia('ultimoBackupFiado');
  const dias = ultimo ? (Date.now() - new Date(ultimo).getTime()) / 86400000 : Infinity;
  if (dias < DIAS_AVISO_BACKUP) { el.hidden = true; return; }
  el.innerHTML = `<strong>Faça um backup do fiado.</strong> Os dados ficam só neste aparelho. ${ultimo ? `Último backup: ${dataHora(ultimo)}.` : 'Você ainda não fez nenhum backup do fiado.'}
    <br><button class="btn" id="btn-backup-fiado-aviso">⬇️ Baixar planilha agora</button>`;
  el.hidden = false;
  $('#btn-backup-fiado-aviso').onclick = exportarFiado;
}

// ---------- Ficha do cliente ----------

let clienteAberto = null;

function itemDo(id) { return estado.itens.find((i) => i.cliente.id === id); }

function descricaoLancamento(l) {
  if (l.tipo === 'pagamento') return `Pagamento${l.forma ? ` — ${l.forma}` : ''}${l.descricao ? ` · ${l.descricao}` : ''}`;
  return `Fiado${l.descricao ? ` — ${l.descricao}` : ''}`;
}

function abrirCliente(id) {
  const item = itemDo(id);
  if (!item) return;
  clienteAberto = id;
  const { cliente: c, situacao: s, lancamentos } = item;
  const zap = linkWhatsApp(c.whatsapp);
  const cobrar = s.saldo > 0 ? linkCobranca(c, mensagemCobranca(textoCobranca(), c, valorCobrar(s))) : null;
  const hoje = hojeISO();
  const aVencer = s.abertos.filter((d) => (d.vencimento || d.data) > hoje);
  const historico = [...lancamentos].sort((a, b) => b.data.localeCompare(a.data) || b.registradoEm.localeCompare(a.registradoEm));

  $('#cliente-conteudo').innerHTML = `
    <div class="cliente-cabecalho">
      <div class="miniatura avatar avatar-grande">${iniciaisCliente(c.nome)}</div>
      <div>
        <h2 class="detalhe-nome">${esc(c.nome)}</h2>
        <p class="detalhe-sub">${c.whatsapp ? esc(c.whatsapp) : 'Sem WhatsApp cadastrado'}${c.arquivado ? ' <span class="etiqueta">Arquivado</span>' : ''}</p>
      </div>
    </div>
    ${c.observacao ? `<p class="descricao">${esc(c.observacao)}</p>` : ''}
    <div class="estoque-caixa saldo-caixa ${classeSaldo(s)}">
      <div class="rotulo">${s.saldo ? 'Deve' : 'Situação'}</div>
      <div class="numero">${s.saldo ? moedaCentavos(s.saldo) : 'Em dia ✓'}</div>
      <div class="rotulo">${esc(linhaSituacao(s)) || '&nbsp;'}</div>
      ${s.vencido && s.aVencer ? `<div class="rotulo">Para cobrar: ${moedaCentavos(s.vencido)} · A vencer: ${moedaCentavos(s.aVencer)}</div>` : ''}
      ${c.lembrete ? `<div class="lembrete-caixa">${esc(textoLembrete(c))}
        <button class="btn-texto" data-acao="lembrete-feito">✓ Cobrei</button></div>` : ''}
      <div class="estoque-botoes">
        <button class="btn btn-primario" data-lanc="fiado">＋ Fiado</button>
        <button class="btn" data-lanc="pagamento" ${s.saldo ? '' : 'disabled'}>💵 Recebi pagamento</button>
      </div>
    </div>
    <div class="acoes-produto">
      ${cobrar ? `<a class="btn" href="${cobrar}" target="_blank" rel="noopener">💬 Cobrar no WhatsApp</a>`
    : zap ? `<a class="btn" href="${zap}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
      ${s.saldo > 0 ? `<button class="btn" data-acao="lembrete">${c.lembrete ? '📅 Mudar dia da cobrança' : '⏰ Marcar cobrança'}</button>` : ''}
      <button class="btn" data-acao="editar">✏️ Editar</button>
      <button class="btn" data-acao="${c.arquivado ? 'restaurar' : 'arquivar'}">${c.arquivado ? '♻️ Restaurar' : '🗂️ Arquivar'}</button>
    </div>
    ${aVencer.length ? `<h3>A vencer</h3><ul class="historico">${aVencer.map((d) => `
      <li><div>${dataCurta(d.vencimento || d.data)}${d.parcela ? ` · parcela ${esc(d.parcela)}` : ''}<small>${esc(d.descricao || '')}</small></div>
      <span class="dif">${moedaCentavos(d.restante)}</span></li>`).join('')}</ul>` : ''}
    ${c.cobrancas?.length ? `<h3>Cobranças feitas (${c.cobrancas.length})</h3>
    <p class="descricao">${[...c.cobrancas].reverse().slice(0, 10).map((x) => dataHora(x.em)).join(' · ')}</p>` : ''}
    <h3>Histórico</h3>
    ${historico.length ? `<ul class="historico">${historico.map((l) => `
      <li class="${l.cancelado ? 'cancelado' : ''}">
        <div>${esc(descricaoLancamento(l))}
          <small>${dataCurta(l.data)}${l.dataAproximada ? ' (data aproximada)' : ''}${l.parcela ? ` · parcela ${esc(l.parcela)} · vence ${dataCurta(l.vencimento)}` : l.vencimento ? ` · vence ${dataCurta(l.vencimento)}` : ''} · registrado em ${dataHora(l.registradoEm)}</small>
          ${l.cancelado ? `<small class="erros">Cancelado em ${dataHora(l.cancelado.em)}${l.cancelado.motivo ? ` — ${esc(l.cancelado.motivo)}` : ''}</small>`
            : l.vendaId ? '<small>Veio de uma venda: para corrigir, edite ou cancele a venda na tela Vender.</small>'
              : `<button class="btn-texto btn-cancelar" data-cancelar="${l.id}">cancelar lançamento</button>`}
        </div>
        <span class="dif ${l.tipo === 'fiado' ? 'menos' : 'mais'}">${l.tipo === 'fiado' ? '+' : '−'}${moedaCentavos(l.valor)}</span>
      </li>`).join('')}</ul>`
    : '<p class="descricao">Nenhum lançamento ainda.</p>'}
  `;
  const dlg = $('#dlg-cliente');
  if (!dlg.open) dlg.showModal();
}

$('#cliente-conteudo').addEventListener('click', async (e) => {
  const item = itemDo(clienteAberto);
  if (!item) return;
  const lanc = e.target.closest('[data-lanc]');
  if (lanc) return abrirLancamento(item, lanc.dataset.lanc);

  const cancelar = e.target.closest('[data-cancelar]');
  if (cancelar) {
    const l = item.lancamentos.find((x) => x.id === cancelar.dataset.cancelar);
    const motivo = await confirmarComMotivo(
      'Cancelar lançamento?',
      `${descricaoLancamento(l)} de ${moedaCentavos(l.valor)} (${dataCurta(l.data)}) deixa de contar no saldo. Ele continua no histórico como cancelado.`,
      'Cancelar lançamento',
    );
    if (motivo === null) return;
    await db.cancelarLancamento(l.id, motivo);
    avisar('Lançamento cancelado');
    await carregar();
    return abrirCliente(item.cliente.id);
  }

  const acao = e.target.closest('[data-acao]')?.dataset.acao;
  if (acao === 'editar') abrirFormCliente(item.cliente);
  if (acao === 'lembrete') abrirLembrete(item);
  if (acao === 'lembrete-feito') abrirCobrei(item);
  if (acao === 'arquivar') {
    if (item.situacao.saldo > 0) { avisar('Só dá para arquivar quem não deve nada.'); return; }
    const ok = await confirmar('Arquivar cliente?', `${item.cliente.nome} sai da lista, mas nada é apagado. Dá para restaurar em Menu → Ver clientes arquivados.`, 'Arquivar');
    if (!ok) return;
    await db.salvarCliente({ ...item.cliente, arquivado: true });
    $('#dlg-cliente').close();
    avisar('Cliente arquivado');
    await carregar();
  }
  if (acao === 'restaurar') {
    await db.salvarCliente({ ...item.cliente, arquivado: false });
    $('#dlg-cliente').close();
    avisar('Cliente restaurado');
    await carregar();
  }
});

// ---------- Marcar cobrança / Cobrei ----------

let lembreteAtual = null;

async function salvarLembrete(cliente, lembrete) {
  const { lembrete: _antigo, ...resto } = cliente;
  await db.salvarCliente(lembrete ? { ...resto, lembrete } : resto);
  await carregar();
  if ($('#dlg-cliente').open) abrirCliente(cliente.id);
}

function abrirLembrete(item) {
  lembreteAtual = item;
  const { cliente: c, situacao: s } = item;
  const form = $('#form-lembrete');
  form.reset();
  form.data.value = c.lembrete?.data || '';
  form.data.min = hojeISO();
  $('#lembrete-cliente').textContent = `${c.nome} — cobrar ${moedaCentavos(valorCobrar(s))}`;
  $('#lembrete-remover').hidden = !c.lembrete;
  $('#dlg-lembrete').showModal();
}

async function marcarDia(data) {
  const item = lembreteAtual;
  $('#dlg-lembrete').close();
  await salvarLembrete(item.cliente, { data, criadoEm: new Date().toISOString() });
  avisar(`Cobrança de ${item.cliente.nome} marcada para ${data === dataAtalho('+1') ? 'amanhã' : dataCurta(data)}`);
}

// Atalho (Amanhã, Em 3 dias…) já salva com um toque.
$('#dlg-lembrete').addEventListener('click', (e) => {
  const atalho = e.target.closest('[data-atalho]');
  if (atalho) marcarDia(dataAtalho(atalho.dataset.atalho));
});

$('#form-lembrete').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = e.target.data.value;
  if (!data) { avisar('Escolha o dia'); return; }
  marcarDia(data);
});

$('#lembrete-remover').addEventListener('click', async () => {
  $('#dlg-lembrete').close();
  await salvarLembrete(lembreteAtual.cliente, null);
  avisar('Cobrança desmarcada');
});

let cobreiAtual = null;

function abrirCobrei(item) {
  cobreiAtual = item;
  const form = $('#form-cobrei');
  form.reset();
  form.data.min = dataAtalho('+1');
  $('#cobrei-cliente').textContent = `${item.cliente.nome} — ${moedaCentavos(valorCobrar(item.situacao))}`;
  $('#dlg-cobrei').showModal();
}

// Registra a cobrança (data e hora) e marca a próxima, se escolheu.
async function concluirCobrei(proxima) {
  const { cliente, situacao } = cobreiAtual;
  $('#dlg-cobrei').close();
  await db.salvarCliente(comCobrancaFeita(cliente, valorCobrar(situacao), proxima));
  await carregar();
  if ($('#dlg-cliente').open) abrirCliente(cliente.id);
  avisar(proxima ? `Cobrança registrada · próxima ${dataCurta(proxima)}` : 'Cobrança registrada');
}

$('#dlg-cobrei').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-proxima]');
  if (chip) concluirCobrei(chip.dataset.proxima ? dataAtalho(chip.dataset.proxima) : null);
});

$('#form-cobrei').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = e.target.data.value;
  if (!data) { avisar('Escolha o dia ou toque em "Não remarcar"'); return; }
  concluirCobrei(data);
});

// Texto da mensagem de cobrança (menu).
$('#menu-texto-cobranca').addEventListener('click', () => {
  $('#dlg-menu').close();
  $('#texto-cobranca').value = textoCobranca();
  $('#dlg-texto-cobranca').showModal();
});
$('#form-texto-cobranca').addEventListener('submit', (e) => {
  e.preventDefault();
  const texto = $('#texto-cobranca').value.trim();
  gravarPreferencia('textoCobranca', texto && texto !== TEXTO_PADRAO ? texto : '');
  $('#dlg-texto-cobranca').close();
  avisar('Texto da cobrança salvo');
});
$('#texto-cobranca-padrao').addEventListener('click', () => { $('#texto-cobranca').value = TEXTO_PADRAO; });

// ---------- Cadastro de cliente ----------

let clienteEditando = null;

function abrirFormCliente(cliente = null) {
  clienteEditando = cliente;
  const form = $('#form-cliente');
  form.reset();
  $('#form-cliente-aviso').textContent = '';
  $('#form-cliente-titulo').textContent = cliente ? 'Editar cliente' : 'Novo cliente';
  if (cliente) {
    form.nome.value = cliente.nome;
    form.whatsapp.value = cliente.whatsapp || '';
    form.observacao.value = cliente.observacao || '';
  }
  $('#dlg-form-cliente').showModal();
  form.nome.focus();
}

$('#form-cliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const nome = form.nome.value.trim().replace(/\s+/g, ' ');
  if (!nome) { form.nome.focus(); $('#form-cliente-aviso').textContent = 'Preencha o nome.'; return; }
  const repetido = estado.itens.find((i) => chaveNome(i.cliente.nome) === chaveNome(nome) && i.cliente.id !== clienteEditando?.id);
  if (repetido) {
    $('#form-cliente-aviso').textContent = `Já existe um cliente chamado "${repetido.cliente.nome}". Coloque um sobrenome ou apelido para diferenciar.`;
    return;
  }
  const novo = !clienteEditando;
  const cliente = await db.salvarCliente({
    ...(clienteEditando || { id: db.novoId(), arquivado: false }),
    nome,
    whatsapp: form.whatsapp.value.trim(),
    observacao: form.observacao.value.trim(),
  });
  $('#dlg-form-cliente').close();
  avisar(novo ? 'Cliente cadastrado' : 'Alterações salvas');
  await carregar();
  abrirCliente(cliente.id);
});

// ---------- Fiado / pagamento ----------

let lancAtual = null; // { item, tipo }

function abrirLancamento(item, tipo) {
  lancAtual = { item, tipo };
  const form = $('#form-lanc');
  form.reset();
  const fiado = tipo === 'fiado';
  const s = item.situacao;
  $('#lanc-titulo').textContent = fiado ? 'Vender fiado' : 'Recebi pagamento';
  $('#lanc-cliente').textContent = `${item.cliente.nome} — deve ${moedaCentavos(s.saldo)}`;
  $('#lanc-descricao-rotulo').firstChild.textContent = fiado ? 'O que levou' : 'Observação';
  form.descricao.placeholder = fiado ? 'Ex.: Whey Fort 3W chocolate' : 'Opcional';
  form.data.value = hojeISO();
  form.data.max = hojeISO();
  form.vencimento.value = '';
  form.vencimento.min = hojeISO();
  $('#lanc-data-rotulo').firstChild.textContent = fiado ? 'Dia da compra' : 'Data';
  $('#lanc-parcelamento').hidden = !fiado;
  $('#lanc-formas').hidden = fiado;
  $('#lanc-formas').innerHTML = FORMAS.map((f, i) => `<button type="button" class="chip" data-forma="${f}" aria-pressed="${i === 0}">${f}</button>`).join('');
  const atalhos = [];
  if (!fiado) {
    atalhos.push(`<button type="button" class="chip" data-valor="${s.saldo}">Tudo: ${moedaCentavos(s.saldo)}</button>`);
    if (s.vencido && s.vencido !== s.saldo) atalhos.push(`<button type="button" class="chip" data-valor="${s.vencido}">Só o que já venceu: ${moedaCentavos(s.vencido)}</button>`);
  }
  $('#lanc-atalhos').innerHTML = atalhos.join('');
  $('#lanc-atalhos').hidden = fiado;
  atualizarLancamento();
  $('#dlg-lanc').showModal();
  form.valor.focus();
}

function valorDigitado() {
  const n = lerNumero($('#form-lanc').valor.value);
  return n == null || n <= 0 ? 0 : paraCentavos(n);
}

function parcelasDoForm() {
  const form = $('#form-lanc');
  const qtd = Number(form.parcelas.value);
  const valor = valorDigitado();
  if (qtd <= 1 || !valor || !form.vencimento.value) return null;
  return dividirParcelas(valor, qtd, form.vencimento.value);
}

function atualizarLancamento() {
  const { item, tipo } = lancAtual;
  const form = $('#form-lanc');
  const valor = valorDigitado();
  const saldo = item.situacao.saldo;
  if (tipo === 'fiado') {
    const parcelado = Number(form.parcelas.value) > 1;
    // Parcelado sempre tem vencimento: começa daqui a um mês.
    if (parcelado && !form.vencimento.value) form.vencimento.value = somarMeses(hojeISO(), 1);
    $('#lanc-venc-texto').textContent = parcelado ? '1º vencimento' : 'Vence em (opcional)';
    $('#lanc-venc-dica').hidden = parcelado;
    const parcelas = parcelasDoForm();
    $('#lanc-parcelas').innerHTML = parcelas
      ? parcelas.map((p) => `<li>Parcela ${p.parcela}: <strong>${moedaCentavos(p.valor)}</strong> — vence ${dataCurta(p.vencimento)}</li>`).join('')
      : '';
    const venceDepois = !parcelado && form.vencimento.value > hojeISO();
    $('#lanc-resultado').textContent = valor
      ? `Vai ficar devendo ${moedaCentavos(saldo + valor)}${venceDepois ? ` (${moedaCentavos(valor)} vence em ${dataCurta(form.vencimento.value)})` : ''}`
      : '';
  } else {
    const fica = saldo - valor;
    $('#lanc-resultado').textContent = !valor ? ''
      : fica >= 0 ? `Vai ficar devendo ${moedaCentavos(fica)}${fica === 0 ? ' — quitado! 🎉' : ''}`
        : `Pagou ${moedaCentavos(-fica)} a mais: fica como crédito para a próxima compra`;
  }
  $('#lanc-confirmar').disabled = !valor;
}

$('#form-lanc').addEventListener('input', atualizarLancamento);
$('#form-lanc').addEventListener('change', atualizarLancamento);
$('#dlg-lanc').addEventListener('click', (e) => {
  const atalho = e.target.closest('[data-valor]');
  if (atalho) {
    $('#form-lanc').valor.value = (Number(atalho.dataset.valor) / 100).toFixed(2).replace('.', ',');
    atualizarLancamento();
  }
  const forma = e.target.closest('[data-forma]');
  if (forma) $('#lanc-formas').querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === forma));
});

$('#form-lanc').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { item, tipo } = lancAtual;
  const form = e.target;
  const valor = valorDigitado();
  if (!valor) { avisar('Digite o valor'); return; }
  const data = form.data.value || hojeISO();
  if (data > hojeISO()) {
    avisar(tipo === 'fiado' ? 'O dia da compra não pode ser no futuro. Para cobrar depois, use "Vence em".' : 'A data não pode ser no futuro');
    return;
  }
  const base = { clienteId: item.cliente.id, tipo, data, descricao: form.descricao.value.trim() };
  let lancamentos;
  if (tipo === 'pagamento') {
    lancamentos = [{ ...base, valor, forma: $('#lanc-formas .chip[aria-pressed="true"]')?.dataset.forma || '' }];
  } else {
    const parcelas = parcelasDoForm();
    const grupo = parcelas ? db.novoId() : undefined;
    const vencimento = form.vencimento.value > data ? form.vencimento.value : undefined;
    lancamentos = parcelas
      ? parcelas.map((p) => ({ ...base, valor: p.valor, vencimento: p.vencimento, parcela: p.parcela, grupo }))
      : [{ ...base, valor, ...(vencimento ? { vencimento } : {}) }];
  }
  await db.gravarFiado({ lancamentos });
  // Quitou tudo: o lembrete de cobrança não é mais necessário.
  if (tipo === 'pagamento' && item.cliente.lembrete && valor >= item.situacao.saldo) {
    const { lembrete: _l, ...semLembrete } = item.cliente;
    await db.salvarCliente(semLembrete);
  }
  $('#dlg-lanc').close();
  avisar(tipo === 'fiado' ? `Fiado de ${moedaCentavos(valor)} registrado` : `Pagamento de ${moedaCentavos(valor)} registrado`);
  await carregar();
  abrirCliente(item.cliente.id);
});

// ---------- Importar planilha de devedores ----------

let importacao = null;

function abrirImportacao() {
  importacao = null;
  $('#devedores-texto').value = '';
  $('#devedores-entrada').hidden = false;
  $('#devedores-previa').hidden = true;
  $('#devedores-confirmar').textContent = 'Conferir';
  $('#devedores-confirmar').disabled = false;
  $('#dlg-menu').close();
  $('#dlg-devedores').showModal();
}

function prepararImportacao(texto, origem) {
  const hoje = hojeISO();
  const { itens, ignoradas, erros } = linhasParaDevedores(lerCsv(texto), hoje);
  if (erros.length) { avisar(erros[0]); return; }
  const existentes = new Map(estado.itens.map((i) => [chaveNome(i.cliente.nome), i]));
  const novos = new Map(); // chave -> cliente novo
  const clientes = [];
  const lancamentos = [];
  const jaImportados = [];
  const paraExistentes = [];
  const contagem = new Map();
  // Parcelas do mesmo cliente não contam como nome repetido.
  for (const it of itens.filter((i) => !i.vencimento)) contagem.set(chaveNome(it.nome), [...(contagem.get(chaveNome(it.nome)) || []), it.valor]);

  const ordemAtualizada = []; // já importados antes, sem a ordem da planilha guardada
  for (const [posicao, it] of itens.entries()) {
    const chave = chaveNome(it.nome);
    const existente = existentes.get(chave);
    let clienteId;
    if (existente) {
      const repetido = existente.lancamentos.find((l) => l.origem === 'planilha' && !l.cancelado && l.valor === it.valor
        && (l.vencimento || '') === (it.vencimento || ''));
      if (repetido) {
        jaImportados.push(it);
        if (repetido.ordemPlanilha !== posicao) ordemAtualizada.push({ id: repetido.id, ordemPlanilha: posicao });
        continue;
      }
      clienteId = existente.cliente.id;
      paraExistentes.push(it);
    } else {
      if (!novos.has(chave)) {
        const c = { id: db.novoId(), nome: it.nome, whatsapp: it.whatsapp, observacao: it.observacao, arquivado: false };
        novos.set(chave, c);
        clientes.push(c);
      }
      clienteId = novos.get(chave).id;
    }
    lancamentos.push({
      clienteId, tipo: 'fiado', valor: it.valor, data: hoje, dataAproximada: true,
      descricao: it.vencimento ? 'Parcela da planilha de devedores' : 'Saldo da planilha de devedores', origem: 'planilha',
      ordemPlanilha: posicao,
      ...(it.vencimento ? { vencimento: it.vencimento, parcela: it.parcela } : {}),
    });
  }
  importacao = { clientes, lancamentos, ordemAtualizada };
  const total = lancamentos.reduce((s, l) => s + l.valor, 0);
  const repetidos = [...contagem].filter(([, v]) => v.length > 1);
  const nomeDe = (chave) => itens.find((i) => chaveNome(i.nome) === chave).nome;

  $('#devedores-previa').innerHTML = `
    <p>Origem: <strong>${esc(origem)}</strong></p>
    <div class="resumo-importacao">
      <div><strong>${clientes.length}</strong><small>clientes novos</small></div>
      <div><strong>${lancamentos.length}</strong><small>valores</small></div>
      <div><strong>${moedaCentavos(total).replace('R$', '').trim()}</strong><small>total (R$)</small></div>
    </div>
    <p class="descricao">A planilha não tem as datas, então cada valor entra marcado como "deve desde antes de ${dataCurta(hoje)}", e a lista segue a ordem da planilha (do mais antigo para o mais novo). Nada é apagado.</p>
    ${repetidos.length ? `<div class="aviso">${repetidos.map(([chave, v]) => `<strong>${esc(nomeDe(chave))}</strong> aparece ${v.length} vezes (${v.map(moedaCentavos).join(' + ')}): os valores vão para a mesma pessoa.`).join('<br>')}
      <br>Se forem pessoas diferentes, cancele, mude o nome de uma delas na planilha (ex.: "${esc(nomeDe(repetidos[0][0]))} 2") e importe de novo.</div>` : ''}
    ${paraExistentes.length ? `<p><strong>${paraExistentes.length}</strong> valores vão para clientes que já estão cadastrados: ${paraExistentes.map((i) => esc(i.nome)).join(', ')}.</p>` : ''}
    ${jaImportados.length ? `<p><strong>${jaImportados.length}</strong> já tinham sido importados antes e não entram de novo.${ordemAtualizada.length ? ` A ordem deles na lista vai ser atualizada para seguir a planilha.` : ''}</p>` : ''}
    ${ignoradas.length ? `<div class="aviso"><strong>Linhas que não entram</strong> (sem valor ou linha de total). Se for dívida, lance à mão na ficha do cliente:<br>${ignoradas.map(esc).join('<br>')}</div>` : ''}
    <ul class="previa">${lancamentos.map((l) => `<li>${esc(clientes.find((c) => c.id === l.clienteId)?.nome || estado.itens.find((i) => i.cliente.id === l.clienteId)?.cliente.nome)} — <strong>${moedaCentavos(l.valor)}</strong>${l.vencimento ? ` <small>· vence ${dataCurta(l.vencimento)}${l.parcela ? ` (parcela ${esc(l.parcela)})` : ''}</small>` : ''}</li>`).join('')}</ul>
  `;
  $('#devedores-entrada').hidden = true;
  $('#devedores-previa').hidden = false;
  $('#devedores-confirmar').textContent = lancamentos.length ? `Importar ${lancamentos.length} valores`
    : ordemAtualizada.length ? 'Atualizar a ordem' : 'Nada para importar';
  $('#devedores-confirmar').disabled = !lancamentos.length && !ordemAtualizada.length;
}

$('#devedores-confirmar').addEventListener('click', async () => {
  if (!importacao) {
    const texto = $('#devedores-texto').value;
    if (!texto.trim()) { avisar('Cole a lista ou escolha o arquivo'); return; }
    prepararImportacao(texto, 'lista colada');
    return;
  }
  const n = importacao.lancamentos.length;
  await db.gravarFiado(importacao);
  if (importacao.ordemAtualizada.length) await db.atualizarOrdemPlanilha(importacao.ordemAtualizada);
  importacao = null;
  $('#dlg-devedores').close();
  avisar(n ? `${n} valores importados` : 'Ordem da planilha atualizada');
  estado.filtro = 'devendo';
  await carregar();
});

$('#input-devedores').addEventListener('change', async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  if (/\.(pdf|xlsx?)$/i.test(arquivo.name)) {
    avisar('Use o arquivo CSV: no Google Planilhas, Arquivo → Fazer download → CSV.');
    return;
  }
  prepararImportacao(await arquivo.text(), arquivo.name);
});

// ---------- Exportação ----------

const hojeArquivo = () => new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');

async function exportarFiado() {
  await carregar();
  const { devendo, quitados } = separarDevendoQuitados();
  baixarArquivo(`felipao-fiado-${hojeArquivo()}.csv`, csvFiadoSeparado(devendo, quitados));
  gravarPreferencia('ultimoBackupFiado', new Date().toISOString());
  $('#dlg-menu').close();
  render();
  avisar('Planilha do fiado baixada');
}

$('#menu-exportar-fiado').addEventListener('click', exportarFiado);
$('#menu-exportar-clientes').addEventListener('click', () => {
  const { devendo, quitados } = separarDevendoQuitados();
  baixarArquivo(`felipao-quem-deve-${hojeArquivo()}.csv`, csvClientes(devendo, quitados));
  $('#dlg-menu').close();
  avisar('Lista de quem deve baixada');
});
$('#menu-importar-devedores').addEventListener('click', abrirImportacao);

// Recomeçar o fiado: baixa o backup, pede para digitar APAGAR, apaga e abre a importação.
$('#menu-fiado-zero').addEventListener('click', async () => {
  $('#dlg-menu').close();
  if (!estado.itens.length) { abrirImportacao(); return; }
  const ativos = estado.itens.filter((i) => !i.cliente.arquivado);
  const total = ativos.reduce((t, i) => t + i.situacao.saldo, 0);
  const resposta = await confirmarComMotivo(
    'Apagar todo o fiado?',
    `Vai apagar ${estado.itens.length} clientes e todo o histórico de fiado e pagamentos (hoje: ${moedaCentavos(total)} a receber). O estoque não é mexido. Antes de apagar, o sistema baixa uma planilha de backup. Para confirmar, digite APAGAR.`,
    'Apagar e começar do zero',
    'Digite APAGAR',
  );
  if (resposta === null) return;
  if (semAcento(resposta) !== 'apagar') { avisar('Nada foi apagado. Para confirmar, digite APAGAR.'); return; }
  await exportarFiado();
  await db.limparFiado();
  estado.filtro = 'devendo';
  await carregar();
  avisar('Fiado apagado. Backup baixado. Agora importe a planilha nova.');
  abrirImportacao();
});
$('#btn-importar-devedores-vazio').addEventListener('click', abrirImportacao);
$('#menu-clientes-arquivados').addEventListener('click', () => {
  estado.filtro = 'arquivados';
  $('#dlg-menu').close();
  document.dispatchEvent(new CustomEvent('mostrar-tela', { detail: 'clientes' }));
  render();
});

// ---------- Eventos ----------

$('#lista-clientes').addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (item) abrirCliente(item.dataset.id);
});
$('#chips-clientes').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filtro]');
  if (!chip) return;
  estado.filtro = chip.dataset.filtro === 'arquivados' ? 'devendo' : chip.dataset.filtro;
  render();
});
$('#busca-clientes').addEventListener('input', (e) => { estado.busca = e.target.value; render(); });
$('#btn-novo-cliente').addEventListener('click', () => abrirFormCliente());

// Recalcula ao abrir a tela (muda "dias de atraso" quando vira o dia).
document.addEventListener('tela-aberta', (e) => { if (e.detail === 'clientes') carregar(); });
// Outras telas (ex.: Tarefas) abrem a ficha de um cliente.
document.addEventListener('abrir-cliente', async (e) => { await carregar(); abrirCliente(e.detail); });
document.addEventListener('dados-mudaram', () => carregar());

carregar();
