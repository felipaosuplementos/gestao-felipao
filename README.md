# Gestão Felipão
Sistema de gestão da Felipão Suplementos

## Módulo 1 — Produtos e estoque (pronto)
- Lista de produtos com busca, filtro por categoria e avisos de **acabando**, **sem estoque** e **a conferir**.
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
- **Lembrete de cobrança**: na ficha, "⏰ Lembrar de cobrar" marca dia e hora no Google Agenda. Na hora, o aviso traz o link que abre o WhatsApp do cliente com a mensagem pronta. "💬 Cobrar no WhatsApp" abre a mensagem na hora, e o texto pode ser mudado no menu. O filtro "⏰ Cobrar" mostra quem tem lembrete.
- **＋ Fiado** (à vista ou em até 6 parcelas mensais) e **Recebi pagamento** (Pix, dinheiro, cartão), que aceita pagamento parcial e abate primeiro a dívida mais antiga.
- Lançamento errado não é apagado: é **cancelado** e continua no histórico.
- **Importar a planilha de devedores**: cole as colunas nome e valor do Google Planilhas ou escolha o CSV. Tem prévia, e importar de novo não duplica. Um nome sem valor seguido de linhas "24/10 - 530" vira parcelas com vencimento.
- **Backup**: planilha do fiado e lista de clientes separadas em blocos: QUEM DEVE (com total), QUEM JÁ PAGOU e, no fiado, LANÇAMENTOS CANCELADOS.
- **Começar do zero**: apaga o fiado (pede para digitar APAGAR e baixa um backup antes) para importar uma planilha nova. O estoque não é mexido.

## Módulo 3 — Vendas (pronto)
- Aba **Vender** no meio da barra de baixo, com o total vendido no dia, o lucro estimado e o número de vendas, além da soma por forma de pagamento. Dá para ver outros dias.
- **Nova venda**: busca o produto (com foto), ajusta a quantidade e o preço, e aplica desconto. Produto sem preço guarda o preço usado na venda.
- Pagamento por **Pix, dinheiro (com troco), débito, crédito (até 12x), link de pagamento ou fiado**. No fiado, escolhe um cliente da lista ou digita um novo, à vista ou parcelado.
- Ao finalizar, **o estoque baixa sozinho** e a venda fica registrada com data, hora e lucro (preço − custo). No fiado, a dívida entra na ficha do cliente.
- **Cancelar venda**: devolve os produtos ao estoque e cancela o fiado dela. Nada é apagado.
- Botão **🛒 Vender** na ficha do produto e **backup** em planilha de vendas.

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
