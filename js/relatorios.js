// Relatórios: um período (este mês, mês passado, 3 meses ou datas escolhidas) e, dentro dele,
// o resumo das vendas, o lucro por produto, os clientes que mais compram e as formas de
// pagamento. Cada parte pode ser baixada em planilha.

import * as db from './db.js';
import { gerarCsv, baixarArquivo } from './planilha.js';
import { $, esc, semAcento, hojeISO, dataCurta, moedaCentavos, avisar } from './comum.js';
import { resumirVendas, nomeForma, textoLucro } from './venda-calc.js';

const z = (n) => String(n).padStart(2, '0');
const isoDe = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const reaisPlanilha = (c) => (c / 100).toFixed(2).replace('.', ',');
const pct = (parte, todo) => (todo ? Math.round((parte / todo) * 100) : 0);

const estado = {
  periodo: 'mes',
  de: null,
  ate: null,
  ordemProdutos: 'lucro',
  dados: null,
};

// ---------- Período ----------

function datasDoPeriodo() {
  const hoje = new Date();
  const a = hoje.getFullYear();
  const m = hoje.getMonth();
  if (estado.periodo === 'mes') return [isoDe(new Date(a, m, 1)), hojeISO()];
  if (estado.periodo === 'passado') return [isoDe(new Date(a, m - 1, 1)), isoDe(new Date(a, m, 0))];
  if (estado.periodo === 'tres') return [isoDe(new Date(a, m - 2, 1)), hojeISO()];
  return [estado.de || hojeISO(), estado.ate || hojeISO()];
}

// ---------- Contas ----------

async function carregar() {
  const [de, ate] = datasDoPeriodo();
  const [vendas, lancamentos] = await Promise.all([db.listarVendas(de, ate), db.listarLancamentos()]);
  const validas = vendas.filter((v) => !v.cancelada);
  const r = resumirVendas(validas);

  // Entrou no caixa: vendas pagas na hora + pagamentos de fiado recebidos no período.
  const recebidoFiado = lancamentos
    .filter((l) => l.tipo === 'pagamento' && !l.cancelado && l.data >= de && l.data <= ate)
    .reduce((s, l) => s + l.valor, 0);
  const naHora = validas.filter((v) => v.forma !== 'fiado').reduce((s, v) => s + v.total, 0);
  const noFiado = validas.filter((v) => v.forma === 'fiado').reduce((s, v) => s + v.total, 0);

  // Produtos: soma das unidades, valor e lucro de cada um.
  const produtos = new Map();
  for (const v of validas) {
    for (const i of v.itens) {
      const p = produtos.get(i.produtoId) || { nome: `${i.nome}${i.variacao ? ` ${i.variacao}` : ''}`, qtd: 0, valor: 0, lucro: 0, custo: 0, semCusto: false };
      p.qtd += i.quantidade;
      p.valor += i.quantidade * i.precoUnit;
      if (i.custoUnit == null) p.semCusto = true;
      else { p.lucro += i.quantidade * (i.precoUnit - i.custoUnit); p.custo += i.quantidade * i.custoUnit; }
      produtos.set(i.produtoId, p);
    }
  }

  // Clientes: pelo cliente do fiado ou pelo nome escrito na venda (vendas sem nome ficam de fora).
  const clientes = new Map();
  for (const v of validas) {
    const nome = (v.clienteNome || v.nome || '').trim();
    if (!nome) continue;
    const chave = v.clienteId || semAcento(nome).replace(/\s+/g, ' ');
    const c = clientes.get(chave) || { nome, compras: 0, total: 0, lucro: 0, ultima: '' };
    c.compras++;
    c.total += v.total;
    c.lucro += v.lucro || 0;
    if (v.dia > c.ultima) c.ultima = v.dia;
    clientes.set(chave, c);
  }

  // Formas de pagamento: valor e quantidade de vendas de cada uma.
  const formas = new Map();
  for (const v of validas) {
    const f = formas.get(v.forma) || { forma: nomeForma(v.forma), vendas: 0, total: 0 };
    f.vendas++;
    f.total += v.total;
    formas.set(v.forma, f);
  }

  estado.dados = {
    de, ate, resumo: r,
    descontos: validas.reduce((s, v) => s + (v.desconto || 0), 0),
    caixa: naHora + recebidoFiado, recebidoFiado, noFiado,
    semCusto: validas.filter((v) => v.lucro == null || v.itensSemCusto).length,
    produtos: [...produtos.values()],
    clientes: [...clientes.values()].sort((x, y) => y.total - x.total),
    semNome: validas.filter((v) => !(v.clienteNome || v.nome || '').trim()).length,
    formas: [...formas.values()].sort((x, y) => y.total - x.total),
  };
  render();
}

