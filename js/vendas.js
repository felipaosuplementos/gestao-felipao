import * as db from './db.js';
import { lerNumero, csvVendas, baixarArquivo } from './planilha.js';
import {
  $, moedaCentavos, paraCentavos, esc, semAcento, hojeISO, dataCurta,
  avisar, confirmarComMotivo,
} from './comum.js';
import { situacaoCliente, dividirParcelas, somarMeses } from './fiado.js';
import { calcularVenda, calcularTroco, FORMAS_PAGAMENTO, nomeForma, resumirVendas } from './venda-calc.js';

const estado = {
  dia: hojeISO(),
  vendas: [],
};

const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const reaisCampo = (centavos) => (centavos == null ? '' : (centavos / 100).toFixed(2).replace('.', ','));
const detalheProduto = (p) => [p.marca, p.variacao, p.tamanho].filter(Boolean).join(' · ');
const chaveNome = (nome) => semAcento(nome).replace(/\s+/g, ' ').trim();
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
        <div class="item-nome">Nº ${v.numero} · ${hora(v.dataHora)} · ${esc(nomeForma(v.forma))}</div>
        <div class="item-sub item-sub-quebra">${v.cancelada ? 'CANCELADA · ' : ''}${v.clienteNome ? `<strong>${esc(v.clienteNome)}</strong> · ` : ''}${esc(resumoItens(v.itens))}</div>
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
  carrinho: [], // { produtoId, codigo, nome, variacao, detalhe, quantidade, precoUnit, custoUnit, estoque, salvarPreco }
  forma: 'pix',
};

async function abrirNovaVenda(produtoId = null) {
  const [produtos, clientes, lancamentos] = await Promise.all([db.listarProdutos(), db.listarClientes(), db.listarLancamentos()]);
  venda.produtos = produtos.filter((p) => !p.arquivado).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const hoje = hojeISO();
  venda.clientes = clientes.filter((c) => !c.arquivado).map((c) => ({
    cliente: c, situacao: situacaoCliente(lancamentos.filter((l) => l.clienteId === c.id), hoje),
  }));
  venda.carrinho = [];
  venda.forma = 'pix';
  const form = $('#form-venda');
  form.reset();
  form.vencimento.value = somarMeses(hoje, 1);
  $('#venda-formas').innerHTML = FORMAS_PAGAMENTO.map((f) => `<button type="button" class="chip" data-forma="${f.id}">${f.nome}</button>`).join('');
  $('#venda-lista-clientes').innerHTML = venda.clientes
    .map((c) => `<option value="${esc(c.cliente.nome)}">`).join('');
  $('#venda-resultados').innerHTML = '';
  if (produtoId) adicionarProduto(produtoId);
  atualizarVenda();
  $('#dlg-venda').showModal();
  if (!produtoId) $('#venda-busca').focus();
}

async function mostrarResultados() {
  const termos = semAcento($('#venda-busca').value).split(/\s+/).filter(Boolean);
  if (!termos.length) { $('#venda-resultados').innerHTML = ''; return; }
  const achados = venda.produtos.filter((p) => {
    const texto = semAcento([p.nome, p.marca, p.variacao, p.tamanho, p.codigo].join(' '));
    return termos.every((t) => texto.includes(t));
  }).slice(0, 8);
  const urls = await Promise.all(achados.map(urlFoto));
  $('#venda-resultados').innerHTML = achados.length ? achados.map((p, i) => `
    <li><button type="button" class="resultado" data-produto="${p.id}">
      <div class="miniatura ${urls[i] ? 'com-foto' : ''}" ${urls[i] ? `style="background-image:url('${urls[i]}')"` : ''}>${urls[i] ? '' : '📦'}</div>
      <div class="item-info">
        <div class="item-nome">${esc(p.nome)}</div>
        <div class="item-sub">${esc(detalheProduto(p))}</div>
      </div>
      <div class="resultado-preco">${p.preco == null ? '<span class="vazio-preco">sem preço</span>' : moedaCentavos(paraCentavos(p.preco))}
        <small>${p.quantidade == null ? 'estoque ?' : `${p.quantidade} em estoque`}</small></div>
    </button></li>`).join('') : '<li class="descricao">Nenhum produto encontrado.</li>';
}

