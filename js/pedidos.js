// Lista "Para pedir": o que acabou e os produtos novos que o Felipão quer trazer.
// Cada item passa por A pedir → Já pedi → Chegou, com data e hora de cada passo.
// Fica em Produtos → 🛒 Para pedir (sem controle de estoque).

import * as db from './db.js';
import { gerarCsv, baixarArquivo } from './planilha.js';
import { $, esc, semAcento, dataHora, dataCurta, hojeISO, avisar, confirmar } from './comum.js';

const DIAS_CHEGARAM = 30; // quanto tempo os que chegaram continuam aparecendo
const SEM_MARCA = 'Sem marca';

const estado = {
  pedidos: [],
  produtos: [],
  modo: 'produtos', // 'produtos' (lista normal) ou 'pedidos'
  motivo: 'acabou',
  motivoEscolhido: false, // tocou num motivo: não troca sozinho
};

const chave = (s) => semAcento(s).replace(/\s+/g, ' ').trim();
const nomeProduto = (p) => [p.nome, p.variacao, p.tamanho].filter(Boolean).join(' ');
// Texto que aparece na sugestão (e que, se escolhido, liga o item ao produto cadastrado).
const sugestao = (p) => [nomeProduto(p), p.marca].filter(Boolean).join(' · ');

// ---------- Carregar ----------

async function carregar() {
  const [pedidos, produtos] = await Promise.all([db.listarPedidos(), db.listarProdutos()]);
  estado.pedidos = pedidos;
  estado.produtos = produtos.filter((p) => !p.arquivado);
  $('#pedido-sugestoes').innerHTML = estado.produtos.map((p) => `<option value="${esc(sugestao(p))}">`).join('');
  render();
}

// ---------- Lista ----------

function porMarca(itens) {
  const grupos = new Map();
  for (const i of [...itens].sort((a, b) => (a.marca || SEM_MARCA).localeCompare(b.marca || SEM_MARCA, 'pt-BR') || a.texto.localeCompare(b.texto, 'pt-BR'))) {
    const m = i.marca || SEM_MARCA;
    (grupos.get(m) || grupos.set(m, []).get(m)).push(i);
  }
  return [...grupos];
}

function detalhes(i) {
  const partes = [i.motivo === 'novo' ? '✨ Produto novo' : 'Acabou'];
  if (i.quantidade) partes.push(`${i.quantidade} un.`);
  if (i.observacao) partes.push(i.observacao);
  return partes.join(' · ');
}

function cartao(i) {
  const quando = i.situacao === 'pedido' ? `pedido em ${dataHora(i.pedidoEm)}`
    : i.situacao === 'chegou' ? `chegou em ${dataHora(i.chegouEm)}` : `anotado em ${dataHora(i.criadoEm)}`;
  const acoes = i.situacao === 'pedir'
    ? `<button class="btn btn-primario" data-pedi="${i.id}">✓ Pedi</button>
       <button class="btn btn-icone-texto" data-remover="${i.id}" aria-label="Tirar da lista">✕</button>`
    : i.situacao === 'pedido'
      ? `<button class="btn btn-primario" data-chegou="${i.id}">📦 Chegou</button>
         <button class="btn" data-voltar="${i.id}">↩ A pedir</button>`
      : '';
  return `
    <li class="pedido ${i.motivo === 'novo' ? 'pedido-novo-produto' : ''}">
      <div class="pedido-info">
        <div class="pedido-nome">${esc(i.texto)}</div>
        <div class="item-sub item-sub-quebra">${esc(detalhes(i))}</div>
        <div class="pedido-quando">${quando}</div>
      </div>
      ${acoes ? `<div class="pedido-acoes">${acoes}</div>` : ''}
    </li>`;
}

function bloco(titulo, itens, { classe = '', agrupar = true } = {}) {
  if (!itens.length) return '';
  const conteudo = agrupar
    ? porMarca(itens).map(([marca, lista]) => `
        <h3 class="pedido-marca">${esc(marca)} <span>${lista.length}</span></h3>
        <ul class="lista lista-pedidos">${lista.map(cartao).join('')}</ul>`).join('')
    : `<ul class="lista lista-pedidos">${itens.map(cartao).join('')}</ul>`;
  return `<h2 class="grupo-titulo ${classe}">${titulo} <span>${itens.length}</span></h2>${conteudo}`;
}

