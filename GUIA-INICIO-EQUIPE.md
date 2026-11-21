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

O primeiro pedido do exemplo reserva 2 unidades M. O próximo GET deve mostrar 8. Repetir esse mesmo pedido com o mesmo `requestId` preserva a reserva e o número. Para um pedido novo, gerem outro UUID. A resposta de sucesso traz `order`, `message` e `whatsappUrl`. As falhas trazem `error`. O link de WhatsApp dos dados fictícios serve só para testar a exibição.

O site da equipe fica em `site/` como projeto separado. Ao trocar os exemplos por chamadas reais, façam as chamadas pelo servidor do site ou por um proxy de desenvolvimento. O contrato atual não oferece consulta pública de status. As frentes de API e acompanhamento vão acertar esse contrato.

## 4. Começar a mensageria

```powershell
docker compose --env-file .env.demo up -d rabbitmq
docker compose --env-file .env.demo exec -T rabbitmq rabbitmq-diagnostics -q ping
```

A interface de administração fica em `http://127.0.0.1:15673`. O usuário do broker é `trama_local` e a senha está em `RABBITMQ_PASSWORD` no `.env.demo`. A conexão AMQP fica em `127.0.0.1:55672`. `docker compose --env-file .env.demo stop rabbitmq` encerra o broker.

O exemplo `eventos.json` contém uma proposta para estoque atualizado e status alterado. O Trama hoje usa `Novo`, `Em atendimento`, `Finalizado` e `Cancelado`. A frente de mensageria vai implementar publicação e consumo. A frente de acompanhamento pode simular a transição com o exemplo.

## 5. Começar o CSV

A frente de arquivos pode usar `produtos.csv` como entrada válida. O arquivo inválido tem uma variação repetida e estoque negativo. Ambos usam UTF-8, ponto e vírgula e preço em centavos. O código externo pertence ao site e deve ser associado aos IDs internos do Trama. O saldo de carga inicial não deve sobrescrever movimentações posteriores.

O fluxo é **site exporta produtos → Trama importa**. O painel já exporta relatórios em CSV pela função `downloadCsv` de `app/store-app.tsx`. Esse segundo fluxo é **Trama exporta relatório → planilha lê**.
