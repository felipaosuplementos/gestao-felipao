// Contas da venda, em centavos.

// itens: [{ quantidade, precoUnit, custoUnit }] — custoUnit pode ser null (custo não cadastrado).
// Frete: se o cliente paga, soma no total (não é lucro); se o Felipão paga, sai do lucro.
export function calcularVenda(itens, desconto = 0, frete = 0, fretePagoPor = 'cliente') {
  const subtotal = itens.reduce((s, i) => s + i.quantidade * i.precoUnit, 0);
  const descontoValido = Math.min(Math.max(0, desconto), subtotal);
  const freteValido = Math.max(0, frete || 0);
  const total = subtotal - descontoValido + (fretePagoPor === 'cliente' ? freteValido : 0);
  const comCusto = itens.filter((i) => i.custoUnit != null);
  const custo = comCusto.reduce((s, i) => s + i.quantidade * i.custoUnit, 0);
  // Lucro só dos itens com custo; o desconto sai proporcionalmente desses itens.
  const vendaComCusto = comCusto.reduce((s, i) => s + i.quantidade * i.precoUnit, 0);
  const descontoComCusto = subtotal ? Math.round(descontoValido * (vendaComCusto / subtotal)) : 0;
  return {
    subtotal,
    desconto: descontoValido,
    total,
    lucro: comCusto.length ? vendaComCusto - descontoComCusto - custo - (fretePagoPor === 'eu' ? freteValido : 0) : null,
    frete: freteValido,
    itensSemCusto: itens.length - comCusto.length,
  };
}

export function calcularTroco(total, recebido) {
  if (recebido == null || recebido < total) return null;
  return recebido - total;
}

export const FORMAS_PAGAMENTO = [
  { id: 'pix', nome: 'Pix' },
  { id: 'dinheiro', nome: 'Dinheiro' },
  { id: 'debito', nome: 'Débito' },
  { id: 'credito', nome: 'Crédito' },
  { id: 'link', nome: 'Link de pagamento' },
  { id: 'fiado', nome: 'Fiado' },
];
export const nomeForma = (id) => FORMAS_PAGAMENTO.find((f) => f.id === id)?.nome || id;

// Resumo de um conjunto de vendas (ignora as canceladas).
export function resumirVendas(vendas) {
  const validas = vendas.filter((v) => !v.cancelada);
  const porForma = {};
  for (const v of validas) porForma[v.forma] = (porForma[v.forma] || 0) + v.total;
  return {
    quantidade: validas.length,
    total: validas.reduce((s, v) => s + v.total, 0),
    lucro: validas.reduce((s, v) => s + (v.lucro || 0), 0),
    // Vendas sem custo informado (no todo ou em algum produto): o lucro delas não é conhecido.
    semCusto: validas.filter((v) => v.lucro == null || v.itensSemCusto).length,
    comLucro: validas.filter((v) => v.lucro != null).length,
    porForma,
  };
}

// Lucro para mostrar: "sem custo" quando nenhuma venda tem custo (nunca um zero falso);
// com * quando parte das vendas está sem custo.
export function textoLucro(r, formatar) {
  if (r.quantidade && !r.comLucro) return 'sem custo';
  return `${formatar(r.lucro)}${r.semCusto ? '*' : ''}`;
}
