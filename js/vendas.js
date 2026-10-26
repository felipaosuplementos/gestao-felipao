import * as db from './db.js';
import { lerNumero, csvVendas, baixarArquivo } from './planilha.js';
import {
  $, moedaCentavos, paraCentavos, esc, semAcento, hojeISO, dataCurta,
  avisar, confirmarComMotivo, controlaEstoque,
} from './comum.js';
import { situacaoCliente, dividirParcelas, somarMeses } from './fiado.js';
import { calcularVenda, calcularTroco, FORMAS_PAGAMENTO, nomeForma, resumirVendas } from './venda-calc.js';

const estado = {
  dia: hojeISO(),
  vendas: [],
};

const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dataHoraCurta = (iso) => `${dataCurta(hojeISO(new Date(iso)))} às ${hora(iso)}`;
const reaisCampo = (centavos) => (centavos == null ? '' : (centavos / 100).toFixed(2).replace('.', ','));
const detalheProduto = (p) => [p.marca, p.variacao, p.tamanho].filter(Boolean).join(' · ');
const chaveNome = (nome) => semAcento(nome).replace(/\s+/g, ' ').trim();
// Nome que aparece na lista: o digitado na venda, o cliente do fiado ou o número.
const nomeVenda = (v) => v.nome || v.clienteNome || `Venda nº ${v.numero}`;
const resumoItens = (itens) => itens.map((i) => `${i.quantidade}x ${i.nome}${i.variacao ? ` ${i.variacao}` : ''}`).join(', ');

// ---------- Fotos (foto tirada pelo Felipão ou a do catálogo) ----------

const fotos = new Map();
let indiceFotos = null;
async function urlFoto(p) {
  if (fotos.has(p.id)) return fotos.get(p.id);
  let url = null;
  if (p.temFoto) {
    const blob = await db.buscarFoto(p.id);
    if (blob) url = URL.createObjectURL(blob);
  }
  if (!url && !p.semFotoCatalogo) {
    if (!indiceFotos) {
      indiceFotos = await fetch('fotos/indice.json').then((r) => (r.ok ? r.json() : [])).then((l) => new Set(l)).catch(() => new Set());
    }
    if (indiceFotos.has(p.codigo)) url = `fotos/${encodeURIComponent(p.codigo)}.jpg`;
  }
  fotos.set(p.id, url);
  return url;
}

// ---------- Lista de vendas do dia ----------

async function carregar() {
  estado.vendas = await db.listarVendas(estado.dia);
  render();
}

function render() {
  const hoje = hojeISO();
  $('#vendas-dia').value = estado.dia;
  $('#dia-seguinte').disabled = estado.dia >= hoje;
  $('#vendas-rotulo-dia').textContent = estado.dia === hoje ? 'Vendido hoje' : `Vendido em ${dataCurta(estado.dia)}`;
  const r = resumirVendas(estado.vendas);
  $('#vendas-total').textContent = moedaCentavos(r.total);
  $('#vendas-lucro').textContent = moedaCentavos(r.lucro);
  $('#vendas-quantidade').textContent = r.quantidade;
  $('#vendas-formas').innerHTML = Object.entries(r.porForma)
    .map(([f, v]) => `<span class="etiqueta">${esc(nomeForma(f))}: <strong>${moedaCentavos(v)}</strong></span>`).join('');
  $('#vazio-vendas').hidden = estado.vendas.length > 0;
  $('#lista-vendas').innerHTML = estado.vendas.map((v) => `
    <li><button class="item ${v.cancelada ? 'item-cancelado' : ''}" data-venda="${v.id}">
      <div class="miniatura avatar">🛒</div>
      <div class="item-info">
        <div class="item-nome">${esc(nomeVenda(v))}</div>
        <div class="item-sub item-sub-quebra">${v.cancelada ? 'CANCELADA · ' : ''}Nº ${v.numero} · ${hora(v.dataHora)} · ${esc(nomeForma(v.forma))} · ${esc(resumoItens(v.itens))}</div>
      </div>
      <div class="saldo ${v.cancelada ? 'quitado' : 'a-vencer'}">${moedaCentavos(v.total)}</div>
    </button></li>`).join('');
}

function mudarDia(dias) {
  const d = new Date(`${estado.dia}T12:00:00`);
  d.setDate(d.getDate() + dias);
  const novo = hojeISO(d);
  if (novo > hojeISO()) return;
  estado.dia = novo;
  carregar();
}

