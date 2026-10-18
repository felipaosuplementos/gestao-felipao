// Banco de dados local (IndexedDB). Tudo fica guardado no próprio aparelho.
// Lojas:
//   produtos    — um registro por item de estoque (cada sabor/tamanho é um item)
//   movimentos  — histórico de toda entrada, saída e correção de estoque
//   fotos       — fotos dos produtos (separadas para a lista carregar rápido)
//   clientes    — clientes (nome, WhatsApp, observação)
//   lancamentos — fiado e pagamentos de cada cliente (nunca apagados; só cancelados)

const NOME_BANCO = 'gestao-felipao';
const VERSAO = 2;

let bancoPromessa = null;

function abrir() {
  if (bancoPromessa) return bancoPromessa;
  bancoPromessa = new Promise((resolve, reject) => {
    const req = indexedDB.open(NOME_BANCO, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('produtos')) {
        const produtos = db.createObjectStore('produtos', { keyPath: 'id' });
        produtos.createIndex('codigo', 'codigo', { unique: false });
      }
      if (!db.objectStoreNames.contains('movimentos')) {
        const mov = db.createObjectStore('movimentos', { keyPath: 'id' });
        mov.createIndex('produtoId', 'produtoId', { unique: false });
      }
      if (!db.objectStoreNames.contains('fotos')) {
        db.createObjectStore('fotos');
      }
      if (!db.objectStoreNames.contains('clientes')) {
        db.createObjectStore('clientes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('lancamentos')) {
        const lanc = db.createObjectStore('lancamentos', { keyPath: 'id' });
        lanc.createIndex('clienteId', 'clienteId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return bancoPromessa;
}

function concluir(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function pedido(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function novoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function agora() {
  return new Date().toISOString();
}

export async function listarProdutos() {
  const db = await abrir();
  return pedido(db.transaction('produtos').objectStore('produtos').getAll());
}

export async function buscarProduto(id) {
  const db = await abrir();
  return pedido(db.transaction('produtos').objectStore('produtos').get(id));
}

export async function listarMovimentos(produtoId) {
  const db = await abrir();
  const loja = db.transaction('movimentos').objectStore('movimentos');
  const lista = produtoId
    ? await pedido(loja.index('produtoId').getAll(produtoId))
    : await pedido(loja.getAll());
  return lista.sort((a, b) => b.dataHora.localeCompare(a.dataHora));
}

function montarMovimento(produto, quantidadeNova, tipo, motivo, dataHora) {
  const antes = produto.quantidade;
  return {
    id: novoId(),
    produtoId: produto.id,
    produtoNome: produto.nome,
    tipo, // 'entrada' | 'saida' | 'correcao' | 'importacao' | 'cadastro'
    motivo: motivo || '',
    quantidadeAntes: antes,
    quantidadeDepois: quantidadeNova,
    diferenca: (quantidadeNova ?? 0) - (antes ?? 0),
    dataHora,
  };
}

// Salva um produto. Se a quantidade mudou, registra o movimento no histórico
// na mesma operação (ou grava os dois, ou nenhum).
export async function salvarProduto(produto, { tipo = 'correcao', motivo = '' } = {}) {
  const db = await abrir();
  const tx = db.transaction(['produtos', 'movimentos'], 'readwrite');
  const produtos = tx.objectStore('produtos');
  const anterior = await pedido(produtos.get(produto.id));
  const dataHora = agora();
  const salvar = { ...produto, atualizadoEm: dataHora };
  if (!anterior) salvar.criadoEm = salvar.criadoEm || dataHora;

  const qtdAntes = anterior ? anterior.quantidade : null;
  if (qtdAntes !== salvar.quantidade && !(qtdAntes == null && salvar.quantidade == null)) {
    const base = anterior || { ...salvar, quantidade: null };
    const mov = montarMovimento(base, salvar.quantidade, anterior ? tipo : 'cadastro', motivo, dataHora);
    mov.produtoNome = salvar.nome;
    tx.objectStore('movimentos').put(mov);
  }
  produtos.put(salvar);
  await concluir(tx);
  return salvar;
}

// Entrada (+) ou saída (−) de estoque.
export async function movimentarEstoque(produtoId, diferenca, tipo, motivo) {
  const db = await abrir();
  const tx = db.transaction(['produtos', 'movimentos'], 'readwrite');
  const produtos = tx.objectStore('produtos');
  const produto = await pedido(produtos.get(produtoId));
  if (!produto) throw new Error('Produto não encontrado');
  const dataHora = agora();
  const nova = Math.max(0, (produto.quantidade ?? 0) + diferenca);
  tx.objectStore('movimentos').put(montarMovimento(produto, nova, tipo, motivo, dataHora));
  const salvo = { ...produto, quantidade: nova, atualizadoEm: dataHora };
  produtos.put(salvo);
  await concluir(tx);
  return salvo;
}

// Grava vários produtos de uma vez (importação). Tudo ou nada.
export async function salvarVarios(itens, motivo) {
  const db = await abrir();
  const tx = db.transaction(['produtos', 'movimentos'], 'readwrite');
  const produtos = tx.objectStore('produtos');
  const movimentos = tx.objectStore('movimentos');
  const dataHora = agora();
  for (const { produto, anterior } of itens) {
    const salvar = { ...produto, atualizadoEm: dataHora };
    if (!anterior) salvar.criadoEm = dataHora;
    const qtdAntes = anterior ? anterior.quantidade : null;
    if (salvar.quantidade != null && qtdAntes !== salvar.quantidade) {
      const base = anterior || { ...salvar, quantidade: null };
      movimentos.put(montarMovimento(base, salvar.quantidade, 'importacao', motivo, dataHora));
    }
    produtos.put(salvar);
  }
  await concluir(tx);
}

export async function salvarFoto(produtoId, blob) {
  const db = await abrir();
  const tx = db.transaction('fotos', 'readwrite');
  tx.objectStore('fotos').put(blob, produtoId);
  await concluir(tx);
}

export async function buscarFoto(produtoId) {
  const db = await abrir();
  return pedido(db.transaction('fotos').objectStore('fotos').get(produtoId));
}

export async function apagarFoto(produtoId) {
  const db = await abrir();
  const tx = db.transaction('fotos', 'readwrite');
  tx.objectStore('fotos').delete(produtoId);
  await concluir(tx);
}

// Pede ao navegador para não apagar os dados quando o celular ficar sem espaço.
export async function pedirArmazenamentoPersistente() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* sem suporte */ }
  return false;
}

// ---------- Clientes e fiado ----------

export async function listarClientes() {
  const db = await abrir();
  return pedido(db.transaction('clientes').objectStore('clientes').getAll());
}

export async function buscarCliente(id) {
  const db = await abrir();
  return pedido(db.transaction('clientes').objectStore('clientes').get(id));
}

export async function salvarCliente(cliente) {
  const db = await abrir();
  const tx = db.transaction('clientes', 'readwrite');
  const dataHora = agora();
  const salvar = { ...cliente, atualizadoEm: dataHora, criadoEm: cliente.criadoEm || dataHora };
  tx.objectStore('clientes').put(salvar);
  await concluir(tx);
  return salvar;
}

export async function listarLancamentos(clienteId) {
  const db = await abrir();
  const loja = db.transaction('lancamentos').objectStore('lancamentos');
  return clienteId ? pedido(loja.index('clienteId').getAll(clienteId)) : pedido(loja.getAll());
}

// Grava clientes novos e lançamentos de uma vez (tudo ou nada).
export async function gravarFiado({ clientes = [], lancamentos = [] }) {
  const db = await abrir();
  const tx = db.transaction(['clientes', 'lancamentos'], 'readwrite');
  const dataHora = agora();
  for (const c of clientes) {
    tx.objectStore('clientes').put({ ...c, criadoEm: c.criadoEm || dataHora, atualizadoEm: dataHora });
  }
  for (const l of lancamentos) {
    tx.objectStore('lancamentos').put({ ...l, id: l.id || novoId(), registradoEm: dataHora, cancelado: null });
  }
  await concluir(tx);
}

// Lançamento errado não é apagado: fica marcado como cancelado, com data e motivo.
export async function cancelarLancamento(id, motivo) {
  const db = await abrir();
  const tx = db.transaction('lancamentos', 'readwrite');
  const loja = tx.objectStore('lancamentos');
  const lanc = await pedido(loja.get(id));
  if (!lanc || lanc.cancelado) { tx.abort(); return; }
  loja.put({ ...lanc, cancelado: { em: agora(), motivo: motivo || '' } });
  await concluir(tx);
}
