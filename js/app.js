import * as db from './db.js';
import {
  lerCsv, linhasParaProdutos, lerNumero, lerInteiro,
  csvProdutos, csvMovimentos, baixarArquivo, nomeTipo,
} from './planilha.js';
import {
  $, moeda, esc, semAcento, dataHora, avisar, confirmar, lerPreferencia, gravarPreferencia, controlaEstoque,
} from './comum.js';

const MINIMO_PADRAO = 2;
const DIAS_AVISO_BACKUP = 7;

const categoriaPrincipal = (c) => (c || 'Sem categoria').split('>')[0].trim();
// Sem foto, mostra as iniciais da marca (ex.: Max Titanium → MT).
const iniciais = (p) => esc((p.marca || p.nome || '?').split(/\s+/).filter((w) => /^[\p{L}\d]/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase());

const estado = {
  produtos: [],
  filtro: 'todos',
  categoria: '',
  busca: '',
  fotos: new Map(), // produtoId -> URL da foto
};

// ---------- Situação do estoque ----------

function minimo(p) { return p.estoqueMinimo ?? MINIMO_PADRAO; }
function situacao(p) {
  if (p.quantidade == null) return 'conferir';
  if (p.quantidade === 0) return 'zero';
  if (p.quantidade <= minimo(p)) return 'baixo';
  return 'ok';
}
const faltaConferir = (p) => p.quantidade == null || p.preco == null || p.custo == null;

const FILTROS_ESTOQUE = [
  { id: 'todos', nome: 'Todos', teste: () => true },
  { id: 'acabando', nome: 'Acabando', teste: (p) => situacao(p) === 'baixo' },
  { id: 'zerados', nome: 'Sem estoque', teste: (p) => situacao(p) === 'zero' },
  { id: 'conferir', nome: 'A conferir', teste: faltaConferir },
];
const semFoto = { id: 'sem-foto', nome: '📷 Sem foto', teste: (p) => !estado.fotos.has(p.id) };
// Sem contar estoque, a lista não tem filtros de quantidade.
const filtros = () => (controlaEstoque() ? [...FILTROS_ESTOQUE, semFoto] : [FILTROS_ESTOQUE[0], semFoto]);

// Liga/desliga tudo o que é de quantidade na tela (o que já foi guardado não se perde).
function aplicarModoEstoque() {
  const ligado = controlaEstoque();
  document.body.classList.toggle('sem-estoque', !ligado);
  $('#menu-controlar-estoque').textContent = `📊 Controlar estoque: ${ligado ? 'ligado' : 'desligado'}`;
  if (!ligado && estado.filtro !== 'arquivados') estado.filtro = 'todos';
}

// ---------- Lista ----------

async function carregar() {
  const [produtos, vendas] = await Promise.all([db.listarProdutos(), db.listarVendas()]);
  estado.produtos = produtos;
  // Último preço vendido de cada produto (para mostrar na lista quando não há preço no cadastro).
  estado.ultimoPreco = new Map();
  for (const v of vendas.filter((x) => !x.cancelada).sort((a, b) => a.dataHora.localeCompare(b.dataHora))) {
    for (const i of v.itens) estado.ultimoPreco.set(i.produtoId, i.precoUnit);
  }
  estado.produtos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || (a.marca || '').localeCompare(b.marca || '', 'pt-BR'));
  await carregarFotos();
  atualizarCategorias();
  render();
}

// Códigos dos produtos que têm foto do catálogo da loja (pasta fotos/).
let fotosCatalogo = null;
async function carregarIndiceFotos() {
  if (fotosCatalogo) return fotosCatalogo;
  try {
    const resp = await fetch('fotos/indice.json');
    fotosCatalogo = new Set(resp.ok ? await resp.json() : []);
  } catch {
    fotosCatalogo = new Set();
  }
  return fotosCatalogo;
}

