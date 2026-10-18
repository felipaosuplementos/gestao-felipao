// Leitura e geração de planilhas (CSV com ";" — abre direto no Excel em português).

export function lerCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] || '';
  const contar = (c) => primeiraLinha.split(c).length - 1;
  // Usa o separador que mais aparece na primeira linha (texto colado do Google Planilhas vem com TAB).
  const sep = [';', '\t', ','].reduce((melhor, c) => (contar(c) > contar(melhor) ? c : melhor), ';');

  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((v) => v.trim() !== ''));
}

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Nomes de coluna aceitos (sem acento, minúsculo) para cada campo do sistema.
const COLUNAS = {
  codigo: ['codigo', 'cod', 'sku', 'id'],
  nome: ['nome', 'produto', 'nome do produto', 'descricao do produto'],
  marca: ['marca', 'fabricante'],
  categoria: ['categoria', 'tipo'],
  variacao: ['variacao', 'sabor', 'sabor/variacao', 'sabor / variacao'],
  tamanho: ['tamanho', 'peso', 'embalagem'],
  descricao: ['descricao', 'detalhes'],
  destaque: ['destaque'],
  situacao: ['situacao', 'status'],
  custo: ['custo', 'preco de custo', 'valor de custo'],
  preco: ['preco', 'preco de venda', 'valor', 'valor de venda'],
  quantidade: ['quantidade', 'qtd', 'qtde', 'estoque', 'quantidade em estoque'],
  estoqueMinimo: ['estoque minimo', 'estoque_minimo', 'minimo', 'avisar com'],
};

export function mapearColunas(cabecalho) {
  const mapa = {};
  cabecalho.forEach((titulo, i) => {
    const t = semAcento(titulo);
    for (const [campo, nomes] of Object.entries(COLUNAS)) {
      if (mapa[campo] === undefined && nomes.includes(t)) { mapa[campo] = i; break; }
    }
  });
  return mapa;
}