function render() {
  const aPedir = estado.pedidos.filter((i) => i.situacao === 'pedir');
  const pedidos = estado.pedidos.filter((i) => i.situacao === 'pedido');
  const limite = new Date(Date.now() - DIAS_CHEGARAM * 864e5).toISOString();
  const chegaram = estado.pedidos.filter((i) => i.situacao === 'chegou' && i.chegouEm >= limite)
    .sort((a, b) => b.chegouEm.localeCompare(a.chegouEm));

  $('#lista-pedidos').innerHTML = `
    ${aPedir.length ? `<button class="btn btn-largo btn-copiar-pedido" id="btn-copiar-pedido">📋 Copiar lista para mandar ao fornecedor</button>` : ''}
    ${bloco('A pedir', aPedir) || '<p class="tarefas-vazio">Nada para pedir agora 🎉</p>'}
    ${bloco('Já pedi · aguardando chegar', pedidos)}
    ${chegaram.length ? `<details class="feitas"><summary>📦 Chegaram nos últimos ${DIAS_CHEGARAM} dias (${chegaram.length})</summary>
      <ul class="lista lista-pedidos">${chegaram.map(cartao).join('')}</ul></details>` : ''}`;

  const el = $('#pedidos-contador');
  el.textContent = String(aPedir.length);
  el.hidden = !aPedir.length;
}

function aplicarModo() {
  const pedidos = estado.modo === 'pedidos';
  $('#produtos-modo').querySelectorAll('[data-modo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === estado.modo)));
  $('#produtos-filtros').hidden = pedidos;
  $('#area-produtos').hidden = pedidos;
  $('#area-pedidos').hidden = !pedidos;
  $('#btn-novo').hidden = pedidos;
}

$('#produtos-modo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-modo]');
  if (!b) return;
  estado.modo = b.dataset.modo;
  aplicarModo();
  window.scrollTo(0, 0);
});

// ---------- Anotar ----------

const produtoDoTexto = (texto) => estado.produtos.find((p) => chave(sugestao(p)) === chave(texto));

function marcarMotivo(motivo) {
  estado.motivo = motivo;
  $('#pedido-motivo').querySelectorAll('[data-motivo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.motivo === motivo)));
}

$('#pedido-motivo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-motivo]');
  if (!b) return;
  estado.motivoEscolhido = true;
  marcarMotivo(b.dataset.motivo);
});

// Escolheu um produto da lista: já preenche a marca e marca "Acabou".
$('#form-pedido').texto.addEventListener('input', (e) => {
  const p = produtoDoTexto(e.target.value);
  if (p && p.marca) $('#form-pedido').marca.value = p.marca;
  if (!estado.motivoEscolhido) marcarMotivo(p || !e.target.value.trim() ? 'acabou' : 'novo');
});

$('#form-pedido').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const digitado = form.texto.value.trim().replace(/\s+/g, ' ');
  if (!digitado) { form.texto.focus(); avisar('Escreva o que precisa pedir'); return; }
  const p = produtoDoTexto(digitado);
  const texto = p ? nomeProduto(p) : digitado[0].toUpperCase() + digitado.slice(1);
  const repetido = estado.pedidos.find((i) => i.situacao === 'pedir' && chave(i.texto) === chave(texto));
  if (repetido) { avisar(`"${texto}" já está na lista`); return; }
  const qtd = parseInt(form.quantidade.value, 10);
  await db.salvarPedidos([{
    texto, produtoId: p?.id || null, marca: form.marca.value.trim() || p?.marca || '',
    motivo: estado.motivo, quantidade: qtd > 0 ? qtd : null, observacao: form.observacao.value.trim(), situacao: 'pedir',
  }]);
  form.reset();
  estado.motivoEscolhido = false;
  marcarMotivo('acabou');
  form.texto.focus(); // dá para anotar o próximo em seguida
  avisar(`"${texto}" anotado para pedir`);
  await carregar();
});

// Botão "Pôr em Para pedir" na ficha do produto.
document.addEventListener('pedir-produto', async (e) => {
  const p = e.detail;
  const texto = nomeProduto(p);
  if (estado.pedidos.some((i) => i.situacao === 'pedir' && (i.produtoId === p.id || chave(i.texto) === chave(texto)))) {
    avisar(`"${texto}" já está em Para pedir`);
    return;
  }
  await db.salvarPedidos([{ texto, produtoId: p.id, marca: p.marca || '', motivo: 'acabou', quantidade: null, observacao: '', situacao: 'pedir' }]);
  avisar(`"${texto}" foi para a lista Para pedir`);
  await carregar();
});