function adicionarProduto(id) {
  const p = venda.produtos.find((x) => x.id === id);
  if (!p) return;
  const item = venda.carrinho.find((i) => i.produtoId === id);
  if (item) item.quantidade++;
  else {
    venda.carrinho.push({
      produtoId: p.id, codigo: p.codigo, nome: p.nome, variacao: p.variacao || '', detalhe: detalheProduto(p),
      quantidade: 1, precoUnit: p.preco == null ? null : paraCentavos(p.preco),
      custoUnit: p.custo == null ? null : paraCentavos(p.custo), estoque: p.quantidade, salvarPreco: p.preco == null,
    });
  }
  $('#venda-busca').value = '';
  $('#venda-resultados').innerHTML = '';
  renderCarrinho();
  atualizarVenda();
  if (item == null && p.preco == null) $(`#venda-carrinho [data-preco="${id}"]`)?.focus();
}

function renderCarrinho() {
  $('#venda-carrinho').innerHTML = venda.carrinho.map((i) => `
    <li class="carrinho-item">
      <div class="carrinho-linha">
        <div class="item-info">
          <div class="item-nome">${esc(i.nome)}</div>
          <div class="item-sub">${esc(i.detalhe)}</div>
          ${i.estoque != null && i.quantidade > i.estoque ? `<div class="erros">Atenção: só tem ${i.estoque} no estoque</div>` : ''}
        </div>
        <button type="button" class="btn-icone" data-remover="${i.produtoId}" aria-label="Tirar da venda">✕</button>
      </div>
      <div class="carrinho-linha">
        <div class="contador contador-pequeno">
          <button type="button" class="btn" data-qtd="-1" data-item="${i.produtoId}">−</button>
          <span class="carrinho-qtd">${i.quantidade}</span>
          <button type="button" class="btn" data-qtd="1" data-item="${i.produtoId}">＋</button>
        </div>
        <label class="carrinho-preco">× R$<input data-preco="${i.produtoId}" inputmode="decimal" value="${reaisCampo(i.precoUnit)}" placeholder="preço"></label>
        <strong class="carrinho-total">${i.precoUnit == null ? '—' : moedaCentavos(i.precoUnit * i.quantidade)}</strong>
      </div>
    </li>`).join('');
}

function dadosVenda() {
  const form = $('#form-venda');
  const desconto = paraCentavos(lerNumero(form.desconto.value) || 0);
  const itens = venda.carrinho.map((i) => ({ ...i, precoUnit: i.precoUnit ?? 0 }));
  return { itens, ...calcularVenda(itens, desconto) };
}

function clienteDigitado() {
  const nome = $('#form-venda').cliente.value.trim().replace(/\s+/g, ' ');
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
  $('#venda-subtotal').textContent = r.desconto ? `Subtotal ${moedaCentavos(r.subtotal)} − desconto ${moedaCentavos(r.desconto)}` : `${venda.carrinho.reduce((s, i) => s + i.quantidade, 0)} itens`;
  $('#venda-total').textContent = moedaCentavos(r.total);
  $('#venda-lucro').textContent = r.lucro == null ? (temItens ? 'Lucro: cadastre o custo para calcular' : '')
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
  $('#venda-finalizar').textContent = temItens ? `Finalizar ${moedaCentavos(r.total)}` : 'Finalizar venda';
}

$('#venda-busca').addEventListener('input', mostrarResultados);
$('#venda-busca').addEventListener('keydown', (e) => {
  // Enter adiciona o primeiro resultado (útil no computador).
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const primeiro = $('#venda-resultados [data-produto]');
  if (primeiro) adicionarProduto(primeiro.dataset.produto);
});
$('#venda-resultados').addEventListener('click', (e) => {
  const r = e.target.closest('[data-produto]');
  if (r) adicionarProduto(r.dataset.produto);
});
$('#venda-carrinho').addEventListener('click', (e) => {
  const qtd = e.target.closest('[data-qtd]');
  if (qtd) {
    const item = venda.carrinho.find((i) => i.produtoId === qtd.dataset.item);
    item.quantidade = Math.max(1, item.quantidade + Number(qtd.dataset.qtd));
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
  const campo = e.target.closest('[data-preco]');
  if (!campo) return;
  const item = venda.carrinho.find((i) => i.produtoId === campo.dataset.preco);
  const n = lerNumero(campo.value);
  item.precoUnit = n == null ? null : paraCentavos(n);
  const total = campo.closest('.carrinho-item').querySelector('.carrinho-total');
  total.textContent = item.precoUnit == null ? '—' : moedaCentavos(item.precoUnit * item.quantidade);
  atualizarVenda();
});
$('#venda-formas').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-forma]');
  if (!chip) return;
  venda.forma = chip.dataset.forma;
  atualizarVenda();
  if (venda.forma === 'fiado') $('#form-venda').cliente.focus();
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
  const hoje = hojeISO();

  const registro = {
    dia: hoje,
    itens: r.itens.map(({ estoque, detalhe, ...i }) => i),
    subtotal: r.subtotal, desconto: r.desconto, total: r.total, lucro: r.lucro, itensSemCusto: r.itensSemCusto,
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
    const salva = await db.registrarVenda(registro, extras);
    $('#dlg-venda').close();
    avisar(`Venda nº ${salva.numero} registrada: ${moedaCentavos(salva.total)}${salva.troco ? ` · troco ${moedaCentavos(salva.troco)}` : ''}`);
    estado.dia = hoje;
    await carregar();
    document.dispatchEvent(new CustomEvent('dados-mudaram'));
  } catch (erro) {
    avisar('Não consegui salvar a venda. Tente de novo.');
    $('#venda-finalizar').disabled = false;
    throw erro;
  }
});

