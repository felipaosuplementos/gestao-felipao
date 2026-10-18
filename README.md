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
- **＋ Fiado** (à vista ou em até 6 parcelas mensais) e **Recebi pagamento** (Pix, dinheiro, cartão), que aceita pagamento parcial e abate primeiro a dívida mais antiga.
- Lançamento errado não é apagado: é **cancelado** e continua no histórico.
- **Importar a planilha de devedores**: cole as colunas nome e valor do Google Planilhas ou escolha o CSV. Tem prévia, e importar de novo não duplica. Um nome sem valor seguido de linhas "24/10 - 530" vira parcelas com vencimento.
- **Backup**: planilha do fiado (todos os lançamentos) e lista de quem deve.
- **Começar do zero**: apaga o fiado (pede para digitar APAGAR e baixa um backup antes) para importar uma planilha nova. O estoque não é mexido.

Os dados ficam guardados no próprio celular (funciona sem internet). Faça backup com frequência.

## Como abrir
O sistema é um site simples (HTML, CSS e JavaScript, sem instalação).
Para usar no celular, publique pelo GitHub Pages: no GitHub, **Settings → Pages → Branch: main → Save**.
Depois abra o link no celular e use "Adicionar à tela inicial".

Para testar no computador: `npx http-server .` e abra http://localhost:8080
