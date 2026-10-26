// Tarefas do dia a dia: anotar rápido, colar a lista do Notas e ver tudo separado por dia.
// O que não foi feito no dia passa sozinho para "Atrasadas". As cobranças marcadas
// com ⏰ na ficha do cliente entram na lista no dia delas.

import * as db from './db.js';
import { gerarCsv, baixarArquivo } from './planilha.js';
import { $, esc, hojeISO, dataCurta, dataHora, avisar, confirmar, moedaCentavos } from './comum.js';
import { situacaoCliente } from './fiado.js';
import {
  textoCobranca, valorCobrar, mensagemCobranca, linkCobranca, linkGoogleAgenda, dataAtalho, comCobrancaFeita,
} from './lembrete.js';

const DIAS_FEITAS = 7;
const horaCurta = (iso) => {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return hojeISO(d) === hojeISO() ? `às ${hora}` : `em ${dataCurta(hojeISO(d))}`;
}; // feitas que continuam aparecendo na tela (o resto fica no backup)

const estado = {
  tarefas: [],
  cobrancas: [], // { cliente, situacao } de quem tem lembrete de cobrança
  diaNova: 'hoje',
  diaColar: 'hoje',
  aberta: null, // tarefa no diálogo de edição
};

// ---------- Carregar ----------

async function carregar() {
  const [tarefas, clientes, lancamentos] = await Promise.all([db.listarTarefas(), db.listarClientes(), db.listarLancamentos()]);
  const hoje = hojeISO();
  const comLembrete = clientes.filter((c) => c.lembrete && !c.arquivado);
  estado.tarefas = tarefas;
  estado.cobrancas = comLembrete
    .map((cliente) => ({ cliente, situacao: situacaoCliente(lancamentos.filter((l) => l.clienteId === cliente.id), hoje) }))
    .filter((i) => i.situacao.saldo > 0);
  render();
}

// ---------- Lista ----------

const GRUPOS = [
  { id: 'atrasadas', nome: 'Atrasadas', classe: 'grupo-atrasado' },
  { id: 'hoje', nome: 'Hoje' },
  { id: 'amanha', nome: 'Amanhã' },
  { id: 'depois', nome: 'Próximos dias' },
];

function grupoDo(data, hoje, amanha) {
  if (data < hoje) return 'atrasadas';
  if (data === hoje) return 'hoje';
  if (data === amanha) return 'amanha';
  return 'depois';
}

// Sem hora fica depois das que têm hora no mesmo dia.
const chaveOrdem = (data, hora, criada = '') => `${data}T${hora || '99:99'}|${criada}`;

function linhaTarefa(t, grupo) {
  const partes = [];
  if (grupo === 'atrasadas' || grupo === 'depois') partes.push(grupo === 'atrasadas' ? `era para ${dataCurta(t.data)}` : dataCurta(t.data));
  if (t.hora) partes.push(`🕐 ${t.hora}`);
  if (t.avisoGoogle) partes.push('⏰ no Google Agenda');
  const conferida = t.conferida ? `<span class="tarefa-conferida">✔ conferido ${horaCurta(t.conferida.em)}</span>` : '';
  return `
    <li class="tarefa ${t.conferida ? 'tarefa-ok' : ''}">
      <button class="tarefa-check" data-feita="${t.id}" aria-label="Marcar como feita"></button>
      <button class="tarefa-texto" data-editar="${t.id}">
        <span class="tarefa-nome">${esc(t.texto)}</span>
        ${partes.length ? `<span class="item-sub">${esc(partes.join(' · '))}</span>` : ''}
        ${conferida}
      </button>
      <button class="btn-conferir ${t.conferida ? 'ligado' : ''}" data-conferir="${t.id}"
        aria-label="${t.conferida ? 'Desmarcar conferido' : 'Marcar como conferido'}" aria-pressed="${!!t.conferida}">
        <span class="conferir-marca">✔</span><small>${t.conferida ? 'Conferido' : 'Conferir'}</small>
      </button>
    </li>`;
}

