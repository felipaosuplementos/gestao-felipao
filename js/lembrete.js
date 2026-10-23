// Lembrete de cobrança: mensagem pronta para o WhatsApp e evento no calendário do aparelho
// (o calendário avisa na hora marcada, mesmo com o sistema fechado).

import { linkWhatsApp } from './fiado.js';

export const TEXTO_PADRAO = 'Oi {nome}, tudo bem? Passando para lembrar do valor de {valor} aqui da Felipão Suplementos. Pode ser no Pix? Obrigado! 💪';

const reais = (centavos) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';

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

// ---------- Calendário (.ics) ----------

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

const escaparIcs = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Linhas do .ics têm no máximo 75 bytes; as maiores continuam na linha de baixo começando com espaço.
function dobrar(linha) {
  const bytes = new TextEncoder();
  const partes = [];
  let atual = '';
  for (const ch of linha) {
    if (bytes.encode(atual + ch).length > (partes.length ? 74 : 75)) { partes.push(atual); atual = ''; }
    atual += ch;
  }
  partes.push(atual);
  return partes.join('\r\n ');
}

export function gerarIcs({ id, titulo, descricao, link, data, hora }) {
  const agoraUtc = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gestao Felipao//Cobranca//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:cobranca-${id}-${data}@gestao-felipao`,
    `DTSTAMP:${agoraUtc}`,
    `DTSTART:${horaLocal(data, hora)}`,
    `DTEND:${somarMinutos(data, hora, 15)}`,
    `SUMMARY:${escaparIcs(titulo)}`,
    `DESCRIPTION:${escaparIcs(`${descricao}\n\nAbrir WhatsApp com a mensagem pronta:\n${link}`)}`,
    `URL:${link}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escaparIcs(titulo)}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].map(dobrar).join('\r\n') + '\r\n';
}

// Link para o Google Agenda (alternativa ao arquivo do calendário).
export function linkGoogleAgenda({ titulo, descricao, link, data, hora }) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: titulo,
    dates: `${horaLocal(data, hora)}/${somarMinutos(data, hora, 15)}`,
    details: `${descricao}\n\nAbrir WhatsApp com a mensagem pronta:\n${link}`,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

// Entrega o .ics ao aparelho. No iPhone/iPad abre direto a tela "Adicionar ao Calendário".
export function abrirNoCalendario(ics, nomeArquivo) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) {
    const url = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    if (!window.open(url, '_blank')) location.href = url;
    return;
  }
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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
