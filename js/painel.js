// Painel: os números do negócio numa tela só (hoje, mês, fiado, tarefas, mais vendidos)
// e dois gráficos de barras (dia a dia do mês e últimos 6 meses). Só para olhar:
// tocar num bloco leva para a tela dele.

import * as db from './db.js';
import { $, esc, hojeISO, moedaCentavos } from './comum.js';
import { situacaoCliente } from './fiado.js';
import { resumirVendas } from './venda-calc.js';
import { dataAtalho } from './lembrete.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const z = (n) => String(n).padStart(2, '0');
const isoDe = (a, m, d) => `${a}-${z(m + 1)}-${z(d)}`;
const diasNoMes = (a, m) => new Date(a, m + 1, 0).getDate();

// R$ 1.234 sem centavos (números grandes ficam mais fáceis de ler).
const reais = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
// Eixo dos gráficos: 0, 500, 1 mil, 1,5 mil…
const compacto = (c) => {
  const r = c / 100;
  return r >= 1000 ? `${(r / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(Math.round(r));
};

let dados = null;

// ---------- Carregar ----------

async function carregar() {
  const hoje = hojeISO();
  const [a, m, d] = hoje.split('-').map(Number);
  const mes = m - 1;
  const inicioMes = isoDe(a, mes, 1);
  const inicio6 = isoDe(new Date(a, mes - 5, 1).getFullYear(), new Date(a, mes - 5, 1).getMonth(), 1);
  const ant = new Date(a, mes - 1, 1);
  const inicioAnt = isoDe(ant.getFullYear(), ant.getMonth(), 1);
  // Mesmo período do mês passado (dia 1 até o dia de hoje, ou o fim dele se for mais curto).
  const fimAnt = isoDe(ant.getFullYear(), ant.getMonth(), Math.min(d, diasNoMes(ant.getFullYear(), ant.getMonth())));

  const [vendas6, clientes, lancamentos, tarefas] = await Promise.all([
    db.listarVendas(inicio6, hoje), db.listarClientes(), db.listarLancamentos(), db.listarTarefas(),
  ]);
  const validas = vendas6.filter((v) => !v.cancelada);
  const doMes = validas.filter((v) => v.dia >= inicioMes);

  // Fiado: saldo de cada cliente e cobranças marcadas até hoje.
  const porCliente = new Map();
  for (const l of lancamentos) (porCliente.get(l.clienteId) || porCliente.set(l.clienteId, []).get(l.clienteId)).push(l);
  const situacoes = clientes.filter((c) => !c.arquivado).map((c) => ({ c, s: situacaoCliente(porCliente.get(c.id) || [], hoje) }));
  const cobrancasHoje = situacoes.filter(({ c, s }) => c.lembrete && c.lembrete.data <= hoje && s.saldo > 0).length;

  // Entrou no caixa: vendas pagas na hora + pagamentos de fiado recebidos no mês.
  const recebidoFiado = lancamentos
    .filter((l) => l.tipo === 'pagamento' && !l.cancelado && l.data >= inicioMes && l.data <= hoje)
    .reduce((s, l) => s + l.valor, 0);
  const vendidoNaHora = doMes.filter((v) => v.forma !== 'fiado').reduce((s, v) => s + v.total, 0);

  // Tarefas para hoje (inclui as atrasadas), na mesma ordem da aba Tarefas.
  const pendentes = tarefas.filter((t) => !t.feita && t.data <= hoje)
    .sort((x, y) => `${x.data}T${x.hora || '99:99'}`.localeCompare(`${y.data}T${y.hora || '99:99'}`));

  // Mais vendidos do mês: por quantidade; no empate, por valor.
  const produtos = new Map();
  for (const v of doMes) {
    for (const i of v.itens) {
      const p = produtos.get(i.produtoId) || { nome: `${i.nome}${i.variacao ? ` ${i.variacao}` : ''}`, qtd: 0, valor: 0 };
      p.qtd += i.quantidade;
      p.valor += i.quantidade * i.precoUnit;
      produtos.set(i.produtoId, p);
    }
  }

  // Gráfico 1: um valor por dia do mês até hoje. Gráfico 2: um por mês (6 meses).
  const porDia = [];
  for (let dia = 1; dia <= d; dia++) {
    const r = resumirVendas(doMes.filter((v) => v.dia === isoDe(a, mes, dia)));
    porDia.push({ rotulo: String(dia), titulo: `Dia ${dia}`, ...r, destaque: dia === d });
  }
  const porMes = [];
  for (let k = 5; k >= 0; k--) {
    const ref = new Date(a, mes - k, 1);
    const prefixo = `${ref.getFullYear()}-${z(ref.getMonth() + 1)}`;
    const r = resumirVendas(validas.filter((v) => v.dia.startsWith(prefixo)));
    const nome = MESES[ref.getMonth()];
    porMes.push({ rotulo: nome.slice(0, 3), titulo: `${nome[0].toUpperCase()}${nome.slice(1)}${k === 0 ? ' (até hoje)' : ''}`, ...r, destaque: k === 0 });
  }

  dados = {
    mesNome: MESES[mes],
    mesAntNome: MESES[ant.getMonth()],
    hoje: resumirVendas(validas.filter((v) => v.dia === hoje)),
    mes: resumirVendas(doMes),
    mesAnt: resumirVendas(validas.filter((v) => v.dia >= inicioAnt && v.dia <= fimAnt)),
    semCusto: doMes.some((v) => v.itensSemCusto),
    caixa: vendidoNaHora + recebidoFiado,
    receber: situacoes.reduce((s, x) => s + x.s.saldo, 0),
    vencido: situacoes.reduce((s, x) => s + x.s.vencido, 0),
    cobrancasHoje,
    pendentes,
    amanha: tarefas.filter((t) => !t.feita && t.data === dataAtalho('+1')).length,
    maisVendidos: [...produtos.values()].sort((x, y) => y.qtd - x.qtd || y.valor - x.valor).slice(0, 5),
    porDia,
    porMes,
  };
  render();
}

// ---------- Blocos ----------

function variacao() {
  const { mes, mesAnt, mesAntNome } = dados;
  if (!mesAnt.total) return mes.total ? `<span class="pc-delta">Sem vendas no mesmo período de ${mesAntNome}</span>` : '';
  const pct = Math.round(((mes.total - mesAnt.total) / mesAnt.total) * 100);
  if (pct === 0) return `<span class="pc-delta">= igual ao mesmo período de ${mesAntNome}</span>`;
  return `<span class="pc-delta ${pct > 0 ? 'sobe' : 'desce'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>
    <span class="pc-delta-texto">em relação ao mesmo período de ${mesAntNome}</span>`;
}

// Cabeçalho de cada cartão: ícone, título e (se leva a outra tela) a setinha.
const cabecalho = (icone, titulo, abre = true) => `
  <span class="pc-cabeca"><span class="pc-icone" aria-hidden="true">${icone}</span>
  <span class="pc-titulo">${titulo}</span>${abre ? '<span class="pc-seta" aria-hidden="true">›</span>' : ''}</span>`;

function render() {
  const d = dados;
  const ticket = d.mes.quantidade ? Math.round(d.mes.total / d.mes.quantidade) : 0;
  const tarefasHoje = d.pendentes.length + d.cobrancasHoje;
  // Parte do fiado que já está para cobrar (barra de cima a baixo do cartão de fiado).
  const pctVencido = d.receber ? Math.round((d.vencido / d.receber) * 100) : 0;
  const maiorQtd = Math.max(1, ...d.maisVendidos.map((p) => p.qtd));

  $('#painel-data').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#painel').innerHTML = `
    <button class="pc pc-hoje" data-ir="vendas" style="grid-area:hoje">
      <span class="pc-cabeca"><span class="pc-titulo">Vendido hoje</span><span class="pc-seta" aria-hidden="true">›</span></span>
      <span class="pc-heroi">${moedaCentavos(d.hoje.total)}</span>
      <span class="pc-pilulas">
        <span class="pc-pilula">Lucro ${moedaCentavos(d.hoje.lucro)}</span>
        <span class="pc-pilula">${d.hoje.quantidade} ${d.hoje.quantidade === 1 ? 'venda' : 'vendas'}</span>
      </span>
    </button>

    <button class="pc" data-ir="vendas" style="grid-area:mes">
      ${cabecalho('📅', `Este mês · ${d.mesNome}`)}
      <span class="pc-numeros">
        <span><small>Vendido</small><strong>${reais(d.mes.total)}</strong></span>
        <span><small>Lucro${d.semCusto ? '*' : ''}</small><strong>${reais(d.mes.lucro)}</strong></span>
        <span><small>Entrou no caixa</small><strong>${reais(d.caixa)}</strong></span>
        <span><small>Ticket médio</small><strong>${reais(ticket)}</strong></span>
      </span>
      ${variacao() ? `<span class="pc-rodape">${variacao()}</span>` : ''}
      ${d.semCusto ? '<span class="pc-nota">* algumas vendas estão sem custo, então o lucro real é menor</span>' : ''}
    </button>

    <section class="pc" aria-label="Vendas por dia" style="grid-area:dias">
      ${cabecalho('📊', `Vendas por dia · ${d.mesNome}`, false)}
      <div class="grafico" id="grafico-dias"></div>
    </section>

    <button class="pc" data-ir="cobrancas" style="grid-area:fiado">
      ${cabecalho('💰', 'Fiado e cobranças')}
      <span class="pc-numeros pc-numeros-2">
        <span><small>A receber</small><strong>${reais(d.receber)}</strong></span>
        <span><small>Para cobrar</small><strong class="${d.vencido ? 'alerta' : ''}">${reais(d.vencido)}</strong></span>
      </span>
      ${d.receber ? `<span class="pc-medidor" role="img" aria-label="${pctVencido}% do fiado já está para cobrar"><span style="width:${pctVencido}%"></span></span>
      <span class="pc-nota">${pctVencido}% do fiado já venceu</span>` : ''}
      ${d.cobrancasHoje ? `<span class="pc-aviso">⏰ ${d.cobrancasHoje} ${d.cobrancasHoje === 1 ? 'cobrança marcada' : 'cobranças marcadas'} para hoje</span>` : ''}
    </button>

    <button class="pc" data-ir="tarefas" style="grid-area:tarefas">
      ${cabecalho('✅', 'Tarefas de hoje')}
      ${tarefasHoje ? `
        <span class="pc-medio">${tarefasHoje} <small>para fazer</small></span>
        ${d.pendentes.length ? `<ul class="pc-tarefas">${d.pendentes.slice(0, 3).map((t) => `<li>${esc(t.texto)}</li>`).join('')}</ul>` : ''}
        ${d.pendentes.length > 3 ? `<span class="pc-nota">e mais ${d.pendentes.length - 3}</span>` : ''}`
    : `<span class="pc-medio pc-ok">Tudo feito ✓</span>${d.amanha ? `<span class="pc-nota">${d.amanha} para amanhã</span>` : ''}`}
    </button>

    <section class="pc" aria-label="Mais vendidos do mês" style="grid-area:top">
      ${cabecalho('🏆', `Mais vendidos · ${d.mesNome}`, false)}
      ${d.maisVendidos.length ? `<ol class="pc-ranking">${d.maisVendidos.map((p, i) => `
        <li>
          <span class="ranking-pos">${i + 1}</span>
          <span class="ranking-info">
            <span class="ranking-linha"><span class="ranking-nome">${esc(p.nome)}</span><span class="ranking-valor">${reais(p.valor)}</span></span>
            <span class="ranking-barra"><span style="width:${Math.round((p.qtd / maiorQtd) * 100)}%"></span></span>
            <span class="ranking-qtd">${p.qtd} ${p.qtd === 1 ? 'unidade' : 'unidades'}</span>
          </span>
        </li>`).join('')}</ol>`
    : '<span class="pc-nota">Nenhuma venda este mês ainda.</span>'}
    </section>

    <section class="pc" aria-label="Últimos 6 meses" style="grid-area:meses">
      ${cabecalho('📈', 'Últimos 6 meses', false)}
      <div class="grafico" id="grafico-meses"></div>
    </section>
  `;
  const alto = window.innerWidth >= 900 ? 220 : 170;
  desenharBarras($('#grafico-dias'), d.porDia, { marcarCada: window.innerWidth >= 900 ? 1 : 5, altura: alto });
  desenharBarras($('#grafico-meses'), d.porMes, { altura: alto });
}

// ---------- Gráfico de barras (SVG, uma cor, toque mostra o valor) ----------

// Topo do eixo em número "redondo" (1, 2, 2,5 ou 5 × potência de 10).
function topoRedondo(max) {
  if (max <= 0) return 10000; // R$ 100 quando ainda não tem venda
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map((f) => f * p).find((v) => v >= max);
}

function desenharBarras(caixa, pontos, { marcarCada = 1, altura = 170 }) {
  const largura = Math.max(260, caixa.clientWidth || 320);
  const esq = 44; const dir = 4; const topo = 22; const base = 24;
  const areaL = largura - esq - dir;
  const areaA = altura - topo - base;
  const max = topoRedondo(Math.max(...pontos.map((p) => p.total)));
  const faixa = areaL / pontos.length;
  const larguraBarra = Math.min(24, Math.max(4, faixa - 2)); // sempre sobra um respiro entre as barras
  const y = (v) => topo + areaA - (v / max) * areaA;
  const raio = Math.min(4, larguraBarra / 2);

  // Barra com cantos arredondados só em cima (a base fica reta na linha do zero).
  const barra = (x, v) => {
    const h = Math.max(0, y(0) - y(v));
    if (!h) return '';
    const r = Math.min(raio, h);
    const y0 = y(0);
    return `M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + larguraBarra - r} Q${x + larguraBarra},${y0 - h} ${x + larguraBarra},${y0 - h + r} V${y0} Z`;
  };

  const linhas = [0, max / 2, max].map((v) => `
    <line x1="${esq}" x2="${largura - dir}" y1="${y(v)}" y2="${y(v)}" class="grade"/>
    <text x="${esq - 6}" y="${y(v) + 4}" class="eixo" text-anchor="end">${compacto(v)}</text>`).join('');

  const marcas = pontos.map((p, i) => {
    const cx = esq + faixa * i + faixa / 2;
    const x = cx - larguraBarra / 2;
    // Rótulos espaçados; perto da barra de hoje só aparece o dela (não encavala).
    const pertoDoAtual = marcarCada > 1 && !p.destaque && pontos.some((q, j) => q.destaque && Math.abs(j - i) <= 2);
    const mostrarRotulo = p.destaque || (!pertoDoAtual && (marcarCada === 1 || i === 0 || (i + 1) % marcarCada === 0));
    return `
      <g class="barra ${p.destaque ? 'atual' : ''}" data-i="${i}">
        <path d="${barra(x, p.total)}"/>
        ${mostrarRotulo ? `<text x="${cx}" y="${altura - 6}" class="eixo ${p.destaque ? 'eixo-atual' : ''}" text-anchor="middle">${esc(p.rotulo)}</text>` : ''}
        ${p.destaque && p.total ? `<text x="${Math.min(Math.max(cx, esq + 16), largura - 16)}" y="${y(p.total) - 7}" class="valor-atual" text-anchor="middle">${compacto(p.total)}</text>` : ''}
        <rect x="${esq + faixa * i}" y="${topo}" width="${faixa}" height="${areaA + base}" class="alvo"/>
      </g>`;
  }).join('');

  caixa.innerHTML = `
    <svg viewBox="0 0 ${largura} ${altura}" width="${largura}" height="${altura}" role="img"
      aria-label="Gráfico de barras: valor vendido em cada período">${linhas}${marcas}</svg>
    <div class="grafico-dica" hidden></div>
    <table class="so-leitor"><tr><th>Período</th><th>Vendido</th><th>Lucro</th><th>Vendas</th></tr>
      ${pontos.map((p) => `<tr><td>${esc(p.titulo)}</td><td>${moedaCentavos(p.total)}</td><td>${moedaCentavos(p.lucro)}</td><td>${p.quantidade}</td></tr>`).join('')}</table>`;

  const dica = caixa.querySelector('.grafico-dica');
  const mostrar = (g) => {
    caixa.querySelectorAll('.barra.ativa').forEach((b) => b.classList.remove('ativa'));
    if (!g) { dica.hidden = true; return; }
    g.classList.add('ativa');
    const p = pontos[Number(g.dataset.i)];
    dica.innerHTML = `<strong>${esc(p.titulo)}</strong><br>Vendido ${moedaCentavos(p.total)}<br>Lucro ${moedaCentavos(p.lucro)} · ${p.quantidade} ${p.quantidade === 1 ? 'venda' : 'vendas'}`;
    dica.hidden = false;
    const i = Number(g.dataset.i);
    const cx = esq + faixa * i + faixa / 2;
    // Mantém a caixinha dentro do gráfico (não vaza pelas bordas no celular).
    const l = dica.offsetWidth;
    dica.style.left = `${Math.min(Math.max(0, cx - l / 2), largura - l)}px`;
    dica.style.top = `${Math.max(0, y(p.total) - dica.offsetHeight - 8)}px`;
  };
  caixa.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') mostrar(e.target.closest('.barra')); });
  caixa.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') mostrar(null); });
  // Toque (celular) ou clique: mostra o valor da barra.
  caixa.addEventListener('click', (e) => mostrar(e.target.closest('.barra')));
}

// ---------- Eventos ----------

// Tocar fora de um gráfico esconde a caixinha do valor.
document.addEventListener('click', (e) => {
  if (e.target.closest('.grafico')) return;
  document.querySelectorAll('.grafico-dica').forEach((d) => { d.hidden = true; });
  document.querySelectorAll('.grafico .barra.ativa').forEach((b) => b.classList.remove('ativa'));
});

$('#painel').addEventListener('click', (e) => {
  const bloco = e.target.closest('[data-ir]');
  if (!bloco) return;
  if (bloco.dataset.ir === 'cobrancas') document.dispatchEvent(new CustomEvent('mostrar-cobrancas'));
  else document.dispatchEvent(new CustomEvent('mostrar-tela', { detail: bloco.dataset.ir }));
});
document.addEventListener('tela-aberta', (e) => { if (e.detail === 'inicio') carregar(); });
document.addEventListener('dados-mudaram', () => { if (!$('#tela-inicio').hidden) carregar(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#tela-inicio').hidden) carregar(); });
// Celular girou / janela mudou de tamanho: redesenha os gráficos na largura nova.
let redesenho;
window.addEventListener('resize', () => { clearTimeout(redesenho); redesenho = setTimeout(() => { if (dados && !$('#tela-inicio').hidden) render(); }, 200); });
carregar();