// Aceita "89,90", "1.234,56", "R$ 89,90" e "89.90".
export function lerNumero(valor) {
  if (valor == null) return null;
  let s = String(valor).replace(/R\$|\s/g, '');
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "3.196" = três mil
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function lerInteiro(valor) {
  const n = lerNumero(valor);
  return n == null ? null : Math.max(0, Math.round(n));
}

// Transforma as linhas da planilha em produtos "crus" (sem id).
export function linhasParaProdutos(linhas) {
  if (!linhas.length) return { itens: [], erros: ['A planilha está vazia.'] };
  const mapa = mapearColunas(linhas[0]);
  if (mapa.nome === undefined) {
    return { itens: [], erros: ['Não achei a coluna "nome" na primeira linha da planilha.'] };
  }
  const itens = [];
  const erros = [];
  linhas.slice(1).forEach((l, i) => {
    const pegar = (campo) => (mapa[campo] === undefined ? '' : (l[mapa[campo]] ?? '').trim());
    const nome = pegar('nome');
    if (!nome) { erros.push(`Linha ${i + 2}: sem nome, foi ignorada.`); return; }
    let variacao = pegar('variacao');
    let tamanho = pegar('tamanho');
    // No catálogo, a coluna "variacao" às vezes traz o tamanho (ex.: "60 cápsulas").
    // Nesse caso vai para "tamanho" e o campo de sabor fica livre.
    if (/^(\d|sach)/i.test(variacao)) { tamanho = variacao; variacao = ''; }
    let quantidade = lerInteiro(pegar('quantidade'));
    if (quantidade == null && semAcento(pegar('situacao')) === 'sem estoque') quantidade = 0;
    itens.push({
      codigo: pegar('codigo'),
      nome,
      marca: pegar('marca'),
      categoria: pegar('categoria'),
      variacao,
      tamanho,
      descricao: pegar('descricao') || pegar('destaque'),
      custo: lerNumero(pegar('custo')),
      preco: lerNumero(pegar('preco')),
      quantidade,
      estoqueMinimo: lerInteiro(pegar('estoqueMinimo')),
    });
  });
  return { itens, erros };
}

function celula(v) {
  if (v == null) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const numeroBr = (n) => (n == null ? '' : String(n).replace('.', ','));
const dataBr = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '');

export function gerarCsv(cabecalho, linhas) {
  return '﻿' + [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n');
}

export function csvProdutos(produtos) {
  const cab = ['codigo', 'nome', 'marca', 'categoria', 'variacao', 'tamanho', 'descricao',
    'custo', 'preco', 'quantidade', 'estoque_minimo', 'arquivado', 'atualizado_em'];
  const linhas = produtos.map((p) => [
    p.codigo, p.nome, p.marca, p.categoria, p.variacao, p.tamanho, p.descricao,
    numeroBr(p.custo), numeroBr(p.preco), p.quantidade ?? '', p.estoqueMinimo ?? '',
    p.arquivado ? 'sim' : '', dataBr(p.atualizadoEm),
  ]);
  return gerarCsv(cab, linhas);
}

const NOMES_TIPO = {
  entrada: 'Entrada', saida: 'Saída', correcao: 'Correção',
  importacao: 'Importação', cadastro: 'Cadastro',
};
export const nomeTipo = (t) => NOMES_TIPO[t] || t;

export function csvMovimentos(movimentos) {
  const cab = ['data_hora', 'produto', 'tipo', 'diferenca', 'antes', 'depois', 'motivo'];
  const linhas = movimentos.map((m) => [
    dataBr(m.dataHora), m.produtoNome, nomeTipo(m.tipo), m.diferenca,
    m.quantidadeAntes ?? '', m.quantidadeDepois ?? '', m.motivo,
  ]);
  return gerarCsv(cab, linhas);
}

export function baixarArquivo(nome, conteudo, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- Devedores (fiado) ----------

const COLUNAS_DEVEDORES = {
  nome: ['devedores', 'devedor', 'nome', 'cliente', 'clientes'],
  valor: ['valor', 'saldo', 'deve', 'divida', 'total', 'valor devido'],
  whatsapp: ['whatsapp', 'telefone', 'celular', 'fone', 'contato'],
  observacao: ['observacao', 'obs', 'anotacao'],
};

// Aceita planilha com títulos (ex.: "Devedores | Valor") ou só as colunas Nome e Valor coladas.
export function linhasParaDevedores(linhas) {
  if (!linhas.length) return { itens: [], ignoradas: [], erros: ['Não encontrei nenhuma linha.'] };
  const titulos = linhas[0].map(semAcento);
  const mapa = {};
  for (const [campo, nomes] of Object.entries(COLUNAS_DEVEDORES)) {
    const i = titulos.findIndex((t) => nomes.includes(t));
    if (i >= 0) mapa[campo] = i;
  }
  let corpo = linhas.slice(1);
  if (mapa.nome === undefined || mapa.valor === undefined) {
    if (linhas[0].length >= 2 && lerNumero(linhas[0][1]) != null) {
      mapa.nome = 0; mapa.valor = 1; corpo = linhas; // sem títulos
    } else {
      return { itens: [], ignoradas: [], erros: ['Não achei as colunas de nome e valor. A primeira coluna deve ser o nome e a segunda o valor.'] };
    }
  }
  const itens = [];
  const ignoradas = [];
  for (const l of corpo) {
    const pegar = (campo) => (mapa[campo] === undefined ? '' : (l[mapa[campo]] ?? '').trim());
    const nome = pegar('nome');
    const valor = lerNumero(pegar('valor'));
    const texto = l.map((v) => v.trim()).filter(Boolean).join(' ');
    if (!texto) continue;
    if (semAcento(nome) === 'total') { ignoradas.push(`${texto} (linha de total)`); continue; }
    if (!nome || valor == null || valor <= 0) { ignoradas.push(texto); continue; }
    itens.push({ nome, valor: Math.round(valor * 100), whatsapp: pegar('whatsapp'), observacao: pegar('observacao') });
  }
  return { itens, ignoradas, erros: [] };
}

const reaisBr = (centavos) => (centavos == null ? '' : (centavos / 100).toFixed(2).replace('.', ','));
const diaBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export function csvClientes(linhas) {
  const cab = ['nome', 'whatsapp', 'deve', 'vencido', 'a_vencer', 'deve_desde', 'observacao', 'arquivado'];
  return gerarCsv(cab, linhas.map(({ cliente: c, situacao: s }) => [
    c.nome, c.whatsapp, reaisBr(s.saldo), reaisBr(s.vencido), reaisBr(s.aVencer),
    s.desde ? `${s.desdeAproximado ? 'antes de ' : ''}${diaBr(s.desde)}` : '', c.observacao, c.arquivado ? 'sim' : '',
  ]));
}

export function csvLancamentos(lancamentos, nomes) {
  const cab = ['cliente', 'tipo', 'valor', 'data', 'vencimento', 'parcela', 'descricao', 'forma_pagamento', 'registrado_em', 'cancelado_em', 'motivo_cancelamento'];
  return gerarCsv(cab, lancamentos.map((l) => [
    nomes.get(l.clienteId) || '', l.tipo === 'fiado' ? 'Fiado' : 'Pagamento', reaisBr(l.valor), diaBr(l.data),
    diaBr(l.vencimento), l.parcela, l.descricao, l.forma, dataBr(l.registradoEm),
    l.cancelado ? dataBr(l.cancelado.em) : '', l.cancelado?.motivo,
  ]));
}