// ---------- Nova venda ----------

const venda = {
  produtos: [],
  clientes: [], // { cliente, situacao }
  carrinho: [], // { produtoId, codigo, nome, variacao, detalhe, quantidade, precoUnit, custoUnit, estoque, sugestao }
  ultimos: new Map(), // produtoId -> custo e preço da última venda dele (para sugerir)
  forma: 'pix',
  freteQuem: 'cliente', // quem paga o frete: 'cliente' (soma no total) ou 'eu' (sai do lucro)
  editando: null, // venda já feita que está sendo editada
  pronto: false, // produtos e clientes já carregados
};

// Produtos, clientes e últimas vendas ficam guardados na memória: a Nova venda abre na hora.
// Recarrega quando algo muda (venda feita, dados da nuvem, cadastro).
let base = null;
function carregarBase() {
  if (base) return base;
  base = Promise.all([db.listarProdutos(), db.listarClientes(), db.listarLancamentos(), db.listarVendas()])
    .then(([produtos, clientes, lancamentos, vendas]) => {
      const porCliente = new Map();
      for (const l of lancamentos) (porCliente.get(l.clienteId) || porCliente.set(l.clienteId, []).get(l.clienteId)).push(l);
      const hoje = hojeISO();
      return {
        produtos: produtos.filter((p) => !p.arquivado).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
        // A situação do fiado só é calculada para o cliente escolhido (quando precisa).
        clientes: clientes.filter((c) => !c.arquivado).map((c) => ({
          cliente: c,
          get situacao() { return this.s || (this.s = situacaoCliente(porCliente.get(c.id) || [], hoje)); },
        })),
        ultimos: ultimosValores(vendas),
      };
    })
    .catch((erro) => { base = null; throw erro; });
  return base;
}
const esquecerBase = () => { base = null; };
// Mudou produto, cliente, fiado ou venda (nesta tela ou em outra): a próxima Nova venda lê de novo.
db.aoMudar((mudancas) => {
  if (mudancas.some((m) => ['produtos', 'clientes', 'lancamentos', 'vendas'].includes(m.loja))) esquecerBase();
});

// produtoId: já começa com esse produto. existente: abre uma venda feita para editar.
async function abrirNovaVenda(produtoId = null, existente = null) {
  // Abre a janela primeiro (sem esperar os dados) para responder ao toque na hora.
  venda.carrinho = [];
  venda.forma = 'pix';
  venda.freteQuem = 'cliente';
  venda.editando = existente;
  const form = $('#form-venda');
  form.reset();
  form.vencimento.value = somarMeses(hojeISO(), 1);
  $('#venda-formas').innerHTML = FORMAS_PAGAMENTO.map((f) => `<button type="button" class="chip" data-forma="${f.id}">${f.nome}</button>`).join('');
  $('#venda-resultados').innerHTML = '';
  $('#venda-titulo').textContent = existente ? `Editar venda nº ${existente.numero}` : 'Nova venda';
  renderCarrinho();
  atualizarVenda();
  $('#dlg-venda').showModal();
  if (!produtoId && !existente) form.nome.focus();

  venda.pronto = false;
  const dados = await carregarBase();
  venda.pronto = true;
  venda.produtos = dados.produtos;
  venda.clientes = dados.clientes;
  venda.ultimos = dados.ultimos;
  $('#venda-lista-clientes').innerHTML = venda.clientes.map((c) => `<option value="${esc(c.cliente.nome)}">`).join('');
  if (existente) await preencherVenda(existente);
  renderCarrinho();
  if (produtoId) adicionarProduto(produtoId);
  atualizarVenda();
  // Se já digitou algo na busca enquanto carregava, mostra o resultado.
  if ($('#venda-busca').value.trim()) mostrarResultados();
}

// Coloca no formulário tudo o que a venda tinha (para corrigir o que estiver errado).
async function preencherVenda(v) {
  const form = $('#form-venda');
  venda.forma = v.forma;
  venda.freteQuem = v.fretePagoPor || 'cliente';
  form.nome.value = v.nome || '';
  form.desconto.value = v.desconto ? reaisCampo(v.desconto) : '';
  form.frete.value = v.frete ? reaisCampo(v.frete) : '';
  form.observacao.value = v.observacao || '';
  if (v.parcelasCartao) form.parcelasCartao.value = String(v.parcelasCartao);
  if (v.recebido != null) form.recebido.value = reaisCampo(v.recebido);
  if (v.forma === 'fiado') {
    form.cliente.value = v.clienteNome || '';
    form.parcelasFiado.value = String(v.parcelasFiado || 1);
    const lancs = (await db.listarLancamentos(v.clienteId)).filter((l) => l.vendaId === v.id && !l.cancelado && l.vencimento);
    if (lancs.length) form.vencimento.value = lancs.map((l) => l.vencimento).sort()[0];
  }
  venda.carrinho = v.itens.map((i) => {
    const p = venda.produtos.find((x) => x.id === i.produtoId);
    return { ...i, detalhe: p ? detalheProduto(p) : '', estoque: p?.quantidade ?? null, sugestao: null };
  });
}