// ---------- Detalhe e cancelamento ----------

let vendaAberta = null;

function abrirDetalhe(id) {
  const v = estado.vendas.find((x) => x.id === id);
  if (!v) return;
  vendaAberta = v;
  $('#venda-detalhe-titulo').textContent = `Venda nº ${v.numero}`;
  const pagamento = [nomeForma(v.forma)];
  if (v.parcelasCartao > 1) pagamento.push(`${v.parcelasCartao}x no cartão`);
  if (v.recebido != null) pagamento.push(`recebido ${moedaCentavos(v.recebido)}, troco ${moedaCentavos(v.troco)}`);
  if (v.clienteNome) pagamento.push(`cliente ${v.clienteNome}`);
  if (v.parcelasFiado > 1) pagamento.push(`${v.parcelasFiado} parcelas`);
  $('#venda-detalhe').innerHTML = `
    <p class="detalhe-sub">${dataCurta(v.dia)} às ${hora(v.dataHora)}${v.cancelada ? ' <span class="etiqueta etiqueta-perigo">Cancelada</span>' : ''}</p>
    <ul class="historico">${v.itens.map((i) => `
      <li><div>${i.quantidade}x ${esc(i.nome)}${i.variacao ? ` ${esc(i.variacao)}` : ''}<small>${moedaCentavos(i.precoUnit)} cada</small></div>
      <span class="dif">${moedaCentavos(i.precoUnit * i.quantidade)}</span></li>`).join('')}
      ${v.desconto ? `<li><div>Desconto</div><span class="dif menos">−${moedaCentavos(v.desconto)}</span></li>` : ''}
      <li><div><strong>Total</strong></div><span class="dif"><strong>${moedaCentavos(v.total)}</strong></span></li>
    </ul>
    <p><strong>Pagamento:</strong> ${esc(pagamento.join(' · '))}</p>
    <p><strong>Lucro estimado:</strong> ${v.lucro == null ? 'cadastre o custo dos produtos para calcular' : `${moedaCentavos(v.lucro)}${v.itensSemCusto ? ` (${v.itensSemCusto} item sem custo)` : ''}`}</p>
    ${v.observacao ? `<p class="descricao">${esc(v.observacao)}</p>` : ''}
    ${v.cancelada
    ? `<p class="erros">Cancelada em ${dataCurta(v.cancelada.em.slice(0, 10))}${v.cancelada.motivo ? ` — ${esc(v.cancelada.motivo)}` : ''}. Os produtos voltaram ao estoque${v.forma === 'fiado' ? ' e o fiado foi cancelado' : ''}.</p>`
    : '<button class="btn btn-perigo-claro btn-largo" id="btn-cancelar-venda">Cancelar esta venda</button>'}
  `;
  const dlg = $('#dlg-venda-detalhe');
  if (!dlg.open) dlg.showModal();
}

$('#venda-detalhe').addEventListener('click', async (e) => {
  if (!e.target.closest('#btn-cancelar-venda')) return;
  const v = vendaAberta;
  const motivo = await confirmarComMotivo(
    `Cancelar a venda nº ${v.numero}?`,
    `Os produtos voltam para o estoque${v.forma === 'fiado' ? ` e o fiado de ${v.clienteNome} é cancelado` : ''}. A venda continua na lista, marcada como cancelada.`,
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

document.addEventListener('tela-aberta', (e) => { if (e.detail === 'vendas') carregar(); });
document.addEventListener('dados-mudaram', () => { fotos.clear(); carregar(); });
// Botão "Vender" na ficha do produto.
document.addEventListener('vender-produto', async (e) => {
  document.dispatchEvent(new CustomEvent('mostrar-tela', { detail: 'vendas' }));
  await abrirNovaVenda(e.detail);
});

carregar();
