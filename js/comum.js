// Funções usadas por todas as telas.

// Segurança: o sistema não pode ser aberto "dentro" de outro site (golpe de clique escondido).
if (window.top !== window.self) {
  try { window.top.location.replace(window.self.location.href); } catch { /* bloqueado */ }
  document.documentElement.replaceChildren();
}

export const $ = (sel) => document.querySelector(sel);

// Converte uma foto em texto ("data:image/...;base64,...") de volta em arquivo, sem usar a internet.
export function dataUrlParaBlob(texto) {
  const [cabeca, base64 = ''] = String(texto).split(',', 2);
  const tipo = (cabeca.match(/^data:([^;,]+)/) || [])[1] || 'image/jpeg';
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}

export const moeda = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
// Valores de dinheiro do fiado ficam guardados em centavos (número inteiro) para não errar contas.
export const moedaCentavos = (c) => moeda(c == null ? null : c / 100);
export const paraCentavos = (reais) => (reais == null ? null : Math.round(reais * 100));

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

// Datas "do dia" (sem hora) no formato AAAA-MM-DD, no fuso do aparelho.
export function hojeISO(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function dataCurta(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

// "37991401400" → "(37) 99140-1400" (só para mostrar; o número guardado não muda).
export function telefoneBonito(numero) {
  const d = String(numero || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return String(numero || '');
}

let avisoTimer;
export function avisar(texto) {
  const el = $('#aviso');
  // Com uma janela aberta, o aviso vai para dentro dela (senão fica escondido atrás).
  const janelas = [...document.querySelectorAll('dialog[open]')];
  const modais = janelas.filter((d) => d.matches(':modal'));
  const lugar = modais[modais.length - 1] || janelas[janelas.length - 1] || document.body;
  if (el.parentElement !== lugar) lugar.appendChild(el);
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

// No computador, a ficha (cliente, venda) abre ao lado da lista, sem cobrir a tela:
// dá para clicar em outro item da lista e a ficha troca. No celular, abre por cima como sempre.
const telaLarga = matchMedia('(min-width: 1024px)');
export function abrirAoLado(dlg) {
  if (dlg.open) return;
  if (!telaLarga.matches) { dlg.showModal(); return; }
  document.querySelectorAll('dialog.ao-lado[open]').forEach((d) => d.close());
  dlg.classList.add('ao-lado');
  dlg.show();
  document.body.classList.add('com-ficha');
  dlg.addEventListener('close', () => {
    dlg.classList.remove('ao-lado');
    if (!document.querySelector('dialog.ao-lado[open]')) document.body.classList.remove('com-ficha');
    document.dispatchEvent(new CustomEvent('ficha-fechada'));
  }, { once: true });
}
// Destaca na lista o item cuja ficha está aberta ao lado.
export function marcarSelecionado(lista, id) {
  document.querySelectorAll(`${lista} .item`).forEach((b) => {
    const meu = b.dataset.id === String(id) || b.dataset.venda === String(id);
    if (meu && telaLarga.matches) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
}
document.addEventListener('ficha-fechada', () => document.querySelectorAll('.item[aria-current]').forEach((b) => b.removeAttribute('aria-current')));

// Esc fecha a ficha aberta ao lado (as janelas por cima já fecham sozinhas).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]:modal')) return;
  document.querySelector('dialog.ao-lado[open]')?.close();
});
// Trocar de tela fecha a ficha.
document.addEventListener('tela-aberta', () => document.querySelector('dialog.ao-lado[open]')?.close());

export function confirmar(titulo, texto, rotuloSim = 'Confirmar', perigo = true) {
  const dlg = $('#dlg-confirmar');
  $('#confirmar-titulo').textContent = titulo;
  $('#confirmar-texto').textContent = texto;
  const sim = $('#confirmar-sim');
  sim.textContent = rotuloSim;
  sim.className = `btn ${perigo ? 'btn-perigo' : 'btn-primario'}`;
  return new Promise((resolve) => {
    const fim = (v) => { dlg.close(); sim.onclick = null; $('#confirmar-nao').onclick = null; resolve(v); };
    sim.onclick = () => fim(true);
    $('#confirmar-nao').onclick = () => fim(false);
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
  });
}

// Igual ao confirmar, mas com um campo de texto (ex.: motivo). Devolve o texto, ou null se desistiu.
export async function confirmarComMotivo(titulo, texto, rotuloSim, dica = 'Motivo (opcional)') {
  const campo = $('#confirmar-campo');
  campo.value = '';
  campo.placeholder = dica;
  campo.hidden = false;
  const ok = await confirmar(titulo, texto, rotuloSim);
  campo.hidden = true;
  return ok ? campo.value.trim() : null;
}

// Contagem de estoque: desligada até o Felipão querer contar (Menu → Controlar estoque).
export const controlaEstoque = () => lerPreferencia('controlarEstoque') === 'sim';

export function lerPreferencia(chave) {
  try { return localStorage.getItem(`felipao.${chave}`); } catch { return null; }
}
export function gravarPreferencia(chave, valor) {
  try { localStorage.setItem(`felipao.${chave}`, valor); } catch { /* sem acesso */ }
}