// Custo e preço usados na última venda de cada produto (as canceladas não contam).
function ultimosValores(vendas) {
  const mapa = new Map();
  for (const v of [...vendas].filter((x) => !x.cancelada).sort((a, b) => a.dataHora.localeCompare(b.dataHora))) {
    for (const i of v.itens) mapa.set(i.produtoId, { precoUnit: i.precoUnit, custoUnit: i.custoUnit ?? null, dia: v.dia });
  }
  return mapa;
}

// Sugestão para preencher: a última venda do produto; se nunca vendeu, o que estiver no cadastro.
function sugestaoPara(p) {
  const ultima = venda.ultimos.get(p.id);
  if (ultima) return { ...ultima, origem: 'Última venda' };
  if (p.preco == null && p.custo == null) return null;
  return { precoUnit: p.preco == null ? null : paraCentavos(p.preco), custoUnit: p.custo == null ? null : paraCentavos(p.custo), origem: 'Cadastro' };
}

async function mostrarResultados() {
  const termos = semAcento($('#venda-busca').value).split(/\s+/).filter(Boolean);
  if (!termos.length) { $('#venda-resultados').innerHTML = ''; return; }
  if (!venda.pronto) { $('#venda-resultados').innerHTML = '<li class="descricao">Carregando os produtos…</li>'; return; }
  const achados = venda.produtos.filter((p) => {
    const texto = semAcento([p.nome, p.marca, p.variacao, p.tamanho, p.codigo].join(' '));
    return termos.every((t) => texto.includes(t));
  }).slice(0, 8);
  const urls = await Promise.all(achados.map(urlFoto));
  const digitado = $('#venda-busca').value.trim().replace(/\s+/g, ' ');
  // Produto que ainda não está cadastrado: entra na venda e já fica salvo em Produtos.
  const novo = `<li><button type="button" class="resultado resultado-novo" data-novo>
      <div class="miniatura">＋</div>
      <div class="item-info">
        <div class="item-nome">Vender "${esc(digitado)}" como produto novo</div>
        <div class="item-sub">Fica salvo em Produtos para as próximas vendas</div>
      </div>
    </button></li>`;
  $('#venda-resultados').innerHTML = (achados.length ? achados.map((p, i) => `
    <li><button type="button" class="resultado" data-produto="${p.id}">
      <div class="miniatura ${urls[i] ? 'com-foto' : ''}" ${urls[i] ? `style="background-image:url('${urls[i]}')"` : ''}>${urls[i] ? '' : '📦'}</div>
      <div class="item-info">
        <div class="item-nome">${esc(p.nome)}</div>
        <div class="item-sub">${esc(detalheProduto(p))}</div>
      </div>
      <div class="resultado-preco">${venda.ultimos.get(p.id) ? moedaCentavos(venda.ultimos.get(p.id).precoUnit) : ''}
        ${controlaEstoque() ? `<small>${p.quantidade == null ? 'estoque ?' : `${p.quantidade} em estoque`}</small>` : ''}</div>
    </button></li>`).join('') : '<li class="descricao">Nenhum produto cadastrado com esse nome.</li>') + novo;
}

function adicionarProduto(id) {
  const p = venda.produtos.find((x) => x.id === id);
  if (!p) return;
  const item = venda.carrinho.find((i) => i.produtoId === id);
  if (item) item.quantidade++;
  else {
    venda.carrinho.push({
      produtoId: p.id, codigo: p.codigo, nome: p.nome, variacao: p.variacao || '', detalhe: detalheProduto(p),
      // Custo e preço são digitados em cada venda; nada fica fixo no produto.
      quantidade: 1, precoUnit: null, custoUnit: null, estoque: p.quantidade, sugestao: sugestaoPara(p),
    });
  }
  $('#venda-busca').value = '';
  $('#venda-resultados').innerHTML = '';
  renderCarrinho();
  atualizarVenda();
  if (item == null) $(`#venda-carrinho [data-custo="${id}"]`)?.focus();
}

