# Plano da Sprint 2

O Trama é o sistema de gestão. O novo site é um projeto separado, com código na pasta `site/` do repositório da equipe. As frentes do site combinam a estrutura dessa pasta antes de criar os arquivos compartilhados. Os módulos podem ser desenvolvidos com os dados fictícios de `exemplos/`.

## Contratos de partida

- **API.** Usar as rotas de catálogo e pedidos existentes. O site deve chamar o Trama pelo seu servidor ou por um proxy de desenvolvimento, mantendo URLs configuráveis. O acompanhamento público e a forma de autenticar a consulta de status ficam a cargo das frentes de API e acompanhamento. O site só precisa receber o identificador e o status do próprio pedido.
- **Mensageria.** O Trama publica a mudança depois de gravá-la. O consumidor roda no servidor do site ou em um processo separado e atualiza a informação que o site apresenta. O arquivo `exemplos/eventos.json` é a proposta inicial. Confirmar com a frente de mensageria o destino, a versão e o tratamento de duplicatas antes de conectar.
- **CSV.** O site exporta o arquivo e o Trama importa. Código externo, cor e tamanho identificam a linha. As frentes de arquivos e API definem onde guardar o vínculo com os IDs internos. Depois da carga inicial, os ajustes seguem as regras do estoque do Trama. O relatório do painel segue do Trama para a planilha.

## Ordem de integração

1. Rodar a base e conferir o GET e POST com a Loja Escola.
2. Conectar catálogo, carrinho e confirmação. Repetir um pedido e verificar o saldo e o número devolvido.
3. Aplicar a importação com um produto que ainda não existe na base. Conferir o produto no Trama e no catálogo publicado.
4. Conectar a fila e o acompanhamento. Pausar e retomar o consumidor com um evento pendente e conferir o resultado na interface.
5. Registrar os três fluxos com evidências e abrir as revisões para integrar as branches.

Os responsáveis e critérios de conclusão estão na [lista de tarefas](todo.md).
