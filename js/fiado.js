// Contas do fiado: quanto o cliente deve, desde quando e o que está para vencer.
// Pagamentos abatem primeiro a dívida mais antiga.

const referencia = (l) => l.vencimento || l.data;

export function situacaoCliente(lancamentos, hoje) {
  const validos = lancamentos.filter((l) => !l.cancelado);
  const dividas = validos
    .filter((l) => l.tipo === 'fiado')
    .sort((a, b) => referencia(a).localeCompare(referencia(b)) || (a.registradoEm || '').localeCompare(b.registradoEm || ''));
  let pago = validos.filter((l) => l.tipo === 'pagamento').reduce((s, l) => s + l.valor, 0);
  const totalDividas = dividas.reduce((s, l) => s + l.valor, 0);

  const abertos = [];
  for (const d of dividas) {
    const abate = Math.min(pago, d.valor);
    pago -= abate;
    if (d.valor - abate > 0) abertos.push({ ...d, restante: d.valor - abate });
  }

  const vencidos = abertos.filter((d) => referencia(d) <= hoje);
  const aVencer = abertos.filter((d) => referencia(d) > hoje);
  const maisAntigo = vencidos[0];
  return {
    saldo: abertos.reduce((s, d) => s + d.restante, 0),
    vencido: vencidos.reduce((s, d) => s + d.restante, 0),
    aVencer: aVencer.reduce((s, d) => s + d.restante, 0),
    credito: Math.max(0, validos.filter((l) => l.tipo === 'pagamento').reduce((s, l) => s + l.valor, 0) - totalDividas),
    desde: maisAntigo ? referencia(maisAntigo) : null,
    desdeAproximado: !!maisAntigo?.dataAproximada,
    diasAtraso: maisAntigo ? diasEntre(referencia(maisAntigo), hoje) : 0,
    proximoVencimento: aVencer[0] ? { data: referencia(aVencer[0]), valor: aVencer[0].restante } : null,
    abertos,
  };
}

export function diasEntre(deISO, ateISO) {
  return Math.round((Date.parse(ateISO) - Date.parse(deISO)) / 86400000);
}

// Soma meses mantendo o dia (31/01 + 1 mês = 28 ou 29/02).
export function somarMeses(iso, meses) {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

// Divide um valor em parcelas mensais de reais inteiros; o que sobra vai na primeira
// (ex.: R$ 1.007 em 2x = R$ 504 + R$ 503).
export function dividirParcelas(valor, quantidade, primeiroVencimento) {
  const base = Math.floor(valor / quantidade / 100) * 100;
  return Array.from({ length: quantidade }, (_, i) => ({
    valor: base + (i === 0 ? valor - base * quantidade : 0),
    vencimento: somarMeses(primeiroVencimento, i),
    parcela: `${i + 1}/${quantidade}`,
  }));
}

// Link do WhatsApp. Número sem DDD recebe o 37 (Oliveira/MG).
export function linkWhatsApp(numero) {
  let n = String(numero || '').replace(/\D/g, '');
  if (!n) return null;
  if (n.length === 8 || n.length === 9) n = `37${n}`;
  if (n.length === 10 || n.length === 11) n = `55${n}`;
  return `https://wa.me/${n}`;
}