async function venderProdutoNovo() {
  const digitado = $('#venda-busca').value.trim().replace(/\s+/g, ' ');
  if (!digitado) return;
  const nome = digitado[0].toUpperCase() + digitado.slice(1);
  const igual = venda.produtos.find((p) => chaveNome(p.nome) === chaveNome(nome));
  if (igual) { adicionarProduto(igual.id); return; }
  const produto = await db.salvarProduto({
    id: db.novoId(), codigo: `p-${Date.now().toString(36)}`, nome,
    marca: '', variacao: '', categoria: '', tamanho: '', descricao: '',
    custo: null, preco: null, quantidade: null, estoqueMinimo: null, arquivado: false, cadastroNaVenda: true,
  }, { tipo: 'cadastro', motivo: 'Cadastrado na venda' });
  venda.produtos.push(produto);
  adicionarProduto(produto.id);
  avisar(`"${nome}" cadastrado em Produtos`);
}

function renderCarrinho() {
  $('#venda-carrinho').innerHTML = venda.carrinho.map((i) => `
    <li class="carrinho-item">
      <div class="carrinho-linha">
        <div class="item-info">
          <div class="item-nome">${esc(i.nome)}</div>
          <div class="item-sub">${esc(i.detalhe)}</div>
          ${controlaEstoque() && i.estoque != null && i.quantidade > i.estoque ? `<div class="erros">Atenção: só tem ${i.estoque} no estoque</div>` : ''}
        </div>
        <button type="button" class="btn-icone" data-remover="${i.produtoId}" aria-label="Tirar da venda">✕</button>
      </div>
      <div class="carrinho-linha">
        <div class="contador contador-pequeno">
          <button type="button" class="btn" data-qtd="-1" data-item="${i.produtoId}">−</button>
          <span class="carrinho-qtd">${i.quantidade}</span>
          <button type="button" class="btn" data-qtd="1" data-item="${i.produtoId}">＋</button>
        </div>
        <label class="carrinho-campo">Custo R$<input data-custo="${i.produtoId}" inputmode="decimal" value="${reaisCampo(i.custoUnit)}" placeholder="0,00"></label>
        <label class="carrinho-campo">Venda R$<input data-preco="${i.produtoId}" inputmode="decimal" value="${reaisCampo(i.precoUnit)}" placeholder="0,00"></label>
      </div>
      <div class="carrinho-linha carrinho-rodape">
        <span class="carrinho-info">${infoItem(i)}</span>
        <strong class="carrinho-total">${i.precoUnit == null ? '—' : moedaCentavos(i.precoUnit * i.quantidade)}</strong>
      </div>
    </li>`).join('');
}

// Embaixo de cada produto: o lucro dele, ou a sugestão da última venda enquanto os campos estão vazios.
function infoItem(i) {
  if (i.precoUnit != null && i.custoUnit != null) {
    const lucro = (i.precoUnit - i.custoUnit) * i.quantidade;
    return `<span class="${lucro < 0 ? 'negativo' : 'lucro-item'}">Lucro ${moedaCentavos(lucro)}</span>`;
  }
  const s = i.sugestao;
  if (s && i.precoUnit == null && i.custoUnit == null) {
    const partes = [s.custoUnit != null ? `custo ${moedaCentavos(s.custoUnit)}` : '', s.precoUnit != null ? `vendeu ${moedaCentavos(s.precoUnit)}` : ''].filter(Boolean);
    return `${s.origem}: ${partes.join(' · ')} <button type="button" class="btn-usar" data-usar="${i.produtoId}">usar</button>`;
  }
  return i.precoUnit != null ? 'Sem custo: o lucro não é calculado' : '';
}

function dadosVenda() {
  const form = $('#form-venda');
  const desconto = paraCentavos(lerNumero(form.desconto.value) || 0);
  const frete = paraCentavos(lerNumero(form.frete.value) || 0);
  const itens = venda.carrinho.map((i) => ({ ...i, precoUnit: i.precoUnit ?? 0 }));
  return { itens, ...calcularVenda(itens, desconto, frete, venda.freteQuem) };
}

