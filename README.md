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

Os dados ficam guardados no próprio celular (funciona sem internet). Faça backup com frequência.

## Como abrir
O sistema é um site simples (HTML, CSS e JavaScript, sem instalação).
Para usar no celular, publique pelo GitHub Pages: no GitHub, **Settings → Pages → Branch: main → Save**.
Depois abra o link no celular e use "Adicionar à tela inicial".

Para testar no computador: `npx http-server .` e abra http://localhost:8080
