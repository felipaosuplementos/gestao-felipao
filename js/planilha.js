// Leitura e geração de planilhas (CSV com ";" — abre direto no Excel em português).

export function lerCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] || '';
  const contar = (c) => primeiraLinha.split(c).length - 1;
  const sep = contar(';') >= contar(',') ? ';' : (contar('\t') > contar(',') ? '\t' : ',');

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
