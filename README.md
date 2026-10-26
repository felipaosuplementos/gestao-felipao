# Gestão Felipão
Sistema de gestão da Felipão Suplementos

## Módulo 1 — Produtos e estoque (pronto)
- Aba **Produtos**: lista com busca e filtro por categoria.
- **Controle de estoque desligado** por enquanto (Menu → Controlar estoque). Ligado, mostra quantidades e avisos de **acabando**, **sem estoque** e **a conferir**, e cada venda desconta do estoque.
- Cadastro com nome, marca, sabor/variação, categoria, tamanho, custo, preço (lucro calculado), quantidade e foto.
- Botões de **Entrada** e **Saída** com motivo; todo ajuste fica no histórico com data e hora.
- "Outro sabor" cria uma cópia do produto para cadastrar outro sabor rapidinho.
- Produto nunca é apagado: vai para **Arquivados** e pode ser restaurado.
- **Importar** o catálogo da loja (`dados/catalogo-felipao.csv`) ou qualquer planilha CSV, com prévia antes de gravar.
- **Backup**: baixa planilhas de produtos e do histórico (abrem no Excel).

## Módulo 2 — Clientes e fiado (pronto)
- Aba **Clientes** na barra de baixo, com o total **a receber**, o que já está **para cobrar** e as **parcelas a vencer**.
- Lista de quem deve, de quem deve há mais tempo para o mais recente, com destaque para mais de 30 dias.
- Ficha do cliente com WhatsApp (abre a conversa), observação e histórico com data e hora.
- **Cobranças** (tudo dentro do sistema): na ficha, "⏰ Marcar cobrança" escolhe o dia com um toque. Em Clientes → **💰 Cobranças** ficam as atrasadas, as de hoje e as próximas, cada uma com **💬 Cobrar** (WhatsApp com a mensagem pronta), **✓ Cobrei** (registra data e hora e já marca a próxima) e **📅 Remarcar**. Também aparece quem deve há mais de 30 dias sem cobrança marcada. A ficha mostra o histórico das cobranças, e o número vermelho na aba mostra as cobranças do dia. O texto da mensagem pode ser mudado no menu.
- **＋ Fiado** (à vista ou em até 6 parcelas mensais) e **Recebi pagamento** (Pix, dinheiro, cartão), que aceita pagamento parcial e abate primeiro a dívida mais antiga.
- Lançamento errado não é apagado: é **cancelado** e continua no histórico.
- **Importar a planilha de devedores**: cole as colunas nome e valor do Google Planilhas ou escolha o CSV. Tem prévia, e importar de novo não duplica. Um nome sem valor seguido de linhas "24/10 - 530" vira parcelas com vencimento.
- **Backup**: planilha do fiado e lista de clientes separadas em blocos: QUEM DEVE (com total), QUEM JÁ PAGOU e, no fiado, LANÇAMENTOS CANCELADOS.
- **Começar do zero**: apaga o fiado (pede para digitar APAGAR e baixa um backup antes) para importar uma planilha nova. O estoque não é mexido.

## Módulo 3 — Vendas (pronto)
- Aba **Vender** no meio da barra de baixo, com o total vendido no dia, o lucro estimado e o número de vendas, além da soma por forma de pagamento. Dá para ver outros dias.
- **Nova venda**: busca o produto (com foto), ajusta a quantidade e digita o **custo** e o **preço de venda** de cada produto, com o lucro do item na hora. Nada fica fixo no produto: o sistema só sugere os valores da última venda dele (botão "usar").
- Pagamento por **Pix, dinheiro (com troco), débito, crédito (até 12x), link de pagamento ou fiado**. No fiado, escolhe um cliente da lista ou digita um novo, à vista ou parcelado.
- Ao finalizar, a venda fica registrada com data, hora e lucro (preço − custo); com o controle de estoque ligado, **o estoque baixa sozinho**. No fiado, a dívida entra na ficha do cliente.
- **Cancelar venda**: devolve os produtos ao estoque e cancela o fiado dela. Nada é apagado.
- Botão **🛒 Vender** na ficha do produto e **backup** em planilha de vendas.

## Módulo 4 — Painel (pronto)
- Aba **Início**, a primeira tela ao abrir o sistema. Só para olhar: tocar num bloco leva para a tela dele.
- **Hoje**: vendido, lucro e número de vendas.
- **Este mês**: vendido, lucro, **entrou no caixa** (vendas pagas na hora + pagamentos de fiado recebidos) e **ticket médio**, comparando com o mesmo período do mês passado.
- **Gráficos**: vendas por dia do mês e últimos 6 meses (toque na barra mostra vendido, lucro e número de vendas).
- **Fiado** a receber e para cobrar, **tarefas de hoje** e os **5 mais vendidos** do mês.

## Tarefas (pronto)
- Aba **Tarefas** na barra de baixo: anotar rápido para **hoje**, **amanhã** ou outro dia, com hora opcional.
- **Colar lista do Notas**: cada linha vira uma tarefa.
- Lista separada em **Atrasadas**, **Hoje**, **Amanhã** e **Próximos dias**. O que não foi feito passa sozinho para Atrasadas.
- As cobranças com ⏰ da ficha do cliente entram na lista no dia delas, com o botão do WhatsApp.
- ✓ marca como feita (com data e hora). **⏰ Avisar no Google Agenda** em qualquer tarefa. O número de tarefas de hoje aparece no ícone da aba.
- **Backup**: planilha de tarefas no menu.

## Sincronização e segurança (ligada)
- Entrada com a **conta Google** do Felipão. Os dados ficam guardados na nuvem (Firebase) e aparecem no computador e no celular.
- Cada aparelho guarda uma cópia e **funciona sem internet**. O que for feito offline sobe sozinho quando a conexão voltar.
- Se o Chrome for limpo ou o aparelho trocado, é só entrar de novo com a conta Google que tudo volta.
- Só a conta autorizada lê e grava os dados (regras em `firestore.rules`).
- Configuração em `js/config-nuvem.js`; regras do Firestore em `firestore.rules`. Se o login falhar, dá para "Usar só neste aparelho por enquanto".

Os dados ficam guardados no próprio celular (funciona sem internet). Faça backup com frequência.

## Como abrir
O sistema é um site simples (HTML, CSS e JavaScript, sem instalação).
Para usar no celular, publique pelo GitHub Pages: no GitHub, **Settings → Pages → Branch: main → Save**.
Depois abra o link no celular e use "Adicionar à tela inicial".

Para testar no computador: `npx http-server .` e abra http://localhost:8080
