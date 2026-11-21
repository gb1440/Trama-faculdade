# Guia de início da equipe

## 1. Abrir a base

Instalem Git e Node.js 22.13 ou superior. O Docker Desktop é necessário para rodar o Supabase local e o RabbitMQ. Quem está montando telas ou o leitor de CSV já pode começar com os arquivos de `exemplos/`, mesmo sem Docker.

Clonem o repositório acadêmico e entrem na pasta do projeto:

```powershell
git clone https://github.com/gb1440/Trama-faculdade.git trama-faculdade
cd trama-faculdade
```

| Frente | Branch | Primeiro passo |
|---|---|---|
| API e mensageria | `feat/api-mensageria` | Executar GET e POST na Loja Escola e verificar o RabbitMQ. |
| Site e carrinho | `feat/site-ecommerce` | Montar catálogo e carrinho com `exemplos/catalogo.json`. |
| Acompanhamento | `feat/site-acompanhamento` | Montar confirmação e acompanhamento com `exemplos/pedido-resposta.json` e `exemplos/eventos.json`. |
| CSV e relatórios | `feat/csv-relatorios` | Implementar leitura e prévia usando os dois CSVs em `exemplos/`. |

Para trabalhar no catálogo e carrinho, rodem `git switch feat/site-ecommerce`. As branches da equipe partem da mesma base. A [`lista de tarefas`](tasks/todo.md) detalha entregas e testes.

## 2. Rodar o Trama local

Com o Docker aberto, na raiz do Trama:

```powershell
npm ci
npm run db:start
npm run demo:acesso
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Executem `npx --yes supabase@2.121.0 status -o env` e copiem o valor de `ANON_KEY` para `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` em `.env.local`. A URL já está no arquivo de exemplo. Usem apenas a chave pública local. Os arquivos `.env.local` e `.env.demo` são ignorados pelo Git. [Documentação do Supabase local](https://supabase.com/docs/guides/local-development/cli/getting-started)

```powershell
npm run dev -- --hostname 127.0.0.1
```

- Painel em `http://127.0.0.1:3000`. Entrar com a conta fictícia `equipe@example.com` e o valor de `TRAMA_DEMO_PASSWORD` em `.env.demo`. Após reiniciar o banco do zero, rodem `npm run demo:acesso` de novo.
- Vitrine de referência em `http://127.0.0.1:3000/catalogo/loja-escola`.
- O Supabase aplica as migrações e preenche a Loja Escola com uma camiseta de R$ 59,90, com 10 unidades M e 5 G. A carga é definida em `supabase/seed.sql` para o banco local.
- `npm test` roda a suíte do Trama. `npm run db:stop` encerra a instância acadêmica e preserva os dados locais.

Os serviços usam dados e acessos de demonstração. Rodem em uma rede de confiança e desliguem os serviços quando terminarem. Em macOS ou Linux, usem `test -f .env.local || cp .env.example .env.local` para copiar o arquivo e `curl` no lugar de `curl.exe`.

## 3. Testar a API

```powershell
curl.exe http://127.0.0.1:3000/api/catalog/loja-escola
curl.exe http://127.0.0.1:3000/api/catalog/loja-escola/orders -H 'Content-Type: application/json' --data-binary '@exemplos/pedido.json'
```

O GET retorna `catalog.products`, com `id` do produto, `id` da variação, estoque e preço em centavos. Para o POST, usem `productId` e `variantId` do GET, `qty`, `requestId` em UUID e dados do cliente. Nome, WhatsApp com DDD, cidade e UF são obrigatórios, e o documento é opcional.

O primeiro pedido do exemplo reserva 2 unidades M. O próximo GET deve mostrar 8. Repetir o mesmo carrinho e cliente com o mesmo `requestId` devolve o pedido original, mesmo se a variação esgotou. Usar o mesmo identificador com dados diferentes devolve `409`. Para cada pedido novo, gerem um UUID aleatório com `crypto.randomUUID()`. A resposta traz `order`, `message` e `whatsappUrl`. O link dos dados fictícios serve para testar a exibição.

O site da equipe fica em `site/` como projeto separado. Façam as chamadas pelo servidor do site ou por um proxy de desenvolvimento. Depois do POST, guardem `order.id` e o `requestId` enviado junto ao pedido.