// ---------- Tela ----------

const ORDENS = {
  lucro: (x, y) => y.lucro - x.lucro || y.valor - x.valor,
  valor: (x, y) => y.valor - x.valor || y.qtd - x.qtd,
  qtd: (x, y) => y.qtd - x.qtd || y.valor - x.valor,
  margem: (x, y) => pct(y.lucro, y.valor) - pct(x.lucro, x.valor) || y.lucro - x.lucro,
};

function render() {
  const d = estado.dados;
  const r = d.resumo;
  const ticket = r.quantidade ? Math.round(r.total / r.quantidade) : 0;
  const produtos = [...d.produtos].sort(ORDENS[estado.ordemProdutos]);

  $('#rel-periodo-texto').textContent = d.de === d.ate ? dataCurta(d.de) : `${dataCurta(d.de)} a ${dataCurta(d.ate)}`;
  $('#rel-conteudo').innerHTML = !r.quantidade ? '<p class="tarefas-vazio">Nenhuma venda neste período.</p>' : `
    <section class="rel-bloco">
      <h3>Resumo</h3>
      <div class="rel-numeros">
        <span><small>Vendido</small><strong>${moedaCentavos(r.total)}</strong></span>
        <span><small>Lucro</small><strong>${textoLucro(r, moedaCentavos)}</strong></span>
        <span><small>Vendas</small><strong>${r.quantidade}</strong></span>
        <span><small>Ticket médio</small><strong>${moedaCentavos(ticket)}</strong></span>
        <span><small>Entrou no caixa</small><strong>${moedaCentavos(d.caixa)}</strong></span>
        <span><small>Vendido no fiado</small><strong>${moedaCentavos(d.noFiado)}</strong></span>
      </div>
      <p class="pc-nota">${r.comLucro ? `Margem de lucro: ${pct(r.lucro, r.total)}% do vendido.` : 'Nenhuma venda tem custo informado, então o lucro não pode ser calculado.'}${d.descontos ? ` Descontos dados: ${moedaCentavos(d.descontos)}.` : ''}
        ${d.recebidoFiado ? ` Fiado recebido no período: ${moedaCentavos(d.recebidoFiado)}.` : ''}
        ${r.comLucro && d.semCusto ? ` * ${d.semCusto} ${d.semCusto === 1 ? 'venda está' : 'vendas estão'} sem custo em algum produto; o lucro delas não entra na conta.` : ''}</p>
    </section>

    <section class="rel-bloco">
      <div class="rel-titulo"><h3>Produtos (${produtos.length})</h3><button class="btn-texto rel-baixar" data-baixar="produtos">⬇️ Planilha</button></div>
      <div class="chips chips-motivo" id="rel-ordem">
        ${[['lucro', 'Maior lucro'], ['valor', 'Maior valor'], ['qtd', 'Mais unidades'], ['margem', 'Maior margem']]
    .map(([id, nome]) => `<button type="button" class="chip" data-ordem="${id}" aria-pressed="${estado.ordemProdutos === id}">${nome}</button>`).join('')}
      </div>
      <ol class="vendidos-lista">${produtos.map((p, i) => `
        <li>
          <span class="ranking-pos">${i + 1}</span>
          <span class="vendido-info">
            <span class="vendido-nome">${esc(p.nome)}</span>
            <span class="vendido-sub">${p.qtd} un. · vendido ${moedaCentavos(p.valor)}${p.semCusto ? ' · sem custo em alguma venda' : ` · margem ${pct(p.lucro, p.valor)}%`}</span>
          </span>
          <span class="vendido-valor"><small>lucro</small>${p.semCusto && !p.lucro ? 'sem custo' : moedaCentavos(p.lucro)}</span>
        </li>`).join('')}</ol>
    </section>

    <section class="rel-bloco">
      <div class="rel-titulo"><h3>Clientes que mais compram</h3><button class="btn-texto rel-baixar" data-baixar="clientes">⬇️ Planilha</button></div>
      ${d.clientes.length ? `<ol class="vendidos-lista">${d.clientes.map((c, i) => `
        <li>
          <span class="ranking-pos">${i + 1}</span>
          <span class="vendido-info">
            <span class="vendido-nome">${esc(c.nome)}</span>
            <span class="vendido-sub">${c.compras} ${c.compras === 1 ? 'compra' : 'compras'} · última em ${dataCurta(c.ultima)}</span>
          </span>
          <span class="vendido-valor">${moedaCentavos(c.total)}</span>
        </li>`).join('')}</ol>` : '<p class="pc-nota">Nenhuma venda com nome de cliente neste período.</p>'}
      ${d.semNome ? `<p class="pc-nota">${d.semNome} ${d.semNome === 1 ? 'venda ficou' : 'vendas ficaram'} sem nome e não ${d.semNome === 1 ? 'entra' : 'entram'} nesta lista. Para aparecer aqui, preencha o "Nome" na venda.</p>` : ''}
    </section>

    <section class="rel-bloco">
      <div class="rel-titulo"><h3>Formas de pagamento</h3><button class="btn-texto rel-baixar" data-baixar="formas">⬇️ Planilha</button></div>
      <ul class="rel-formas">${d.formas.map((f) => `
        <li>
          <span class="rel-forma-linha"><strong>${esc(f.forma)}</strong><span>${moedaCentavos(f.total)}</span></span>
          <span class="ranking-barra"><span style="width:${pct(f.total, r.total)}%"></span></span>
          <span class="vendido-sub">${pct(f.total, r.total)}% do vendido · ${f.vendas} ${f.vendas === 1 ? 'venda' : 'vendas'}</span>
        </li>`).join('')}</ul>
    </section>`;
}

