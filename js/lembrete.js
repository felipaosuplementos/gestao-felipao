// Cobrança: mensagem pronta para o WhatsApp, dia marcado para cobrar (cliente.lembrete)
// e histórico das cobranças feitas (cliente.cobrancas). Tudo fica dentro do sistema.
// O link do Google Agenda continua para as tarefas.

import { linkWhatsApp } from './fiado.js';
import { lerPreferencia } from './comum.js';

export const TEXTO_PADRAO = 'Oi {nome}, tudo bem? Passando para lembrar do valor de {valor} aqui da Felipão Suplementos. Pode ser no Pix? Obrigado! 💪';

const reais = (centavos) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';

// Texto escolhido no menu (ou o padrão).
export const textoCobranca = () => lerPreferencia('textoCobranca') || TEXTO_PADRAO;
// Cobra o que já venceu; se nada venceu ainda, o saldo todo.
export const valorCobrar = (s) => s.vencido || s.saldo;

// Registra que cobrou agora (data, hora e valor) e marca o próximo dia, ou desmarca (proxima vazia).
export function comCobrancaFeita(cliente, valorCentavos, proxima) {
  const { lembrete: _antigo, ...resto } = cliente;
  const cobrancas = [...(cliente.cobrancas || []), { em: new Date().toISOString(), valor: valorCentavos }];
  return proxima ? { ...resto, cobrancas, lembrete: { data: proxima, criadoEm: new Date().toISOString() } } : { ...resto, cobrancas };
}

// "cobrado 2x · última há 3 dias"
export function resumoCobrancas(cliente, hoje = new Date()) {
  const lista = cliente.cobrancas || [];
  if (!lista.length) return '';
  const ultima = new Date(lista[lista.length - 1].em);
  const dias = Math.round((new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()) - new Date(ultima.getFullYear(), ultima.getMonth(), ultima.getDate())) / 864e5);
  const quando = dias <= 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`;
  return `cobrado ${lista.length}x · última ${quando}`;
}

export function mensagemCobranca(texto, cliente, valorCentavos) {
  return (texto || TEXTO_PADRAO)
    .replaceAll('{nome}', primeiroNome(cliente.nome))
    .replaceAll('{valor}', reais(valorCentavos));
}

// Abre a conversa do cliente com a mensagem escrita. Sem número cadastrado,
// o WhatsApp abre a lista de contatos para escolher.
export function linkCobranca(cliente, mensagem) {
  const base = linkWhatsApp(cliente.whatsapp) || 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(mensagem)}`;
}

// ---------- Google Agenda ----------

const doisDigitos = (n) => String(n).padStart(2, '0');

// "2026-10-25" + "09:00" → "20261025T090000" (hora local do aparelho)
function horaLocal(data, hora) {
  return `${data.replaceAll('-', '')}T${hora.replace(':', '')}00`;
}

function somarMinutos(data, hora, minutos) {
  const [a, m, d] = data.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const t = new Date(a, m - 1, d, h, mi + minutos);
  return `${t.getFullYear()}${doisDigitos(t.getMonth() + 1)}${doisDigitos(t.getDate())}T${doisDigitos(t.getHours())}${doisDigitos(t.getMinutes())}00`;
}

// Abre o Google Agenda com o evento preenchido; é só tocar em Salvar.
// O link (WhatsApp com a mensagem pronta) é opcional.
export function linkGoogleAgenda({ titulo, descricao = '', link, data, hora }) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: titulo,
    dates: `${horaLocal(data, hora)}/${somarMinutos(data, hora, 15)}`,
    details: link ? `${descricao}\n\nAbrir WhatsApp com a mensagem pronta:\n${link}` : descricao,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

// Próxima data para os atalhos (amanhã, em N dias, próximo dia X do mês).
export function dataAtalho(atalho, hoje = new Date()) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  if (atalho.startsWith('+')) d.setDate(d.getDate() + Number(atalho.slice(1)));
  else if (atalho.startsWith('dia')) {
    const dia = Number(atalho.slice(3));
    if (d.getDate() >= dia) d.setMonth(d.getMonth() + 1, 1);
    d.setDate(Math.min(dia, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}
