# Trama Faculdade

O painel do Trama será o ERP do trabalho. O site da equipe será a vitrine de vendas. Os dois sistemas vão demonstrar integração por API REST, mensageria e transferência de arquivos.

## Base do projeto

A base acadêmica reúne o painel de gestão, a API de catálogo e pedidos, o catálogo genérico de referência e a exportação de relatórios. O site de vendas da equipe será criado para consumir essa API.

O [guia de início da equipe](GUIA-INICIO-EQUIPE.md) tem os passos para clonar, subir a loja fictícia e começar cada frente. O banco local aplica as migrações e carrega o catálogo `loja-escola`. Os arquivos em [`exemplos/`](exemplos/) permitem iniciar o site, o CSV e a mensageria usando os mesmos dados.

## Divisão

| Frente | Entrega | Branch |
|---|---|---|
| API e mensageria | API e regras do Trama. Eventos de estoque e status via RabbitMQ. | `feat/api-mensageria` |
| Site e carrinho | Catálogo, carrinho e envio de pedidos do site. | `feat/site-ecommerce` |
| Acompanhamento | Confirmação, acompanhamento e estados de erro do site. | `feat/site-acompanhamento` |
| CSV e relatórios | Formato e importação do CSV de produtos no Trama. Reaproveitamento da exportação de relatórios. | `feat/csv-relatorios` |

`main` recebe o resultado integrado e revisado. As frentes do site combinam a estrutura e trabalham em arquivos separados. Veja a [lista de tarefas](tasks/todo.md) para os critérios de conclusão.

## Sequência de trabalho

1. Usar exemplos comuns de produto, variação, pedido, mensagem e CSV. O [guia de início da equipe](GUIA-INICIO-EQUIPE.md) documenta o contrato encontrado no código e marca os pontos ainda propostos.
2. Conectar o site à API existente. `GET /api/catalog/{slug}` entrega os produtos e `POST /api/catalog/{slug}/orders` recebe o pedido. A frente de API mantém o ambiente de teste e a consulta de status. O site pode começar com respostas simuladas.
3. Publicar atualizações de estoque e status depois que o Trama registrar a mudança. O consumidor aplica o evento no ambiente acadêmico do site e confirma o processamento. A fila e o consumidor serão construídos nesta frente.
4. O site exporta o CSV de produtos no formato acordado com a frente de arquivos. Essa frente demonstra a importação e a conferência dos registros no Trama. O relatório reaproveita a exportação do painel e é conferido em uma planilha.

## Demonstração para a entrega

- **Arquivos** — importar no Trama um CSV do site com uma variação e 10 peças. Conferir o cadastro e, ao final, abrir o relatório exportado em uma planilha.
- **API** — carregar a variação no site e pedir 2 unidades. Conferir o número do pedido no Trama e o saldo de 8. Reenviar a mesma requisição com o mesmo ID e verificar que o saldo continua em 8.
- **Mensageria** — pausar o consumidor, registrar uma alteração no Trama, mostrar o evento na fila e retomar o consumidor para atualizar o site.
- **Entrega** — reunir o repositório, instruções de execução, exemplos fictícios e evidências dos três fluxos. Confirmar com o professor o formato final exigido.