// Foto própria (tirada pelo Felipão) tem prioridade; senão usa a foto do catálogo.
async function carregarFotos() {
  const catalogo = await carregarIndiceFotos();
  for (const p of estado.produtos) {
    if (estado.fotos.has(p.id)) continue;
    if (p.temFoto) {
      const blob = await db.buscarFoto(p.id);
      if (blob) { estado.fotos.set(p.id, URL.createObjectURL(blob)); continue; }
    }
    if (!p.semFotoCatalogo && catalogo.has(p.codigo)) estado.fotos.set(p.id, `fotos/${encodeURIComponent(p.codigo)}.jpg`);
  }
}

function atualizarCategorias() {
  const ativos = estado.produtos.filter((p) => !p.arquivado);
  const cats = [...new Set(ativos.map((p) => categoriaPrincipal(p.categoria)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const sel = $('#filtro-categoria');
  const atual = estado.categoria;
  sel.innerHTML = '<option value="">Todas as categorias</option>' +
    cats.map((c) => `<option ${c === atual ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('#lista-categorias').innerHTML = [...new Set(estado.produtos.map((p) => p.categoria).filter(Boolean))]
    .map((c) => `<option value="${esc(c)}">`).join('');
  $('#lista-marcas').innerHTML = [...new Set(estado.produtos.map((p) => p.marca).filter(Boolean))]
    .sort().map((m) => `<option value="${esc(m)}">`).join('');
}

function visiveis() {
  const termos = semAcento(estado.busca).split(/\s+/).filter(Boolean);
  const verArquivados = estado.filtro === 'arquivados';
  return estado.produtos.filter((p) => {
    if (!!p.arquivado !== verArquivados) return false;
    if (estado.categoria && categoriaPrincipal(p.categoria) !== estado.categoria) return false;
    if (!verArquivados && !(filtros().find((f) => f.id === estado.filtro) || filtros()[0]).teste(p)) return false;
    if (!termos.length) return true;
    const texto = semAcento([p.nome, p.marca, p.variacao, p.tamanho, p.categoria, p.codigo].join(' '));
    return termos.every((t) => texto.includes(t));
  });
}

function renderChips() {
  const ativos = estado.produtos.filter((p) => !p.arquivado);
  const chips = filtros().length < 2 ? [] : filtros().map((f) => {
    const n = ativos.filter(f.teste).length;
    return `<button class="chip" data-filtro="${f.id}" aria-pressed="${estado.filtro === f.id}">${f.nome} (${n})</button>`;
  });
  if (estado.filtro === 'arquivados') {
    chips.push('<button class="chip" data-filtro="arquivados" aria-pressed="true">Arquivados</button>');
  }
  $('#chips').innerHTML = chips.join('');
}

function miniatura(p) {
  const url = estado.fotos.get(p.id);
  return url
    ? `<div class="miniatura com-foto" style="background-image:url('${url}')"></div>`
    : `<div class="miniatura">${iniciais(p)}</div>`;
}

function seloQuantidade(p) {
  const s = situacao(p);
  if (s === 'conferir') return '<div class="qtd so-estoque conferir">a<br>conferir</div>';
  return `<div class="qtd so-estoque ${s === 'ok' ? '' : s}">${p.quantidade}<small>${s === 'zero' ? 'zerado' : 'un.'}</small></div>`;
}

function render() {
  renderChips();
  const todos = estado.produtos.filter((p) => !p.arquivado);
  $('#vazio').hidden = estado.produtos.length > 0;
  const lista = visiveis();
  $('#contagem').textContent = estado.produtos.length
    ? `${lista.length} de ${estado.filtro === 'arquivados' ? estado.produtos.length - todos.length : todos.length} produtos`
    : '';
  $('#btn-copiar-lista').hidden = estado.filtro !== 'sem-foto' || !lista.length;
  $('#lista').innerHTML = lista.map((p) => `
    <li><button class="item" data-id="${p.id}">
      ${miniatura(p)}
      <div class="item-info">
        <div class="item-nome">${esc(p.nome)}</div>
        <div class="item-sub">${esc([p.marca, p.variacao, p.tamanho].filter(Boolean).join(' · ')
          || (p.cadastroNaVenda ? 'Cadastrado na venda: complete quando puder' : ''))}</div>
        ${p.preco != null ? `<div class="item-preco">${moeda(p.preco)}</div>`
    : estado.ultimoPreco?.has(p.id) ? `<div class="item-preco">${moeda(estado.ultimoPreco.get(p.id) / 100)} <small>última venda</small></div>` : ''}
      </div>
      ${seloQuantidade(p)}
    </button></li>`).join('');
  renderAvisoBackup();
}

function renderAvisoBackup() {
  const el = $('#aviso-backup');
  if (!estado.produtos.length) { el.hidden = true; return; }
  const ultimo = lerPreferencia('ultimoBackup');
  const dias = ultimo ? (Date.now() - new Date(ultimo).getTime()) / 86400000 : Infinity;
  if (dias < DIAS_AVISO_BACKUP) { el.hidden = true; return; }
  el.innerHTML = `<strong>Faça um backup.</strong> Os dados ficam só neste celular. ${ultimo ? `Último backup: ${dataHora(ultimo)}.` : 'Você ainda não fez nenhum backup.'}
    <br><button class="btn" id="btn-backup-aviso">⬇️ Baixar planilha agora</button>`;
  el.hidden = false;
  $('#btn-backup-aviso').onclick = exportarProdutos;
}

// ---------- Detalhe do produto ----------

let produtoAberto = null;

async function abrirProduto(id) {
  const p = await db.buscarProduto(id);
  if (!p) return;
  produtoAberto = p;
  const movimentos = await db.listarMovimentos(id);
  const s = situacao(p);
  const lucro = p.preco != null && p.custo != null ? p.preco - p.custo : null;
  const margem = lucro != null && p.preco ? Math.round((lucro / p.preco) * 100) : null;
  const url = estado.fotos.get(p.id);
  const rotuloEstoque = { conferir: 'Quantidade ainda não conferida', zero: 'Sem estoque', baixo: `Acabando (aviso com ${minimo(p)} ou menos)`, ok: 'em estoque' }[s];

  $('#produto-conteudo').innerHTML = `
    <div class="detalhe-foto ${url ? 'com-foto' : 'sem-foto'}" ${url ? `style="background-image:url('${url}')"` : ''}>${url ? '' : iniciais(p)}</div>
    <h2 class="detalhe-nome">${esc(p.nome)}</h2>
    <p class="detalhe-sub">${esc([p.marca, p.variacao, p.tamanho].filter(Boolean).join(' · '))}
      ${p.categoria ? `<br><span class="etiqueta">${esc(p.categoria)}</span>` : ''}
      ${p.arquivado ? ' <span class="etiqueta">Arquivado</span>' : ''}</p>
    <div class="precos">
      <div><small>Preço</small><strong>${moeda(p.preco)}</strong></div>
      <div><small>Custo</small><strong>${moeda(p.custo)}</strong></div>
      <div><small>Lucro</small><strong>${lucro == null ? '—' : moeda(lucro)}</strong>${margem == null ? '' : `<small>${margem}%</small>`}</div>
    </div>
    <div class="estoque-caixa so-estoque ${s}">
      <div class="numero">${p.quantidade ?? '?'}</div>
      <div class="rotulo">${rotuloEstoque}</div>
      <div class="estoque-botoes">
        <button class="btn btn-primario" data-mov="entrada">＋ Entrada</button>
        <button class="btn" data-mov="saida" ${p.quantidade ? '' : 'disabled'}>− Saída</button>
      </div>
    </div>
    <div class="acoes-produto">
      <button class="btn" data-acao="editar">✏️ Editar</button>
      ${p.arquivado ? '' : '<button class="btn btn-primario" data-acao="vender">🛒 Vender</button>'}
      <button class="btn" data-acao="pedir">📝 Pôr em Para pedir</button>
      <button class="btn" data-acao="duplicar">➕ Outro sabor</button>
      <button class="btn" data-acao="${p.arquivado ? 'restaurar' : 'arquivar'}">${p.arquivado ? '♻️ Restaurar' : '🗂️ Arquivar'}</button>
    </div>
    ${p.descricao ? `<p class="descricao">${esc(p.descricao)}</p>` : ''}
    <div class="so-estoque"><h3>Histórico de estoque</h3>
    ${movimentos.length ? `<ul class="historico">${movimentos.slice(0, 30).map((m) => `
      <li><div>${nomeTipo(m.tipo)}${m.motivo ? ` — ${esc(m.motivo)}` : ''}<small>${dataHora(m.dataHora)} · ficou com ${m.quantidadeDepois ?? '—'}</small></div>
      <span class="dif ${m.diferenca > 0 ? 'mais' : m.diferenca < 0 ? 'menos' : ''}">${m.diferenca > 0 ? '+' : ''}${m.diferenca}</span></li>`).join('')}</ul>`
    : '<p class="descricao">Nenhuma movimentação ainda.</p>'}</div>
  `;
  const dlg = $('#dlg-produto');
  if (!dlg.open) dlg.showModal();
}

$('#produto-conteudo').addEventListener('click', async (e) => {
  const mov = e.target.closest('[data-mov]');
  if (mov) return abrirMovimento(produtoAberto, mov.dataset.mov);
  const acao = e.target.closest('[data-acao]')?.dataset.acao;
  if (!acao) return;
  const p = produtoAberto;
  if (acao === 'editar') abrirFormulario(p);
  if (acao === 'pedir') document.dispatchEvent(new CustomEvent('pedir-produto', { detail: p }));
  if (acao === 'vender') {
    $('#dlg-produto').close();
    document.dispatchEvent(new CustomEvent('vender-produto', { detail: p.id }));
  }
  if (acao === 'duplicar') {
    abrirFormulario({ ...p, id: null, codigo: '', variacao: '', quantidade: null, temFoto: false, arquivado: false, criadoEm: null }, p.id);
  }
  if (acao === 'arquivar') {
    const ok = await confirmar('Arquivar produto?', `"${p.nome}" sai da lista, mas nada é apagado. Você pode restaurar depois em Menu → Ver produtos arquivados.`, 'Arquivar');
    if (!ok) return;
    await db.salvarProduto({ ...p, arquivado: true });
    $('#dlg-produto').close();
    avisar('Produto arquivado');
    await carregar();
  }
  if (acao === 'restaurar') {
    await db.salvarProduto({ ...p, arquivado: false });
    $('#dlg-produto').close();
    avisar('Produto restaurado');
    await carregar();
  }
});

// ---------- Entrada / saída ----------

const MOTIVOS = {
  entrada: ['Compra', 'Devolução', 'Correção'],
  saida: ['Venda', 'Perda / vencido', 'Brinde', 'Uso próprio', 'Correção'],
};
let movAtual = null;

function abrirMovimento(p, tipo) {
  movAtual = { p, tipo };
  $('#mov-titulo').textContent = tipo === 'entrada' ? 'Entrada no estoque' : 'Saída do estoque';
  $('#mov-produto').textContent = [p.nome, p.marca, p.variacao].filter(Boolean).join(' · ');
  $('#mov-qtd').value = 1;
  $('#mov-motivo').value = '';
  $('#mov-motivos').innerHTML = MOTIVOS[tipo]
    .map((m, i) => `<button type="button" class="chip" aria-pressed="${i === 0}">${m}</button>`).join('');
  atualizarResultadoMov();
  $('#dlg-mov').showModal();
}

function qtdMov() { return lerInteiro($('#mov-qtd').value) || 0; }

function atualizarResultadoMov() {
  const { p, tipo } = movAtual;
  const atual = p.quantidade ?? 0;
  let q = qtdMov();
  if (tipo === 'saida' && q > atual) { q = atual; $('#mov-qtd').value = q; }
  const fica = tipo === 'entrada' ? atual + q : atual - q;
  $('#mov-resultado').textContent = `Tem ${atual} → vai ficar com ${fica}`;
  $('#mov-confirmar').disabled = q <= 0;
}

$('#dlg-mov').addEventListener('click', (e) => {
  const passo = e.target.closest('[data-passo]');
  if (passo) {
    $('#mov-qtd').value = Math.max(1, qtdMov() + Number(passo.dataset.passo));
    atualizarResultadoMov();
  }
  const chip = e.target.closest('.chip');
  if (chip) {
    $('#mov-motivos').querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === chip));
  }
});
$('#mov-qtd').addEventListener('input', atualizarResultadoMov);

$('#form-mov').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { p, tipo } = movAtual;
  const q = qtdMov();
  if (q <= 0) return;
  const chip = $('#mov-motivos .chip[aria-pressed="true"]')?.textContent || '';
  const extra = $('#mov-motivo').value.trim();
  const motivo = [chip, extra].filter(Boolean).join(' — ');
  await db.movimentarEstoque(p.id, tipo === 'entrada' ? q : -q, tipo, motivo);
  $('#dlg-mov').close();
  avisar(tipo === 'entrada' ? `Entrada de ${q} registrada` : `Saída de ${q} registrada`);
  await carregar();
  await abrirProduto(p.id);
});

// ---------- Cadastro / edição ----------

let formAtual = null; // { produto, fotoNova: Blob|null|undefined, fotoDe }

function abrirFormulario(p = null, copiarFotoDe = null) {
  const form = $('#form-produto');
  form.reset();
  formAtual = { produto: p, fotoNova: undefined, fotoDe: copiarFotoDe };
  $('#form-titulo').textContent = p?.id ? 'Editar produto' : (copiarFotoDe ? 'Novo sabor / variação' : 'Novo produto');
  if (p) {
    for (const campo of ['nome', 'marca', 'variacao', 'categoria', 'tamanho', 'descricao']) form[campo].value = p[campo] || '';
    form.custo.value = p.custo == null ? '' : String(p.custo).replace('.', ',');
    form.preco.value = p.preco == null ? '' : String(p.preco).replace('.', ',');
    form.quantidade.value = p.quantidade ?? '';
    form.estoqueMinimo.value = p.estoqueMinimo ?? '';
  }
  const urlFoto = p?.id ? estado.fotos.get(p.id) : (copiarFotoDe ? estado.fotos.get(copiarFotoDe) : null);
  mostrarFotoForm(urlFoto);
  atualizarLucroForm();
  $('#dlg-form').showModal();
  if (copiarFotoDe) form.variacao.focus();
}

function mostrarFotoForm(url) {
  const el = $('#form-foto');
  el.style.backgroundImage = url ? `url('${url}')` : '';
  el.textContent = url ? '' : 'Sem foto';
  $('#btn-remover-foto').hidden = !url;
}

function atualizarLucroForm() {
  const form = $('#form-produto');
  const custo = lerNumero(form.custo.value);
  const preco = lerNumero(form.preco.value);
  const el = $('#form-lucro');
  if (custo == null || preco == null) { el.textContent = ''; return; }
  const lucro = preco - custo;
  el.textContent = `Lucro por unidade: ${moeda(lucro)}${preco ? ` (${Math.round((lucro / preco) * 100)}%)` : ''}`;
  el.classList.toggle('negativo', lucro < 0);
}
$('#form-produto').custo.addEventListener('input', atualizarLucroForm);
$('#form-produto').preco.addEventListener('input', atualizarLucroForm);

// Diminui a foto para no máximo 900 px (economiza espaço no celular).
async function reduzirFoto(arquivo) {
  const img = await createImageBitmap(arquivo).catch(() => null);
  if (!img) return arquivo;
  const escala = Math.min(1, 900 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * escala);
  canvas.height = Math.round(img.height * escala);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || arquivo), 'image/jpeg', 0.82));
}

$('#input-foto').addEventListener('change', async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  formAtual.fotoNova = await reduzirFoto(arquivo);
  mostrarFotoForm(URL.createObjectURL(formAtual.fotoNova));
});

$('#btn-remover-foto').addEventListener('click', async () => {
  const ok = await confirmar('Remover foto?', 'A foto deste produto será apagada.', 'Remover');
  if (!ok) return;
  formAtual.fotoNova = null;
  mostrarFotoForm(null);
});

$('#form-produto').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const nome = form.nome.value.trim();
  if (!nome) { form.nome.focus(); avisar('Preencha o nome do produto'); return; }
  const base = formAtual.produto || {};
  const novo = !base.id;
  const produto = {
    ...base,
    id: base.id || db.novoId(),
    codigo: base.codigo || `p-${Date.now().toString(36)}`,
    nome,
    marca: form.marca.value.trim(),
    variacao: form.variacao.value.trim(),
    categoria: form.categoria.value.trim(),
    tamanho: form.tamanho.value.trim(),
    descricao: form.descricao.value.trim(),
    custo: lerNumero(form.custo.value),
    preco: lerNumero(form.preco.value),
    quantidade: lerInteiro(form.quantidade.value),
    estoqueMinimo: lerInteiro(form.estoqueMinimo.value),
    arquivado: !!base.arquivado,
  };

  let foto = formAtual.fotoNova;
  if (foto === undefined && novo && formAtual.fotoDe) {
    foto = await db.buscarFoto(formAtual.fotoDe);
    const url = estado.fotos.get(formAtual.fotoDe);
    if (!foto && url) foto = await fetch(url).then((r) => (r.ok ? r.blob() : undefined)).catch(() => undefined);
  }
  if (foto) {
    await db.salvarFoto(produto.id, foto);
    produto.temFoto = true;
    estado.fotos.delete(produto.id);
  } else if (foto === null) {
    await db.apagarFoto(produto.id);
    produto.temFoto = false;
    produto.semFotoCatalogo = true;
    estado.fotos.delete(produto.id);
  }

  await db.salvarProduto(produto, { tipo: 'correcao', motivo: novo ? 'Produto novo' : 'Editado no cadastro' });
  $('#dlg-form').close();
  avisar(novo ? 'Produto cadastrado' : 'Alterações salvas');
  await carregar();
  if ($('#dlg-produto').open || novo) await abrirProduto(produto.id);
});

// ---------- Importação ----------

const chaveProduto = (p) => semAcento([p.nome, p.marca, p.variacao, p.tamanho].join('|')).replace(/\s+/g, ' ');
let importacaoPendente = null;

async function prepararImportacao(texto, origem) {
  const { itens, erros } = linhasParaProdutos(lerCsv(texto));
  const existentes = await db.listarProdutos();
  const porCodigo = new Map(existentes.filter((p) => p.codigo).map((p) => [p.codigo, p]));
  const porChave = new Map(existentes.map((p) => [chaveProduto(p), p]));

  const novos = [];
  const atualizados = [];
  let iguais = 0;
  for (const item of itens) {
    const anterior = (item.codigo && porCodigo.get(item.codigo)) || porChave.get(chaveProduto(item));
    if (!anterior) {
      const { quantidadePelaSituacao, ...dados } = item;
      novos.push({ produto: { ...dados, id: db.novoId(), codigo: item.codigo || `p-${db.novoId().slice(0, 8)}`, arquivado: false }, anterior: null });
      continue;
    }
    // Só atualiza o que veio preenchido na planilha; campo vazio não apaga nada.
    const produto = { ...anterior };
    const mudou = [];
    for (const [campo, valor] of Object.entries(item)) {
      if (valor === '' || valor == null || campo === 'quantidadePelaSituacao') continue;
      if (campo === 'quantidade' && item.quantidadePelaSituacao) continue;
      if (produto[campo] !== valor) { produto[campo] = valor; mudou.push(campo); }
    }
    if (mudou.length) atualizados.push({ produto, anterior, mudou });
    else iguais++;
  }
  importacaoPendente = { itens: [...novos, ...atualizados], origem };

  const nomesCampo = { nome: 'nome', marca: 'marca', categoria: 'categoria', variacao: 'sabor', tamanho: 'tamanho', descricao: 'descrição', custo: 'custo', preco: 'preço', quantidade: 'quantidade', estoqueMinimo: 'aviso', codigo: 'código' };
  $('#importar-conteudo').innerHTML = `
    <p>Arquivo: <strong>${esc(origem)}</strong></p>
    <div class="resumo-importacao">
      <div><strong>${novos.length}</strong><small>novos</small></div>
      <div><strong>${atualizados.length}</strong><small>atualizados</small></div>
      <div><strong>${iguais}</strong><small>sem mudança</small></div>
    </div>
    <p class="descricao">Nada será apagado. Campos vazios na planilha não mudam o que já está cadastrado.</p>
    ${erros.length ? `<div class="erros">${erros.map(esc).join('<br>')}</div>` : ''}
    ${atualizados.length ? `<h3>Vão mudar</h3><ul class="previa">${atualizados.slice(0, 50).map((a) => `<li>${esc(a.produto.nome)} <small>(${a.mudou.map((c) => nomesCampo[c] || c).join(', ')})</small></li>`).join('')}</ul>` : ''}
    ${novos.length ? `<h3>Novos</h3><ul class="previa">${novos.slice(0, 200).map((n) => `<li>${esc(n.produto.nome)} <small>${esc([n.produto.marca, n.produto.variacao || n.produto.tamanho].filter(Boolean).join(' · '))}</small></li>`).join('')}${novos.length > 200 ? `<li>… e mais ${novos.length - 200}</li>` : ''}</ul>` : ''}
  `;
  $('#importar-confirmar').disabled = importacaoPendente.itens.length === 0;
  $('#importar-confirmar').textContent = importacaoPendente.itens.length ? `Importar ${importacaoPendente.itens.length} produtos` : 'Nada para importar';
  $('#dlg-menu').close();
  $('#dlg-importar').showModal();
}

$('#importar-confirmar').addEventListener('click', async () => {
  if (!importacaoPendente?.itens.length) return;
  const n = importacaoPendente.itens.length;
  await db.salvarVarios(importacaoPendente.itens.map(({ produto, anterior }) => ({ produto, anterior })), `Importado de ${importacaoPendente.origem}`);
  importacaoPendente = null;
  $('#dlg-importar').close();
  avisar(`${n} produtos importados`);
  await carregar();
});

async function carregarCatalogo() {
  try {
    const resp = await fetch('dados/catalogo-felipao.csv', { cache: 'no-cache' });
    if (!resp.ok) throw new Error(resp.status);
    await prepararImportacao(await resp.text(), 'catálogo da loja');
  } catch {
    avisar('Não consegui abrir o catálogo. Verifique a internet.');
  }
}

$('#input-planilha').addEventListener('change', async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  if (/\.xlsx?$/i.test(arquivo.name)) {
    avisar('No Excel, use "Salvar como" → CSV e importe esse arquivo.');
    return;
  }
  await prepararImportacao(await arquivo.text(), arquivo.name);
});

// ---------- Exportação / backup ----------

const hojeArquivo = () => new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');

async function exportarProdutos() {
  const produtos = await db.listarProdutos();
  produtos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  baixarArquivo(`felipao-produtos-${hojeArquivo()}.csv`, csvProdutos(produtos));
  gravarPreferencia('ultimoBackup', new Date().toISOString());
  $('#dlg-menu').close();
  render();
  avisar('Planilha de produtos baixada');
}

$('#menu-exportar').addEventListener('click', exportarProdutos);
$('#menu-historico').addEventListener('click', async () => {
  baixarArquivo(`felipao-historico-estoque-${hojeArquivo()}.csv`, csvMovimentos(await db.listarMovimentos()));
  $('#dlg-menu').close();
  avisar('Histórico baixado');
});
$('#menu-catalogo').addEventListener('click', carregarCatalogo);
$('#btn-catalogo-vazio').addEventListener('click', carregarCatalogo);
$('#menu-arquivados').addEventListener('click', () => {
  estado.filtro = 'arquivados';
  $('#dlg-menu').close();
  mostrarTela('estoque');
  render();
});

// ---------- Eventos gerais ----------

$('#lista').addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (item) abrirProduto(item.dataset.id);
});
$('#chips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filtro]');
  if (!chip) return;
  estado.filtro = chip.dataset.filtro === estado.filtro && chip.dataset.filtro === 'arquivados' ? 'todos' : chip.dataset.filtro;
  render();
});
// Copia os nomes da lista que está na tela (ex.: produtos sem foto) para colar no WhatsApp ou na conversa.
$('#btn-copiar-lista').addEventListener('click', async () => {
  const texto = visiveis().map((p) => [p.nome, p.marca, p.variacao, p.tamanho].filter(Boolean).join(' · ')).join('\n');
  try {
    await navigator.clipboard.writeText(texto);
    const n = visiveis().length;
    avisar(`Lista com ${n} produto${n > 1 ? 's' : ''} copiada`);
  } catch {
    avisar('Não deu para copiar neste aparelho');
  }
});
$('#filtro-categoria').addEventListener('change', (e) => { estado.categoria = e.target.value; render(); });
$('#busca').addEventListener('input', (e) => { estado.busca = e.target.value; render(); });
$('#btn-novo').addEventListener('click', () => abrirFormulario());
// Barra de baixo: troca entre as telas.
function mostrarTela(tela) {
  document.querySelectorAll('.tela').forEach((el) => { el.hidden = el.id !== `tela-${tela}`; });
  document.querySelectorAll('.aba').forEach((b) => {
    if (b.dataset.tela === tela) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  gravarPreferencia('tela', tela);
  window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent('tela-aberta', { detail: tela }));
}
document.querySelector('.abas').addEventListener('click', (e) => {
  const aba = e.target.closest('[data-tela]');
  if (aba) mostrarTela(aba.dataset.tela);
});
document.addEventListener('mostrar-tela', (e) => mostrarTela(e.detail));
// O sistema sempre abre no Painel.
mostrarTela('inicio');
// Venda feita ou cancelada muda o estoque: recarrega a lista.
document.addEventListener('dados-mudaram', () => {
  // Pode ter chegado foto nova da nuvem: refaz o cache das fotos.
  const antigas = [...estado.fotos.values()].filter((url) => url.startsWith('blob:'));
  setTimeout(() => antigas.forEach((url) => URL.revokeObjectURL(url)), 10000); // depois que a tela já trocou
  estado.fotos.clear();
  carregar();
});
document.addEventListener('tela-aberta', (e) => { if (e.detail === 'estoque') carregar(); });

document.querySelectorAll('.btn-abrir-menu').forEach((b) => b.addEventListener('click', () => {
  const ultimo = lerPreferencia('ultimoBackup');
  $('#menu-info').textContent = `${estado.produtos.length} produtos cadastrados. ${ultimo ? `Último backup: ${dataHora(ultimo)}.` : 'Nenhum backup feito ainda.'} ${document.body.classList.contains('com-nuvem') ? 'Os dados estão guardados na nuvem.' : 'Os dados ficam guardados neste aparelho.'}`;
  $('#dlg-menu').showModal();
}));
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-fechar]')) e.target.closest('dialog').close();
});
// Tocar fora da janela fecha (menos no formulário, para não perder o que foi digitado).
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg || dlg.id === 'dlg-form' || dlg.id === 'dlg-confirmar') return;
    const r = dlg.getBoundingClientRect();
    const fora = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (fora) dlg.close();
  });
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}
$('#menu-controlar-estoque').addEventListener('click', async () => {
  const ligar = !controlaEstoque();
  const ok = await confirmar(
    ligar ? 'Ligar o controle de estoque?' : 'Desligar o controle de estoque?',
    ligar ? 'As quantidades voltam a aparecer e cada venda passa a descontar do estoque. Confira as quantidades dos produtos.'
      : 'As quantidades somem da tela e as vendas não mexem mais no estoque. O que já está guardado não se perde: dá para ligar de novo quando quiser.',
    ligar ? 'Ligar' : 'Desligar', false,
  );
  if (!ok) return;
  gravarPreferencia('controlarEstoque', ligar ? 'sim' : 'nao');
  aplicarModoEstoque();
  render();
  $('#dlg-menu').close();
  avisar(ligar ? 'Controle de estoque ligado' : 'Controle de estoque desligado');
});

// Produto novo que chegou (lista Para pedir): abre o cadastro com o nome e a marca preenchidos.
document.addEventListener('cadastrar-produto', (e) => abrirFormulario({ nome: e.detail.nome, marca: e.detail.marca || '' }));

// Rolou a lista: o botão ＋ vira só o círculo, para não cobrir os itens.
addEventListener('scroll', () => document.body.classList.toggle('rolou', scrollY > 60), { passive: true });

aplicarModoEstoque();
db.pedirArmazenamentoPersistente();
carregar();