function clienteDigitado() {
  const form = $('#form-venda');
  // No fiado, se o campo Cliente ficar vazio, vale o nome digitado no alto da venda.
  const nome = (form.cliente.value.trim() || form.nome.value.trim()).replace(/\s+/g, ' ');
  if (!nome) return { nome: '', existente: null };
  return { nome, existente: venda.clientes.find((c) => chaveNome(c.cliente.nome) === chaveNome(nome)) || null };
}

function atualizarVenda() {
  const form = $('#form-venda');
  const temItens = venda.carrinho.length > 0;
  $('#venda-carrinho-vazio').hidden = temItens;
  $('#venda-pagamento').hidden = !temItens;
  $('#venda-formas').querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.forma === venda.forma));
  $('#venda-credito').hidden = venda.forma !== 'credito';
  $('#venda-dinheiro').hidden = venda.forma !== 'dinheiro';
  $('#venda-fiado').hidden = venda.forma !== 'fiado';

  const r = dadosVenda();
  const partes = [];
  if (r.desconto) partes.push(`desconto ${moedaCentavos(r.desconto)}`);
  if (r.frete && venda.freteQuem === 'cliente') partes.push(`+ frete ${moedaCentavos(r.frete)}`);
  $('#venda-subtotal').textContent = partes.length ? `Produtos ${moedaCentavos(r.subtotal)} · ${partes.join(' · ')}` : `${venda.carrinho.reduce((s, i) => s + i.quantidade, 0)} itens`;
  $('#venda-frete-quem').hidden = !r.frete;
  $('#venda-frete-quem').querySelectorAll('[data-frete]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.frete === venda.freteQuem)));
  $('#venda-frete-info').hidden = !r.frete;
  $('#venda-frete-info').textContent = venda.freteQuem === 'cliente'
    ? `O cliente paga ${moedaCentavos(r.frete)} de frete junto com a venda.`
    : `Você paga ${moedaCentavos(r.frete)} de frete: sai do lucro, o cliente não paga.`;
  $('#venda-total').textContent = moedaCentavos(r.total);
  $('#venda-lucro').textContent = r.lucro == null ? (temItens ? 'Lucro: coloque o custo para calcular' : '')
    : `Lucro estimado: ${moedaCentavos(r.lucro)}${r.itensSemCusto ? ` (${r.itensSemCusto} sem custo)` : ''}`;
  $('#venda-lucro').classList.toggle('negativo', r.lucro != null && r.lucro < 0);

  if (venda.forma === 'dinheiro') {
    const recebido = lerNumero(form.recebido.value);
    const troco = calcularTroco(r.total, recebido == null ? null : paraCentavos(recebido));
    $('#venda-troco').textContent = recebido == null ? '' : troco == null ? 'Valor recebido menor que o total' : `Troco: ${moedaCentavos(troco)}`;
    $('#venda-troco').classList.toggle('negativo', recebido != null && troco == null);
  }
  if (venda.forma === 'fiado') {
    const { nome, existente } = clienteDigitado();
    $('#venda-cliente-info').textContent = !nome ? 'Escolha um cliente da lista ou digite o nome de um novo.'
      : existente ? `${existente.cliente.nome} deve hoje ${moedaCentavos(existente.situacao.saldo)} → vai ficar devendo ${moedaCentavos(existente.situacao.saldo + r.total)}`
        : `Cliente novo: "${nome}" vai ser cadastrado.`;
    const n = Number(form.parcelasFiado.value);
    $('#venda-venc-rotulo').hidden = n <= 1;
    $('#venda-parcelas').innerHTML = n > 1 && r.total && form.vencimento.value
      ? dividirParcelas(r.total, n, form.vencimento.value).map((p) => `<li>Parcela ${p.parcela}: <strong>${moedaCentavos(p.valor)}</strong> — vence ${dataCurta(p.vencimento)}</li>`).join('')
      : '';
  }
  $('#venda-finalizar').disabled = !temItens;
  $('#venda-finalizar').textContent = !temItens ? 'Finalizar venda'
    : venda.editando ? `Salvar ${moedaCentavos(r.total)}` : `Finalizar ${moedaCentavos(r.total)}`;
}

