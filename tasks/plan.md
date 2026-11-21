# Plano da Sprint 2

O Trama é o sistema de gestão. O novo site é um projeto separado, com código na pasta `site/` do repositório da equipe. As frentes do site combinam a estrutura dessa pasta antes de criar os arquivos compartilhados. Os módulos podem ser desenvolvidos com os dados fictícios de `exemplos/`.

## Contratos de partida

- **API.** O site chama o Trama pelo seu servidor ou por um proxy de desenvolvimento. Para consultar o pedido, usa o ID retornado e o `requestId` no cabeçalho de autorização. A resposta de acompanhamento traz só ID, número, status e data da última atualização processada.
- **Mensageria.** A transação registra o evento pendente. Dois workers publicam na fila `trama.site` e consomem para atualizar as consultas do site. O consumidor ignora versões antigas ou repetidas. O arquivo `exemplos/eventos.json` descreve os dois eventos.
- **CSV.** O site exporta o arquivo e o Trama importa. Código externo, cor e tamanho identificam a linha. As frentes de arquivos e API definem onde guardar o vínculo com os IDs internos. Depois da carga inicial, os ajustes seguem as regras do estoque do Trama. O relatório do painel segue do Trama para a planilha.

## Ordem de integração

1. Rodar a base e conferir o GET e POST com a Loja Escola.
2. Conectar catálogo, carrinho e confirmação. Repetir um pedido e verificar o saldo e o número devolvido.
3. Aplicar a importação com um produto que ainda não existe na base. Conferir o produto no Trama e no catálogo publicado.
4. Conectar a fila e o acompanhamento. Pausar e retomar o consumidor com um evento pendente e conferir o resultado na interface.
5. Registrar os três fluxos com evidências e abrir as revisões para integrar as branches.

Os responsáveis e critérios de conclusão estão na [lista de tarefas](todo.md).