function linhaCobranca({ cliente: c, situacao: s }, grupo) {
  const { data, hora } = c.lembrete;
  const valor = valorCobrar(s);
  const link = linkCobranca(c, mensagemCobranca(textoCobranca(), c, valor));
  const quando = [grupo === 'atrasadas' ? `era para ${dataCurta(data)}` : grupo === 'depois' ? dataCurta(data) : '', hora ? `🕐 ${hora}` : '']
    .filter(Boolean).join(' · ');
  return `
    <li class="tarefa tarefa-cobranca">
      <button class="tarefa-check" data-cobrei="${c.id}" aria-label="Já cobrei"></button>
      <button class="tarefa-texto" data-cliente="${c.id}">
        <span class="tarefa-nome">💰 Cobrar ${esc(c.nome)} — ${moedaCentavos(valor)}</span>
        ${quando ? `<span class="item-sub">${esc(quando)}</span>` : ''}
      </button>
      <a class="btn btn-cobrar" href="${link}" target="_blank" rel="noopener" aria-label="Cobrar no WhatsApp">💬</a>
    </li>`;
}

function render() {
  const hoje = hojeISO();
  const amanha = dataAtalho('+1');
  const abertas = estado.tarefas.filter((t) => !t.feita);
  const grupos = Object.fromEntries(GRUPOS.map((g) => [g.id, []]));

  for (const t of abertas) grupos[grupoDo(t.data, hoje, amanha)].push({ chave: chaveOrdem(t.data, t.hora, t.criadaEm), html: (g) => linhaTarefa(t, g) });
  for (const i of estado.cobrancas) {
    const { data, hora } = i.cliente.lembrete;
    grupos[grupoDo(data, hoje, amanha)].push({ chave: chaveOrdem(data, hora), html: (g) => linhaCobranca(i, g) });
  }

  const limite = new Date(Date.now() - DIAS_FEITAS * 864e5).toISOString();
  const feitas = estado.tarefas.filter((t) => t.feita && t.feita.em >= limite).sort((a, b) => b.feita.em.localeCompare(a.feita.em));

  const blocos = GRUPOS.filter((g) => grupos[g.id].length || g.id === 'hoje').map((g) => {
    const itens = grupos[g.id].sort((a, b) => a.chave.localeCompare(b.chave));
    return `
      <h2 class="grupo-titulo ${g.classe || ''}">${g.nome}${itens.length ? ` <span>${itens.length}</span>` : ''}</h2>
      ${itens.length ? `<ul class="lista lista-tarefas">${itens.map((i) => i.html(g.id)).join('')}</ul>`
    : '<p class="tarefas-vazio">Nada para hoje por enquanto 🎉</p>'}`;
  });

  if (feitas.length) {
    blocos.push(`
      <details class="feitas">
        <summary>✓ Feitas nos últimos ${DIAS_FEITAS} dias (${feitas.length})</summary>
        <ul class="lista lista-tarefas">${feitas.map((t) => `
          <li class="tarefa tarefa-feita">
            <button class="tarefa-check marcada" data-desfazer="${t.id}" aria-label="Desmarcar"></button>
            <div class="tarefa-texto">
              <span class="tarefa-nome">${esc(t.texto)}</span>
              <span class="item-sub">feita em ${dataHora(t.feita.em)}</span>
            </div>
          </li>`).join('')}</ul>
      </details>`);
  }

  $('#lista-tarefas').innerHTML = blocos.join('');
  $('#tarefas-hoje-texto').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  atualizarContador(grupos.atrasadas.length + grupos.hoje.length);
}

// Número no ícone da aba: o que falta fazer hoje (incluindo as atrasadas).
function atualizarContador(n) {
  const el = $('#tarefas-contador');
  el.textContent = n > 99 ? '99+' : String(n);
  el.hidden = !n;
}

// ---------- Anotar rápido ----------

function marcarChip(container, dia) {
  container.querySelectorAll('[data-dia]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dia === dia)));
}

function diaEscolhido() {
  if (estado.diaNova === 'amanha') return dataAtalho('+1');
  if (estado.diaNova === 'outro') return $('#nova-tarefa-data').value || hojeISO();
  return hojeISO();
}

$('#nova-tarefa-dias').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-dia]');
  if (!chip) return;
  estado.diaNova = chip.dataset.dia;
  marcarChip($('#nova-tarefa-dias'), estado.diaNova);
  const campoData = $('#nova-tarefa-data');
  campoData.hidden = estado.diaNova !== 'outro';
  if (!campoData.hidden) {
    campoData.min = hojeISO();
    if (!campoData.value) campoData.value = dataAtalho('+2');
    campoData.showPicker?.();
  }
});