$('#venda-busca').addEventListener('input', mostrarResultados);
$('#venda-busca').addEventListener('keydown', (e) => {
  // Enter adiciona o primeiro resultado (útil no computador).
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const primeiro = $('#venda-resultados [data-produto]');
  if (primeiro) adicionarProduto(primeiro.dataset.produto);
  else if ($('#venda-resultados [data-novo]')) venderProdutoNovo();
});
$('#venda-resultados').addEventListener('click', (e) => {
  const r = e.target.closest('[data-produto]');
  if (r) adicionarProduto(r.dataset.produto);
  if (e.target.closest('[data-novo]')) venderProdutoNovo();
});
$('#venda-carrinho').addEventListener('click', (e) => {
  const qtd = e.target.closest('[data-qtd]');
  if (qtd) {
    const item = venda.carrinho.find((i) => i.produtoId === qtd.dataset.item);
    item.quantidade = Math.max(1, item.quantidade + Number(qtd.dataset.qtd));
    renderCarrinho();
    atualizarVenda();
  }
  const usar = e.target.closest('[data-usar]');
  if (usar) {
    const item = venda.carrinho.find((i) => i.produtoId === usar.dataset.usar);
    item.custoUnit = item.sugestao.custoUnit;
    item.precoUnit = item.sugestao.precoUnit;
    renderCarrinho();
    atualizarVenda();
  }
  const remover = e.target.closest('[data-remover]');
  if (remover) {
    venda.carrinho = venda.carrinho.filter((i) => i.produtoId !== remover.dataset.remover);
    renderCarrinho();
    atualizarVenda();
  }
});
$('#venda-carrinho').addEventListener('input', (e) => {
  const campo = e.target.closest('[data-preco],[data-custo]');
  if (!campo) return;
  const item = venda.carrinho.find((i) => i.produtoId === (campo.dataset.preco || campo.dataset.custo));
  const n = lerNumero(campo.value);
  const centavos = n == null ? null : paraCentavos(n);
  if (campo.dataset.preco) item.precoUnit = centavos; else item.custoUnit = centavos;
  // Atualiza só o rodapé do item (sem redesenhar, para não tirar o cursor do campo).
  const li = campo.closest('.carrinho-item');
  li.querySelector('.carrinho-total').textContent = item.precoUnit == null ? '—' : moedaCentavos(item.precoUnit * item.quantidade);
  li.querySelector('.carrinho-info').innerHTML = infoItem(item);
  atualizarVenda();
});
$('#venda-frete-quem').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-frete]');
  if (!chip) return;
  venda.freteQuem = chip.dataset.frete;
  atualizarVenda();
});
$('#venda-formas').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-forma]');
  if (!chip) return;
  venda.forma = chip.dataset.forma;
  const form = $('#form-venda');
  if (venda.forma === 'fiado' && !form.cliente.value.trim()) form.cliente.value = form.nome.value.trim();
  atualizarVenda();
  if (venda.forma === 'fiado' && !form.cliente.value) form.cliente.focus();
  if (venda.forma === 'dinheiro') $('#form-venda').recebido.focus();
});
$('#form-venda').addEventListener('input', (e) => { if (!e.target.closest('#venda-carrinho, #venda-busca')) atualizarVenda(); });
$('#form-venda').addEventListener('change', (e) => { if (!e.target.closest('#venda-carrinho')) atualizarVenda(); });