// ---------- Pedi / Chegou / Voltar / Tirar ----------

const itemDo = (id) => estado.pedidos.find((i) => i.id === id);

$('#lista-pedidos').addEventListener('click', async (e) => {
  if (e.target.closest('#btn-copiar-pedido')) { copiarLista(); return; }
  const alvo = e.target.closest('[data-pedi],[data-chegou],[data-voltar],[data-remover]');
  if (!alvo) return;
  const { pedi, chegou, voltar, remover } = alvo.dataset;
  const agora = new Date().toISOString();

  if (pedi) {
    await db.salvarPedidos([{ ...itemDo(pedi), situacao: 'pedido', pedidoEm: agora }]);
    avisar('Marcado como pedido ✓');
  }
  if (voltar) {
    await db.salvarPedidos([{ ...itemDo(voltar), situacao: 'pedir', pedidoEm: null }]);
    avisar('Voltou para A pedir');
  }
  if (chegou) {
    const i = itemDo(chegou);
    await db.salvarPedidos([{ ...i, situacao: 'chegou', chegouEm: agora }]);
    avisar(`📦 ${i.texto} chegou`);
    // Produto novo que ainda não está no catálogo: oferece cadastrar.
    if (i.motivo === 'novo' && !i.produtoId) {
      await carregar();
      const ok = await confirmar('Cadastrar no catálogo?', `"${i.texto}" é um produto novo. Quer cadastrar agora em Produtos? O nome e a marca já vêm preenchidos.`, 'Cadastrar', false);
      if (ok) document.dispatchEvent(new CustomEvent('cadastrar-produto', { detail: { nome: i.texto, marca: i.marca } }));
      return;
    }
  }
  if (remover) {
    const i = itemDo(remover);
    const ok = await confirmar('Tirar da lista?', `"${i.texto}" sai da lista de pedidos.`, 'Tirar');
    if (!ok) return;
    await db.apagarPedido(i.id);
    avisar('Tirado da lista');
  }
  await carregar();
});

// ---------- Copiar para o fornecedor ----------

function textoDoPedido() {
  const aPedir = estado.pedidos.filter((i) => i.situacao === 'pedir');
  const linhas = [`Pedido Felipão Suplementos — ${dataCurta(hojeISO())}`];
  for (const [marca, itens] of porMarca(aPedir)) {
    linhas.push('', `*${marca}*`);
    for (const i of itens) linhas.push(`- ${i.texto}${i.quantidade ? ` (${i.quantidade} un.)` : ''}${i.observacao ? ` — ${i.observacao}` : ''}`);
  }
  return linhas.join('\n');
}

async function copiarLista() {
  const texto = textoDoPedido();
  try {
    await navigator.clipboard.writeText(texto);
    avisar('Lista copiada: é só colar no WhatsApp do fornecedor');
  } catch {
    // Sem permissão de copiar: abre o compartilhar do celular.
    try { await navigator.share({ text: texto }); } catch { avisar('Não deu para copiar neste aparelho'); }
  }
}

// ---------- Backup ----------

const SITUACOES = { pedir: 'A pedir', pedido: 'Já pedi', chegou: 'Chegou' };
export function csvPedidos(pedidos) {
  const cab = ['situacao', 'produto', 'marca', 'motivo', 'quantidade', 'observacao', 'anotado_em', 'pedido_em', 'chegou_em'];
  const br = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '');
  const ordem = [...pedidos].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  return gerarCsv(cab, ordem.map((i) => [SITUACOES[i.situacao] || i.situacao, i.texto, i.marca, i.motivo === 'novo' ? 'Produto novo' : 'Acabou',
    i.quantidade ?? '', i.observacao, br(i.criadoEm), br(i.pedidoEm), br(i.chegouEm)]));
}

$('#menu-exportar-pedidos').addEventListener('click', async () => {
  baixarArquivo(`felipao-pedidos-${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`, csvPedidos(await db.listarPedidos()));
  $('#dlg-menu').close();
  avisar('Planilha da lista de pedidos baixada');
});

// ---------- Eventos ----------

document.addEventListener('tela-aberta', (e) => { if (e.detail === 'estoque') carregar(); });
document.addEventListener('dados-mudaram', () => carregar());
carregar();