$('#form-nova-tarefa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const campo = $('#nova-tarefa-texto');
  const texto = campo.value.trim();
  if (!texto) { campo.focus(); return; }
  const data = diaEscolhido();
  const hora = $('#nova-tarefa-hora').value;
  await db.salvarTarefas([{ texto, data, hora }]);
  campo.value = '';
  $('#nova-tarefa-hora').value = '';
  campo.focus(); // dá para anotar a próxima em seguida
  avisar(`Tarefa anotada para ${data === hojeISO() ? 'hoje' : data === dataAtalho('+1') ? 'amanhã' : dataCurta(data)}`);
  await carregar();
});

// ---------- Marcar feita / abrir ----------

const tarefaDo = (id) => estado.tarefas.find((t) => t.id === id);

$('#lista-tarefas').addEventListener('click', async (e) => {
  const alvo = e.target.closest('[data-feita],[data-desfazer],[data-editar],[data-cobrei],[data-cliente],[data-conferir]');
  if (!alvo) return;
  const { feita, desfazer, editar, cobrei, cliente, conferir } = alvo.dataset;

  // Conferido: uma marca separada (ex.: pedido separado e conferido), a tarefa continua na lista.
  if (conferir) {
    const t = tarefaDo(conferir);
    alvo.classList.toggle('ligado', !t.conferida);
    await db.salvarTarefas([{ ...t, conferida: t.conferida ? null : { em: new Date().toISOString() } }]);
    avisar(t.conferida ? 'Conferido desmarcado' : 'Conferido ✔');
    await carregar();
  }

  if (feita || desfazer) {
    const t = tarefaDo(feita || desfazer);
    if (feita) alvo.classList.add('marcada'); // resposta imediata ao toque
    await db.salvarTarefas([{ ...t, feita: feita ? { em: new Date().toISOString() } : null }]);
    avisar(feita ? 'Feita ✓' : 'Voltou para a lista');
    await carregar();
  }
  if (editar) abrirTarefa(tarefaDo(editar));
  if (cobrei) {
    const i = estado.cobrancas.find((x) => x.cliente.id === cobrei);
    alvo.classList.add('marcada');
    // Fica registrada no histórico de cobranças do cliente (sem marcar a próxima).
    await db.salvarCliente(comCobrancaFeita(i.cliente, valorCobrar(i.situacao), null));
    avisar(`Cobrança de ${i.cliente.nome} feita ✓`);
    await carregar();
  }
  if (cliente) document.dispatchEvent(new CustomEvent('abrir-cliente', { detail: cliente }));
});

// A ficha do cliente pode mudar a cobrança (pagamento, novo lembrete): atualiza a lista ao fechar.
$('#dlg-cliente').addEventListener('close', () => { if (!$('#tela-tarefas').hidden) carregar(); });

// ---------- Mudar / avisar / apagar ----------

function abrirTarefa(t) {
  estado.aberta = t;
  const form = $('#form-tarefa');
  form.texto.value = t.texto;
  form.data.value = t.data;
  form.hora.value = t.hora || '';
  $('#tarefa-info').textContent = `Anotada em ${dataHora(t.criadaEm)}${t.avisoGoogle ? ' · aviso colocado no Google Agenda' : ''}`;
  $('#dlg-tarefa').showModal();
}

$('#form-tarefa').addEventListener('click', (e) => {
  const atalho = e.target.closest('[data-atalho]');
  if (atalho) $('#form-tarefa').data.value = dataAtalho(atalho.dataset.atalho);
});

$('#form-tarefa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const texto = form.texto.value.trim();
  if (!texto) { avisar('Escreva o que precisa fazer'); return; }
  const data = form.data.value || hojeISO();
  const avisarGoogle = e.submitter?.id === 'tarefa-avisar';
  const hora = form.hora.value || (avisarGoogle ? '09:00' : '');
  // Abre o Google Agenda antes de gravar (o navegador só deixa abrir janela logo após o toque).
  if (avisarGoogle) window.open(linkGoogleAgenda({ titulo: `✅ ${texto}`, descricao: 'Tarefa da Gestão Felipão', data, hora }), '_blank');
  $('#dlg-tarefa').close();
  await db.salvarTarefas([{ ...estado.aberta, texto, data, hora, ...(avisarGoogle ? { avisoGoogle: true } : {}) }]);
  avisar(avisarGoogle ? `Aviso no Google Agenda: ${dataCurta(data)} às ${hora}` : 'Tarefa salva');
  await carregar();
});