$('#form-venda').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!venda.carrinho.length) return;
  const semPreco = venda.carrinho.find((i) => !i.precoUnit);
  if (semPreco) { avisar(`Coloque o preço de ${semPreco.nome}`); $(`#venda-carrinho [data-preco="${semPreco.produtoId}"]`)?.focus(); return; }
  const r = dadosVenda();
  if (r.total <= 0) { avisar('O total da venda precisa ser maior que zero'); return; }
  const editando = venda.editando;
  // Na edição a venda continua no dia em que foi feita.
  const hoje = editando ? editando.dia : hojeISO();

  const registro = {
    dia: hoje,
    nome: form.nome.value.trim().replace(/\s+/g, ' '),
    itens: r.itens.map(({ estoque, detalhe, sugestao, ...i }) => i),
    subtotal: r.subtotal, desconto: r.desconto, total: r.total, lucro: r.lucro, itensSemCusto: r.itensSemCusto,
    frete: r.frete, fretePagoPor: r.frete ? venda.freteQuem : null,
    forma: venda.forma, observacao: form.observacao.value.trim(),
  };
  const extras = {};
  if (venda.forma === 'credito') registro.parcelasCartao = Number(form.parcelasCartao.value);
  if (venda.forma === 'dinheiro') {
    const recebido = lerNumero(form.recebido.value);
    if (recebido != null) {
      const troco = calcularTroco(r.total, paraCentavos(recebido));
      if (troco == null) { avisar('O valor recebido é menor que o total'); return; }
      registro.recebido = paraCentavos(recebido);
      registro.troco = troco;
    }
  }
  if (venda.forma === 'fiado') {
    const { nome, existente } = clienteDigitado();
    if (!nome) { avisar('Escolha o cliente do fiado'); form.cliente.focus(); return; }
    let clienteId = existente?.cliente.id;
    if (!existente) {
      clienteId = db.novoId();
      extras.clienteNovo = { id: clienteId, nome, whatsapp: '', observacao: '', arquivado: false };
    }
    registro.clienteId = clienteId;
    registro.clienteNome = existente?.cliente.nome || nome;
    const base = { clienteId, tipo: 'fiado', data: hoje, descricao: resumoItens(r.itens) };
    const n = Number(form.parcelasFiado.value);
    if (n > 1) {
      if (!form.vencimento.value) { avisar('Escolha o 1º vencimento'); return; }
      const grupo = db.novoId();
      extras.lancamentos = dividirParcelas(r.total, n, form.vencimento.value)
        .map((p) => ({ ...base, valor: p.valor, vencimento: p.vencimento, parcela: p.parcela, grupo }));
      registro.parcelasFiado = n;
    } else {
      extras.lancamentos = [{ ...base, valor: r.total }];
    }
  }

  $('#venda-finalizar').disabled = true;
  try {
    const opcoes = { ...extras, baixarEstoque: controlaEstoque() };
    const salva = editando ? await db.editarVenda(editando.id, registro, opcoes) : await db.registrarVenda(registro, opcoes);
    esquecerBase(); // a última venda e o fiado mudaram
    if (!salva) { avisar('Essa venda não pode mais ser editada'); return; }
    $('#dlg-venda').close();
    avisar(editando ? `Venda nº ${salva.numero} corrigida: ${moedaCentavos(salva.total)}`
      : `Venda nº ${salva.numero} registrada: ${moedaCentavos(salva.total)}${salva.troco ? ` · troco ${moedaCentavos(salva.troco)}` : ''}`);
    estado.dia = hoje;
    await carregar();
    if (editando) abrirDetalhe(salva.id);
    document.dispatchEvent(new CustomEvent('dados-mudaram'));
  } catch (erro) {
    avisar('Não consegui salvar a venda. Tente de novo.');
    throw erro;
  } finally {
    $('#venda-finalizar').disabled = false;
  }
});

// ---------- Detalhe e cancelamento ----------

let vendaAberta = null;

function abrirDetalhe(id) {
  const v = estado.vendas.find((x) => x.id === id);
  if (!v) return;
  vendaAberta = v;
  $('#venda-detalhe-titulo').textContent = nomeVenda(v);
  const pagamento = [nomeForma(v.forma)];
  if (v.parcelasCartao > 1) pagamento.push(`${v.parcelasCartao}x no cartão`);
  if (v.recebido != null) pagamento.push(`recebido ${moedaCentavos(v.recebido)}, troco ${moedaCentavos(v.troco)}`);
  if (v.clienteNome) pagamento.push(`cliente ${v.clienteNome}`);
  if (v.parcelasFiado > 1) pagamento.push(`${v.parcelasFiado} parcelas`);
  $('#venda-detalhe').innerHTML = `
    <p class="detalhe-sub">Venda nº ${v.numero} · ${dataCurta(v.dia)} às ${hora(v.dataHora)}${v.cancelada ? ' <span class="etiqueta etiqueta-perigo">Cancelada</span>' : ''}
      ${v.editadaEm ? `<br>Editada em ${dataHoraCurta(v.editadaEm)}` : ''}</p>
    <ul class="historico">${v.itens.map((i) => `
      <li><div>${i.quantidade}x ${esc(i.nome)}${i.variacao ? ` ${esc(i.variacao)}` : ''}<small>${moedaCentavos(i.precoUnit)} cada${i.custoUnit != null ? ` · custo ${moedaCentavos(i.custoUnit)}` : ''}</small></div>
      <span class="dif">${moedaCentavos(i.precoUnit * i.quantidade)}</span></li>`).join('')}
      ${v.desconto ? `<li><div>Desconto</div><span class="dif menos">−${moedaCentavos(v.desconto)}</span></li>` : ''}
      ${v.frete ? (v.fretePagoPor === 'eu'
    ? `<li><div>Frete<small>você pagou · sai do lucro, não entra no total</small></div><span class="dif">${moedaCentavos(v.frete)}</span></li>`
    : `<li><div>Frete<small>cliente pagou</small></div><span class="dif">+${moedaCentavos(v.frete)}</span></li>`) : ''}
      <li><div><strong>Total</strong></div><span class="dif"><strong>${moedaCentavos(v.total)}</strong></span></li>
    </ul>
    <p><strong>Pagamento:</strong> ${esc(pagamento.join(' · '))}</p>
    <p><strong>Lucro estimado:</strong> ${v.lucro == null ? 'sem custo informado' : `${moedaCentavos(v.lucro)}${v.itensSemCusto ? ` (${v.itensSemCusto} item sem custo)` : ''}`}</p>
    ${v.observacao ? `<p class="descricao">${esc(v.observacao)}</p>` : ''}
    ${v.cancelada
    ? `<p class="erros">Cancelada em ${dataCurta(v.cancelada.em.slice(0, 10))}${v.cancelada.motivo ? ` — ${esc(v.cancelada.motivo)}` : ''}. ${v.semEstoque ? (v.forma === 'fiado' ? 'O fiado foi cancelado.' : '') : `Os produtos voltaram ao estoque${v.forma === 'fiado' ? ' e o fiado foi cancelado' : ''}.`}</p>`
    : `<button class="btn btn-primario btn-largo" id="btn-editar-venda">✏️ Editar venda</button>
      <button class="btn btn-perigo-claro btn-largo" id="btn-cancelar-venda">Cancelar esta venda</button>`}
  `;
  const dlg = $('#dlg-venda-detalhe');
  if (!dlg.open) dlg.showModal();
}

