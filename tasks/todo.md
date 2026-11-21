# Tarefas da Sprint 2

## API e mensageria · `feat/api-mensageria`

- [ ] Validar catálogo e pedido com o site. Conferir estoque, pedido repetido e quantidade indisponível. Testar também a repetição de um pedido que esgotou a variação, pois a rota valida o estoque atual antes de chegar à deduplicação no banco.
- [ ] Combinar com a frente de acompanhamento o contrato de consulta do próprio pedido, incluindo como comprovar o acesso e quais estados exibir.
- [ ] Publicar e consumir eventos do RabbitMQ. Demonstrar que a mudança já está gravada quando o evento é publicado, que a pausa e a retomada do consumidor funcionam e que mensagens repetidas não causam efeitos duplicados.

## Site e carrinho · `feat/site-ecommerce`

- [ ] Montar catálogo, seleção de variação e carrinho com `exemplos/catalogo.json`. Conferir R$ 59,90 na variante M e impedir quantidade acima do estoque exibido.
- [ ] Consumir as rotas de catálogo e pedido. Reutilizar o `requestId` se repetir o envio após falha de comunicação e devolver a resposta para a tela de confirmação da frente de acompanhamento.
- [ ] Exportar do site um CSV que o Trama consiga importar. Validar o cabeçalho, as variações separadas e o preço em centavos, junto com a frente de arquivos.

## Acompanhamento · `feat/site-acompanhamento`

- [ ] Montar confirmação e acompanhamento com `exemplos/pedido-resposta.json` e `exemplos/eventos.json`. Conferir os estados de envio, erro, sucesso e a transição de `Novo` para `Em atendimento`.
- [ ] Ligar a confirmação ao envio do carrinho. Ligar o acompanhamento à consulta que a frente de API disponibilizar e verificar que o site atualiza o pedido correto.

## CSV e relatórios · `feat/csv-relatorios`

- [ ] Criar a prévia de importação com `exemplos/produtos.csv` e `exemplos/produtos-invalidos.csv`. Exibir a linha e o motivo de cada erro. O arquivo válido contém um produto em dois tamanhos.
- [ ] Integrar o importador ao cadastro do Trama, combinando o vínculo de identificadores com a frente de API. Confirmar que repetir a carga não duplica o produto nem repõe estoque já movimentado.
- [ ] Gerar o CSV de relatórios no painel e abrir em uma planilha. Conferir o mês, as colunas e os valores com a tela do Trama.

## Revisão em equipe

- [ ] Rodar `npm test` e `npm run build` no Trama e validar o site com os comandos do próprio projeto.
- [ ] Ensaiar as três integrações e registrar o que ocorreu para a apresentação.
