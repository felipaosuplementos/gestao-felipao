// Backup completo: um arquivo só com TUDO do sistema (produtos, fotos, clientes, fiado,
// vendas, tarefas, pedidos…). Serve para guardar uma cópia fora da nuvem e para
// restaurar o sistema se algo for apagado ou alterado por engano.

import * as db from './db.js';
import { baixarArquivo } from './planilha.js';
import { $, dataHora, avisar, confirmarComMotivo, semAcento, lerPreferencia } from './comum.js';

const FORMATO = 1;
const DIAS_LEMBRAR = 7;
const NOMES = {
  produtos: 'produtos', fotos: 'fotos', movimentos: 'movimentos de estoque', clientes: 'clientes', lancamentos: 'lançamentos de fiado',
  vendas: 'vendas', tarefas: 'tarefas', pedidos: 'itens da lista de pedidos',
};

const paraTexto = (blob) => new Promise((ok, erro) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => erro(r.error);
  r.readAsDataURL(blob);
});
const paraBlob = async (texto) => (await fetch(texto)).blob();

const resumo = (contagem) => Object.entries(contagem).filter(([, n]) => n)
  .map(([loja, n]) => `${n} ${NOMES[loja] || loja}`).join(', ');

export async function baixarBackupCompleto() {
  const tudo = await db.lerTudo();
  // Fotos viram texto para caber no arquivo.
  const fotos = await Promise.all(tudo.fotos.map(async (f) => ({ chave: f.chave, valor: await paraTexto(f.valor) })));
  const dados = { ...tudo, fotos };
  const contagem = Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, v.length]));
  const arquivo = { app: 'gestao-felipao', formato: FORMATO, criadoEm: new Date().toISOString(), contagem, dados };
  const dia = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  const json = JSON.stringify(arquivo);
  // Anota a data ANTES de baixar (no iPhone o download pode tirar o sistema da tela)
  // e no banco que sincroniza: fazendo no celular, o aviso some também no computador.
  await db.salvarAjuste({ id: 'backup', ultimoBackupCompleto: arquivo.criadoEm });
  baixarArquivo(`felipao-backup-completo-${dia}-${hora}.json`, json, 'application/json');
  atualizarLembrete();
  return contagem;
}

async function restaurar(arquivo) {
  let backup;
  try {
    backup = JSON.parse(await arquivo.text());
  } catch {
    avisar('Esse arquivo não é um backup completo do sistema.');
    return;
  }
  if (backup?.app !== 'gestao-felipao' || !backup.dados) { avisar('Esse arquivo não é um backup completo do sistema.'); return; }
  if (backup.formato > FORMATO) { avisar('Esse backup é de uma versão mais nova. Atualize o sistema e tente de novo.'); return; }

  const resposta = await confirmarComMotivo(
    'Restaurar backup completo?',
    `Backup de ${dataHora(backup.criadoEm)}, com ${resumo(backup.contagem)}. Tudo o que está nele volta para o sistema (e para a nuvem). `
      + 'Nada é apagado: o que você criou depois desse backup continua. Mas o que foi alterado depois volta a ser como era no backup. '
      + 'Antes, o sistema baixa um backup de agora, por segurança. Para confirmar, digite RESTAURAR.',
    'Restaurar',
    'Digite RESTAURAR',
  );
  if (resposta === null) return;
  if (semAcento(resposta) !== 'restaurar') { avisar('Nada foi restaurado. Para confirmar, digite RESTAURAR.'); return; }

  await baixarBackupCompleto();
  const fotos = await Promise.all((backup.dados.fotos || []).map(async (f) => ({ chave: f.chave, valor: await paraBlob(f.valor) })));
  // A data do último backup não volta para a do arquivo (o backup de segurança acabou de ser feito).
  const { ajustes: _ajustes, ...dados } = backup.dados;
  await db.restaurarTudo({ ...dados, fotos });
  await db.corrigirNumerosVendas();
  document.dispatchEvent(new CustomEvent('dados-mudaram'));
  avisar(`Backup de ${dataHora(backup.criadoEm)} restaurado`);
}

// ---------- Lembrete semanal ----------

// Data do último backup completo feito em qualquer aparelho (a anotação antiga, só deste aparelho, também vale).
async function ultimoBackup() {
  const ajuste = await db.lerAjuste('backup').catch(() => null);
  const datas = [ajuste?.ultimoBackupCompleto, lerPreferencia('ultimoBackupCompleto')].filter(Boolean).sort();
  return datas[datas.length - 1] || null;
}

async function atualizarLembrete() {
  const ultimo = await ultimoBackup();
  const atrasado = !ultimo || (Date.now() - new Date(ultimo).getTime()) / 864e5 >= DIAS_LEMBRAR;
  const info = $('#menu-backup-info');
  info.textContent = ultimo
    ? `Último backup completo: ${dataHora(ultimo)}.${atrasado ? ' Já passou uma semana: faça outro.' : ''}`
    : 'Nenhum backup completo feito ainda. Faça um por semana e guarde no Google Drive.';
  info.classList.toggle('menu-info-alerta', atrasado);
  const aviso = $('#aviso-backup-completo');
  aviso.hidden = !atrasado;
  aviso.innerHTML = `<strong>Faça seu backup da semana.</strong> ${ultimo ? `O último foi em ${dataHora(ultimo)}.` : 'Você ainda não fez nenhum backup completo.'}
    É uma cópia de tudo, para guardar fora da nuvem.
    <br><button class="btn" id="btn-backup-aviso-completo">💾 Baixar backup completo</button>`;
}

// ---------- Eventos ----------

async function baixarComAviso() {
  const contagem = await baixarBackupCompleto();
  avisar(`Backup completo baixado: ${resumo(contagem)}`);
}

$('#menu-backup-completo').addEventListener('click', async () => {
  $('#dlg-menu').close();
  await baixarComAviso();
});
$('#input-backup-completo').addEventListener('change', async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  $('#dlg-menu').close();
  await restaurar(arquivo);
});
$('#aviso-backup-completo').addEventListener('click', (e) => { if (e.target.closest('#btn-backup-aviso-completo')) baixarComAviso(); });
document.querySelectorAll('.btn-abrir-menu').forEach((b) => b.addEventListener('click', atualizarLembrete));
// Backup feito no outro aparelho chega pela nuvem: atualiza o aviso.
document.addEventListener('dados-mudaram', atualizarLembrete);
atualizarLembrete();