$('#venda-detalhe').addEventListener('click', async (e) => {
  if (e.target.closest('#btn-editar-venda')) {
    $('#dlg-venda-detalhe').close();
    await abrirNovaVenda(null, vendaAberta);
    return;
  }
  if (!e.target.closest('#btn-cancelar-venda')) return;
  const v = vendaAberta;
  const motivo = await confirmarComMotivo(
    `Cancelar a venda nº ${v.numero}?`,
    `${v.semEstoque ? (v.forma === 'fiado' ? `O fiado de ${v.clienteNome} é cancelado. ` : '') : `Os produtos voltam para o estoque${v.forma === 'fiado' ? ` e o fiado de ${v.clienteNome} é cancelado` : ''}. `}A venda continua na lista, marcada como cancelada.`,
    'Cancelar venda',
  );
  if (motivo === null) return;
  await db.cancelarVenda(v.id, motivo);
  avisar(`Venda nº ${v.numero} cancelada`);
  await carregar();
  abrirDetalhe(v.id);
  document.dispatchEvent(new CustomEvent('dados-mudaram'));
});

// ---------- Exportação ----------

$('#menu-exportar-vendas').addEventListener('click', async () => {
  const vendas = (await db.listarVendas()).sort((a, b) => a.dataHora.localeCompare(b.dataHora));
  baixarArquivo(`felipao-vendas-${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`, csvVendas(vendas));
  $('#dlg-menu').close();
  avisar('Planilha de vendas baixada');
});

// ---------- Eventos ----------

$('#btn-nova-venda').addEventListener('click', () => abrirNovaVenda());
$('#btn-venda-vazio').addEventListener('click', () => abrirNovaVenda());
$('#lista-vendas').addEventListener('click', (e) => {
  const item = e.target.closest('[data-venda]');
  if (item) abrirDetalhe(item.dataset.venda);
});
$('#vendas-dia').addEventListener('change', (e) => {
  if (!e.target.value) return;
  estado.dia = e.target.value > hojeISO() ? hojeISO() : e.target.value;
  carregar();
});
$('#dia-anterior').addEventListener('click', () => mudarDia(-1));
$('#dia-seguinte').addEventListener('click', () => mudarDia(1));

// Ao abrir a tela Vender, já deixa os dados da Nova venda prontos.
document.addEventListener('tela-aberta', (e) => { if (e.detail === 'vendas') { carregar(); carregarBase(); } });
document.addEventListener('dados-mudaram', () => { fotos.clear(); esquecerBase(); carregar(); });
// Botão "Vender" na ficha do produto.
document.addEventListener('vender-produto', async (e) => {
  document.dispatchEvent(new CustomEvent('mostrar-tela', { detail: 'vendas' }));
  await abrirNovaVenda(e.detail);
});

carregar();
// Deixa a Nova venda pronta assim que o sistema abre.
setTimeout(() => carregarBase().catch(() => {}), 1500);