| Rota | Uso pelo site |
|---|---|
| `GET /api/catalog/{slug}/orders/{orderId}` | Enviar `Authorization: Bearer <requestId>`. Retorna `{ order: { id, number, status, updatedAt } }`. Sem token válido, responde `401`. Quando o pedido e o token não correspondem, responde `404`. |
| `GET /api/catalog/{slug}/stock` | Retorna `{ updates: [{ productId, variantId, stock, entityVersion }] }` com os últimos saldos processados pela fila. O GET de catálogo fornece o carregamento inicial e a disponibilidade atual para compra. |

O `requestId` dá acesso à consulta daquele pedido. Guardem-no na sessão do cliente ou no servidor do site, sem colocar o valor na URL. O status consultado reflete o que o consumidor já processou e pode ficar temporariamente atrás do painel. Para testar os endpoints em PowerShell:

```powershell
$pedido = Get-Content exemplos/pedido.json -Raw | ConvertFrom-Json
$pedido.requestId = [guid]::NewGuid().ToString()
$criado = Invoke-RestMethod http://127.0.0.1:3000/api/catalog/loja-escola/orders -Method Post -ContentType 'application/json' -Body ($pedido | ConvertTo-Json -Depth 5)
Invoke-RestMethod "http://127.0.0.1:3000/api/catalog/loja-escola/orders/$($criado.order.id)" -Headers @{ Authorization = "Bearer $($pedido.requestId)" }
```

## 4. Rodar a mensageria

Se o banco já estava rodando antes desta atualização, apliquem a migração local com `npx --yes supabase@2.121.0 migration up --local`. Em `.env.demo`, acrescentem `TRAMA_DATABASE_URL` com o valor de `DB_URL` mostrado por `npx --yes supabase@2.121.0 status -o env`. Essa URL contém a credencial do banco local e é usada apenas pelos workers.

```powershell
docker compose --env-file .env.demo up -d rabbitmq
docker compose --env-file .env.demo exec -T rabbitmq rabbitmq-diagnostics -q ping
```

A interface de administração fica em `http://127.0.0.1:15673`. O usuário do broker é `trama_local` e a senha está em `RABBITMQ_PASSWORD` no `.env.demo`. A conexão AMQP fica em `127.0.0.1:55672`. `docker compose --env-file .env.demo stop rabbitmq` encerra o broker.

Em terminais separados, rodem `npm run mensageria:publicar` e `npm run mensageria:consumir`.

- Quando estoque ou status muda, a mesma transação registra um evento pendente no Supabase. O publicador só marca o evento como enviado depois da confirmação do RabbitMQ.
- A fila durável é `trama.site`. O consumidor grava o estado para consulta do site antes de confirmar a entrega. Só aplica uma versão posterior à atual. Mensagens inválidas seguem para `trama.site.invalidos`.
- `exemplos/eventos.json` mostra os tipos `estoque.atualizado` e `pedido.status_alterado`. Os estados do pedido são `Novo`, `Em atendimento`, `Finalizado` e `Cancelado`.

Para ensaiar, criem um pedido e aguardem o processamento de `Novo`. Parem o consumidor com Ctrl+C e alterem o status no Trama para **Em atendimento**. Mostrem a mensagem aguardando em `trama.site` e o status antigo na consulta do site. Reiniciem o consumidor e repitam o GET para mostrar o novo status.

`npm run test:integracao` automatiza esse fluxo usando Supabase, RabbitMQ e Trama locais. Parem os dois workers manuais antes do teste, pois ele controla os próprios processos. Se o Trama estiver em outra porta, definam `TRAMA_TEST_URL` com o endereço local, por exemplo, `$env:TRAMA_TEST_URL = 'http://127.0.0.1:3300'` no PowerShell. O teste cria um pedido na Loja Escola e depois o cancela para repor as unidades.

## 5. Começar o CSV

A frente de arquivos pode usar `produtos.csv` como entrada válida. O arquivo inválido tem uma variação repetida e estoque negativo. Ambos usam UTF-8, ponto e vírgula e preço em centavos. O código externo pertence ao site e deve ser associado aos IDs internos do Trama. O saldo de carga inicial não deve sobrescrever movimentações posteriores.

O fluxo é **site exporta produtos → Trama importa**. O painel já exporta relatórios em CSV pela função `downloadCsv` de `app/store-app.tsx`. Esse segundo fluxo é **Trama exporta relatório → planilha lê**.
