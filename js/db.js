// Banco de dados local (IndexedDB). Tudo fica guardado no próprio aparelho.
// Lojas:
//   produtos    — um registro por item de estoque (cada sabor/tamanho é um item)
//   movimentos  — histórico de toda entrada, saída e correção de estoque
//   fotos       — fotos dos produtos (separadas para a lista carregar rápido)
//   clientes    — clientes (nome, WhatsApp, observação)
//   lancamentos — fiado e pagamentos de cada cliente (nunca apagados; só cancelados)
//   vendas      — cada venda com itens, forma de pagamento e lucro (nunca apagadas; só canceladas)
//   tarefas     — tarefas do dia a dia (texto, dia, hora, quando foi feita)
//   pedidos     — lista do que pedir aos fornecedores (acabou ou produto novo)
//   ajustes     — informações do sistema que valem para todos os aparelhos (ex.: data do último backup)

const NOME_BANCO = 'gestao-felipao';
const VERSAO = 6;

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
      if (!db.objectStoreNames.contains('vendas')) {
        const vendas = db.createObjectStore('vendas', { keyPath: 'id' });
        vendas.createIndex('dia', 'dia', { unique: false });
      }
      if (!db.objectStoreNames.contains('tarefas')) {
        db.createObjectStore('tarefas', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pedidos')) {
        db.createObjectStore('pedidos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('ajustes')) {
        db.createObjectStore('ajustes', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Outra aba abriu uma versão mais nova do sistema: esta recarrega para não travar aquela.
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return bancoPromessa;
}

// ---------- Aviso de mudanças (usado pela sincronização com a nuvem) ----------
// Toda gravação feita pelas funções abaixo é anotada; quando a operação termina,
// quem estiver ouvindo (a sincronização) recebe a lista do que mudou.

const ouvintes = new Set();
export function aoMudar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

// Abre uma transação de gravação que anota cada put/delete.
function escrever(db, lojas) {
  const tx = db.transaction(lojas, 'readwrite');
  const mudancas = [];
  const abrirLoja = tx.objectStore.bind(tx);
  tx.objectStore = (nome) => {
    const loja = abrirLoja(nome);
    return new Proxy(loja, {
      get(alvo, prop) {
        if (prop === 'put') return (valor, chave) => { mudancas.push({ loja: nome, valor, chave }); return alvo.put(valor, chave); };
        if (prop === 'delete') return (chave) => { mudancas.push({ loja: nome, chave, removido: true }); return alvo.delete(chave); };
        const v = alvo[prop];
        return typeof v === 'function' ? v.bind(alvo) : v;
      },
    });
  };
  tx.mudancas = mudancas;
  return tx;
}

function concluir(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      if (tx.mudancas?.length) for (const fn of ouvintes) { try { fn(tx.mudancas); } catch (e) { console.error(e); } }
      resolve();
    };
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
  const tx = escrever(db, ['produtos', 'movimentos']);
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
  const tx = escrever(db, ['produtos', 'movimentos']);
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
  const tx = escrever(db, ['produtos', 'movimentos']);
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
  const tx = escrever(db, 'fotos');
  tx.objectStore('fotos').put(blob, produtoId);
  await concluir(tx);
}

export async function buscarFoto(produtoId) {
  const db = await abrir();
  return pedido(db.transaction('fotos').objectStore('fotos').get(produtoId));
}

export async function apagarFoto(produtoId) {
  const db = await abrir();
  const tx = escrever(db, 'fotos');
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
  const tx = escrever(db, 'clientes');
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
  const tx = escrever(db, ['clientes', 'lancamentos']);
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
  const tx = escrever(db, 'lancamentos');
  const loja = tx.objectStore('lancamentos');
  const lanc = await pedido(loja.get(id));
  if (!lanc || lanc.cancelado) { tx.abort(); return; }
  loja.put({ ...lanc, cancelado: { em: agora(), motivo: motivo || '' } });
  await concluir(tx);
}

// Guarda a posição de cada valor na planilha de devedores (para a lista seguir a mesma ordem).
export async function atualizarOrdemPlanilha(itens) {
  const db = await abrir();
  const tx = escrever(db, 'lancamentos');
  const loja = tx.objectStore('lancamentos');
  for (const { id, ordemPlanilha } of itens) {
    const lanc = await pedido(loja.get(id));
    if (lanc) loja.put({ ...lanc, ordemPlanilha });
  }
  await concluir(tx);
}

// Apaga todos os clientes e lançamentos do fiado (o estoque não é mexido).
// Só é chamado depois de confirmação e de baixar o backup.
export async function limparFiado() {
  const db = await abrir();
  const tx = escrever(db, ['clientes', 'lancamentos']);
  // Apaga um por um (e não tudo de uma vez) para a nuvem saber exatamente o que saiu.
  for (const nome of ['clientes', 'lancamentos']) {
    const loja = tx.objectStore(nome);
    for (const chave of await pedido(loja.getAllKeys())) loja.delete(chave);
  }
  await concluir(tx);
}

// ---------- Vendas ----------

export async function listarVendas(diaDe, diaAte = diaDe) {
  const db = await abrir();
  const loja = db.transaction('vendas').objectStore('vendas');
  const lista = diaDe
    ? await pedido(loja.index('dia').getAll(IDBKeyRange.bound(diaDe, diaAte)))
    : await pedido(loja.getAll());
  return lista.sort((a, b) => b.dataHora.localeCompare(a.dataHora));
}

// Registra a venda, baixa o estoque e (no fiado) lança a dívida do cliente — tudo junto.
// `clienteNovo`: cliente criado na hora da venda. `lancamentos`: fiado (já com valores e vencimentos).
// baixarEstoque: false quando o controle de estoque está desligado (a venda não mexe nas quantidades).
export async function registrarVenda(venda, { clienteNovo = null, lancamentos = [], baixarEstoque = true } = {}) {
  const db = await abrir();
  const tx = escrever(db, ['vendas', 'produtos', 'movimentos', 'clientes', 'lancamentos']);
  const dataHora = agora();
  const vendas = tx.objectStore('vendas');
  const produtos = tx.objectStore('produtos');
  // Próximo número = maior número já usado + 1 (contar as vendas podia repetir número).
  const numero = Math.max(0, ...(await pedido(vendas.getAll())).map((v) => v.numero || 0)) + 1;
  const salvar = { ...venda, id: venda.id || novoId(), numero, dataHora, cancelada: null, ...(baixarEstoque ? {} : { semEstoque: true }) };

  for (const item of baixarEstoque ? salvar.itens : []) {
    const p = await pedido(produtos.get(item.produtoId));
    if (!p) continue;
    // Quantidade "a conferir" continua sem número; senão desconta (sem ficar negativo).
    const nova = p.quantidade == null ? null : Math.max(0, p.quantidade - item.quantidade);
    // Produto sem preço no cadastro: guarda o preço usado na venda.
    const preco = p.preco == null && item.salvarPreco ? item.precoUnit / 100 : p.preco;
    tx.objectStore('movimentos').put({
      id: novoId(), produtoId: p.id, produtoNome: p.nome, tipo: 'venda', motivo: `Venda nº ${numero}`,
      quantidadeAntes: p.quantidade, quantidadeDepois: nova, diferenca: -item.quantidade, dataHora, vendaId: salvar.id,
    });
    produtos.put({ ...p, quantidade: nova, preco, atualizadoEm: dataHora });
  }
  if (clienteNovo) tx.objectStore('clientes').put({ ...clienteNovo, criadoEm: dataHora, atualizadoEm: dataHora });
  salvar.lancamentoIds = [];
  for (const l of lancamentos) {
    const id = novoId();
    salvar.lancamentoIds.push(id);
    tx.objectStore('lancamentos').put({ ...l, id, vendaId: salvar.id, registradoEm: dataHora, cancelado: null });
  }
  vendas.put(salvar);
  await concluir(tx);
  return salvar;
}

// Edita uma venda já feita: mantém número, dia e hora; acerta o estoque pela diferença
// e troca o fiado (os lançamentos antigos ficam cancelados no histórico do cliente).
export async function editarVenda(id, nova, { clienteNovo = null, lancamentos = [], baixarEstoque = true } = {}) {
  const db = await abrir();
  const tx = escrever(db, ['vendas', 'produtos', 'movimentos', 'clientes', 'lancamentos']);
  const vendas = tx.objectStore('vendas');
  const antiga = await pedido(vendas.get(id));
  if (!antiga || antiga.cancelada) { tx.abort(); return null; }
  const dataHora = agora();
  const motivo = `Venda nº ${antiga.numero} editada`;

  // Estoque: devolve o que a versão antiga tirou e tira o da nova (só a diferença de cada produto).
  const diferenca = new Map();
  const somar = (produtoId, q) => diferenca.set(produtoId, (diferenca.get(produtoId) || 0) + q);
  if (!antiga.semEstoque) antiga.itens.forEach((i) => somar(i.produtoId, i.quantidade));
  if (baixarEstoque) nova.itens.forEach((i) => somar(i.produtoId, -i.quantidade));
  const produtos = tx.objectStore('produtos');
  for (const [produtoId, d] of diferenca) {
    if (!d) continue;
    const p = await pedido(produtos.get(produtoId));
    if (!p) continue;
    const q = p.quantidade == null ? null : Math.max(0, p.quantidade + d);
    tx.objectStore('movimentos').put({
      id: novoId(), produtoId: p.id, produtoNome: p.nome, tipo: d > 0 ? 'devolucao' : 'venda', motivo,
      quantidadeAntes: p.quantidade, quantidadeDepois: q, diferenca: d, dataHora, vendaId: id,
    });
    produtos.put({ ...p, quantidade: q, atualizadoEm: dataHora });
  }

  const lancs = tx.objectStore('lancamentos');
  for (const lid of antiga.lancamentoIds || []) {
    const l = await pedido(lancs.get(lid));
    if (l && !l.cancelado) lancs.put({ ...l, cancelado: { em: dataHora, motivo } });
  }
  if (clienteNovo) tx.objectStore('clientes').put({ ...clienteNovo, criadoEm: dataHora, atualizadoEm: dataHora });
  const lancamentoIds = [];
  for (const l of lancamentos) {
    const lid = novoId();
    lancamentoIds.push(lid);
    lancs.put({ ...l, id: lid, vendaId: id, registradoEm: dataHora, cancelado: null });
  }

  const salvar = {
    ...nova, id, numero: antiga.numero, dia: antiga.dia, dataHora: antiga.dataHora, cancelada: null, lancamentoIds,
    editadaEm: dataHora, edicoes: [...(antiga.edicoes || []), { em: dataHora, totalAntes: antiga.total }],
    ...(baixarEstoque ? {} : { semEstoque: true }),
  };
  vendas.put(salvar);
  await concluir(tx);
  return salvar;
}

// Duas vendas com o mesmo número (feitas ao mesmo tempo no PC e no celular, ou uma sem internet):
// a mais antiga fica com o número e as outras recebem números novos. Todos os aparelhos
// chegam ao mesmo resultado, então podem fazer a correção ao mesmo tempo sem bagunçar.
export async function corrigirNumerosVendas() {
  const db = await abrir();
  const todas = await pedido(db.transaction('vendas').objectStore('vendas').getAll());
  const porNumero = new Map();
  for (const v of todas) (porNumero.get(v.numero) || porNumero.set(v.numero, []).get(v.numero)).push(v);
  const repetidas = [...porNumero.values()].filter((g) => g.length > 1);
  if (!repetidas.length) return 0;
  let proximo = Math.max(...todas.map((v) => v.numero || 0));
  const trocar = [];
  for (const grupo of repetidas.sort((a, b) => a[0].numero - b[0].numero)) {
    grupo.sort((a, b) => a.dataHora.localeCompare(b.dataHora) || a.id.localeCompare(b.id));
    for (const v of grupo.slice(1)) trocar.push({ ...v, numero: ++proximo, numeroAntigo: v.numeroAntigo ?? v.numero });
  }
  const tx = escrever(db, 'vendas');
  trocar.forEach((v) => tx.objectStore('vendas').put(v));
  await concluir(tx);
  return trocar.length;
}

// Cancela a venda: devolve os produtos ao estoque e cancela o fiado dela. Nada é apagado.
export async function cancelarVenda(id, motivo) {
  const db = await abrir();
  const tx = escrever(db, ['vendas', 'produtos', 'movimentos', 'lancamentos']);
  const vendas = tx.objectStore('vendas');
  const venda = await pedido(vendas.get(id));
  if (!venda || venda.cancelada) { tx.abort(); return null; }
  const dataHora = agora();
  const produtos = tx.objectStore('produtos');
  // Venda feita sem controle de estoque não tirou nada: não tem o que devolver.
  for (const item of venda.semEstoque ? [] : venda.itens) {
    const p = await pedido(produtos.get(item.produtoId));
    if (!p) continue;
    const nova = p.quantidade == null ? null : p.quantidade + item.quantidade;
    tx.objectStore('movimentos').put({
      id: novoId(), produtoId: p.id, produtoNome: p.nome, tipo: 'devolucao', motivo: `Venda nº ${venda.numero} cancelada`,
      quantidadeAntes: p.quantidade, quantidadeDepois: nova, diferenca: item.quantidade, dataHora, vendaId: venda.id,
    });
    produtos.put({ ...p, quantidade: nova, atualizadoEm: dataHora });
  }
  const lancs = tx.objectStore('lancamentos');
  for (const lid of venda.lancamentoIds || []) {
    const l = await pedido(lancs.get(lid));
    if (l && !l.cancelado) lancs.put({ ...l, cancelado: { em: dataHora, motivo: `Venda nº ${venda.numero} cancelada` } });
  }
  const cancelada = { ...venda, cancelada: { em: dataHora, motivo: motivo || '' } };
  vendas.put(cancelada);
  await concluir(tx);
  return cancelada;
}

// ---------- Tarefas ----------

export async function listarTarefas() {
  const db = await abrir();
  return pedido(db.transaction('tarefas').objectStore('tarefas').getAll());
}

// Grava uma ou várias tarefas (registra quando foram criadas e alteradas).
export async function salvarTarefas(tarefas) {
  const db = await abrir();
  const tx = escrever(db, 'tarefas');
  const dataHora = agora();
  const salvas = tarefas.map((t) => ({ ...t, id: t.id || novoId(), criadaEm: t.criadaEm || dataHora, atualizadoEm: dataHora }));
  salvas.forEach((t) => tx.objectStore('tarefas').put(t));
  await concluir(tx);
  return salvas;
}

export async function apagarTarefa(id) {
  const db = await abrir();
  const tx = escrever(db, 'tarefas');
  tx.objectStore('tarefas').delete(id);
  await concluir(tx);
}

// ---------- Lista de pedidos ----------

export async function listarPedidos() {
  const db = await abrir();
  return pedido(db.transaction('pedidos').objectStore('pedidos').getAll());
}

export async function salvarPedidos(itens) {
  const db = await abrir();
  const tx = escrever(db, 'pedidos');
  const dataHora = agora();
  const salvos = itens.map((p) => ({ ...p, id: p.id || novoId(), criadoEm: p.criadoEm || dataHora, atualizadoEm: dataHora }));
  salvos.forEach((p) => tx.objectStore('pedidos').put(p));
  await concluir(tx);
  return salvos;
}

export async function apagarPedido(id) {
  const db = await abrir();
  const tx = escrever(db, 'pedidos');
  tx.objectStore('pedidos').delete(id);
  await concluir(tx);
}

// ---------- Ajustes (sincronizados entre os aparelhos) ----------

export async function lerAjuste(id) {
  const db = await abrir();
  return pedido(db.transaction('ajustes').objectStore('ajustes').get(id));
}

export async function salvarAjuste(ajuste) {
  const db = await abrir();
  const tx = escrever(db, 'ajustes');
  tx.objectStore('ajustes').put({ ...ajuste, atualizadoEm: agora() });
  await concluir(tx);
}

// ---------- Para a sincronização ----------

export const LOJAS = ['produtos', 'movimentos', 'fotos', 'clientes', 'lancamentos', 'vendas', 'tarefas', 'pedidos', 'ajustes'];

// Tudo o que está guardado neste aparelho (para enviar à nuvem na primeira vez).
export async function lerTudo() {
  const db = await abrir();
  const tudo = {};
  for (const nome of LOJAS) {
    const loja = db.transaction(nome).objectStore(nome);
    if (nome === 'fotos') {
      const [chaves, valores] = await Promise.all([pedido(loja.getAllKeys()), pedido(loja.getAll())]);
      tudo.fotos = chaves.map((chave, i) => ({ chave, valor: valores[i] }));
    } else {
      tudo[nome] = await pedido(loja.getAll());
    }
  }
  return tudo;
}

export async function contarLocal() {
  const db = await abrir();
  const conta = {};
  for (const nome of LOJAS) conta[nome] = await pedido(db.transaction(nome).objectStore(nome).count());
  return conta;
}

// Grava o que veio da nuvem (sem avisar a sincronização, para não mandar de volta).
// itens: [{ loja, chave, valor }] ou [{ loja, chave, removido: true }]
export async function aplicarDaNuvem(itens) {
  if (!itens.length) return;
  const db = await abrir();
  const tx = db.transaction([...new Set(itens.map((i) => i.loja))], 'readwrite');
  for (const i of itens) {
    const loja = tx.objectStore(i.loja);
    if (i.removido) loja.delete(i.chave);
    else if (i.loja === 'fotos') loja.put(i.valor, i.chave);
    else loja.put(i.valor);
  }
  await concluir(tx);
}

// Restaura um backup completo: grava de volta tudo o que está no arquivo (e envia para a nuvem).
// Não apaga nada: o que foi criado depois do backup continua no sistema.
export async function restaurarTudo(tudo) {
  const db = await abrir();
  const lojas = LOJAS.filter((nome) => Array.isArray(tudo[nome]));
  const tx = escrever(db, lojas);
  for (const nome of lojas) {
    const loja = tx.objectStore(nome);
    if (nome === 'fotos') tudo.fotos.forEach((f) => loja.put(f.valor, f.chave));
    else tudo[nome].forEach((valor) => loja.put(valor));
  }
  await concluir(tx);
}

// Apaga tudo deste aparelho (usado quando ele passa a usar só o que está na nuvem).
export async function limparTudoLocal() {
  const db = await abrir();
  const tx = db.transaction(LOJAS, 'readwrite');
  for (const nome of LOJAS) tx.objectStore(nome).clear();
  await concluir(tx);
}