// ---------- Planilhas ----------

function baixar(qual) {
  const d = estado.dados;
  const periodo = `${d.de}_a_${d.ate}`;
  if (qual === 'produtos') {
    const linhas = [...d.produtos].sort(ORDENS[estado.ordemProdutos])
      .map((p) => [p.nome, p.qtd, reaisPlanilha(p.valor), p.semCusto ? '' : reaisPlanilha(p.custo), reaisPlanilha(p.lucro), p.semCusto ? '' : `${pct(p.lucro, p.valor)}%`]);
    baixarArquivo(`felipao-relatorio-produtos-${periodo}.csv`, gerarCsv(['produto', 'unidades', 'vendido', 'custo', 'lucro', 'margem'], linhas));
  }
  if (qual === 'clientes') {
    const linhas = d.clientes.map((c) => [c.nome, c.compras, reaisPlanilha(c.total), reaisPlanilha(c.lucro), dataCurta(c.ultima)]);
    baixarArquivo(`felipao-relatorio-clientes-${periodo}.csv`, gerarCsv(['cliente', 'compras', 'total', 'lucro', 'ultima_compra'], linhas));
  }
  if (qual === 'formas') {
    const linhas = d.formas.map((f) => [f.forma, f.vendas, reaisPlanilha(f.total), `${pct(f.total, d.resumo.total)}%`]);
    baixarArquivo(`felipao-relatorio-pagamentos-${periodo}.csv`, gerarCsv(['forma', 'vendas', 'total', 'porcentagem'], linhas));
  }
  avisar('Planilha baixada');
}

// ---------- Eventos ----------

$('#menu-relatorios').addEventListener('click', async () => {
  $('#dlg-menu').close();
  $('#dlg-relatorios').showModal();
  await carregar();
});

$('#rel-periodos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-periodo]');
  if (!b) return;
  estado.periodo = b.dataset.periodo;
  $('#rel-periodos').querySelectorAll('[data-periodo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('#rel-datas').hidden = estado.periodo !== 'datas';
  if (estado.periodo === 'datas') {
    const [de, ate] = datasDoPeriodo();
    $('#rel-de').value = estado.de || de;
    $('#rel-ate').value = estado.ate || ate;
  }
  carregar();
});

$('#rel-datas').addEventListener('change', () => {
  estado.de = $('#rel-de').value || hojeISO();
  estado.ate = $('#rel-ate').value || hojeISO();
  if (estado.de > estado.ate) [estado.de, estado.ate] = [estado.ate, estado.de];
  carregar();
});

$('#rel-conteudo').addEventListener('click', (e) => {
  const ordem = e.target.closest('[data-ordem]');
  if (ordem) { estado.ordemProdutos = ordem.dataset.ordem; render(); return; }
  const planilha = e.target.closest('[data-baixar]');
  if (planilha) baixar(planilha.dataset.baixar);
});