$('#tarefa-apagar').addEventListener('click', async () => {
  const t = estado.aberta;
  $('#dlg-tarefa').close();
  const ok = await confirmar('Apagar tarefa?', `"${t.texto}" sai da lista de vez.${t.avisoGoogle ? ' Se colocou aviso no Google Agenda, apague lá também.' : ''}`, 'Apagar');
  if (!ok) return;
  await db.apagarTarefa(t.id);
  avisar('Tarefa apagada');
  await carregar();
});

// ---------- Colar lista do Notas ----------

// Tira marcadores de lista (-, •, ◦, ☐, [ ], 1.) do começo da linha.
export function linhasParaTarefas(texto) {
  return texto.split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•◦▪●○☐☑✓✔]|\[[ xX]?\]|\d+[.)-])\s*/u, '').trim())
    .filter(Boolean);
}

function atualizarColar() {
  const n = linhasParaTarefas($('#colar-tarefas-texto').value).length;
  const botao = $('#colar-tarefas-confirmar');
  botao.disabled = !n;
  botao.textContent = n ? `Adicionar ${n} tarefa${n > 1 ? 's' : ''}` : 'Adicionar tarefas';
}

$('#btn-colar-tarefas').addEventListener('click', () => {
  $('#colar-tarefas-texto').value = '';
  estado.diaColar = 'hoje';
  marcarChip($('#colar-tarefas-dias'), 'hoje');
  atualizarColar();
  $('#dlg-colar-tarefas').showModal();
});
$('#colar-tarefas-texto').addEventListener('input', atualizarColar);
$('#colar-tarefas-dias').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-dia]');
  if (!chip) return;
  estado.diaColar = chip.dataset.dia;
  marcarChip($('#colar-tarefas-dias'), estado.diaColar);
});

$('#form-colar-tarefas').addEventListener('submit', async (e) => {
  e.preventDefault();
  const linhas = linhasParaTarefas($('#colar-tarefas-texto').value);
  if (!linhas.length) return;
  const data = estado.diaColar === 'amanha' ? dataAtalho('+1') : hojeISO();
  // Um milésimo de diferença em cada uma mantém a ordem da lista colada.
  const base = Date.now();
  await db.salvarTarefas(linhas.map((texto, i) => ({ texto, data, hora: '', criadaEm: new Date(base + i).toISOString() })));
  $('#dlg-colar-tarefas').close();
  avisar(`${linhas.length} tarefa${linhas.length > 1 ? 's' : ''} adicionada${linhas.length > 1 ? 's' : ''}`);
  await carregar();
});

// ---------- Backup ----------

export function csvTarefas(tarefas) {
  const cab = ['situacao', 'dia', 'hora', 'tarefa', 'anotada_em', 'conferida_em', 'feita_em'];
  const ordem = [...tarefas].sort((a, b) => (!!a.feita - !!b.feita) || chaveOrdem(a.data, a.hora, a.criadaEm).localeCompare(chaveOrdem(b.data, b.hora, b.criadaEm)));
  const br = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '');
  return gerarCsv(cab, ordem.map((t) => [t.feita ? 'Feita' : 'A fazer', dataCurta(t.data), t.hora, t.texto, br(t.criadaEm), br(t.conferida?.em), br(t.feita?.em)]));
}

$('#menu-exportar-tarefas').addEventListener('click', async () => {
  baixarArquivo(`felipao-tarefas-${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`, csvTarefas(await db.listarTarefas()));
  $('#dlg-menu').close();
  avisar('Planilha de tarefas baixada');
});

// ---------- Eventos ----------

document.addEventListener('tela-aberta', (e) => { if (e.detail === 'tarefas') carregar(); });
document.addEventListener('dados-mudaram', () => carregar());
// Virou o dia com o sistema aberto: reorganiza (o que ficou para trás vai para Atrasadas).
document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(); });
carregar();
