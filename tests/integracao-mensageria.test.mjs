import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import amqp from 'amqplib';

const trama = 'http://127.0.0.1:3000';
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
const apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const jsonHeaders = { 'Content-Type': 'application/json' };
const catalogPath = '/api/catalog/loja-escola';
const orderPath = `${catalogPath}/orders`;

async function eventually(check, message) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await check();
    if (value) return value;
    await wait(200);
  }
  assert.fail(message);
}

function startWorker(mode) {
  return spawn(process.execPath, ['--env-file=.env.demo', 'scripts/mensageria.mjs', mode], {
    stdio: 'ignore',
  });
}

async function stopWorker(worker) {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  const exit = once(worker, 'exit');
  worker.kill();
  await exit;
}

test('pedido idempotente, acompanhamento privado e atualização pela fila após pausa', { timeout: 45000 }, async t => {
  assert.match(supabase ?? '', /^http:\/\/(127\.0\.0\.1|localhost):55421$/);
  const db = new URL(process.env.TRAMA_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname) && db.port === '55422', 'Use o banco acadêmico local');
  assert.ok(!process.env.TRAMA_AMQP_URL, 'Rode o teste com a configuração local padrão do RabbitMQ');
  const user = 'trama_local';
  const password = process.env.RABBITMQ_PASSWORD;
  const broker = new URL('amqp://127.0.0.1:55672');
  broker.username = user;
  broker.password = password;
  const managementHeaders = { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` };
  const queue = async () => {
    const response = await fetch('http://127.0.0.1:15673/api/queues/%2F/trama.site', { headers: managementHeaders });
    return response.ok ? response.json() : null;
  };
  let publisher = startWorker('publicar');
  let consumer;
  t.after(async () => {
    if (consumer) await stopWorker(consumer);
    await stopWorker(publisher);
  });
  await eventually(queue, 'O publicador criou a fila trama.site');
  const auth = await fetch(`${supabase}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { ...jsonHeaders, apikey: apiKey },
    body: JSON.stringify({ email: 'equipe@example.com', password: process.env.TRAMA_DEMO_PASSWORD }),
  });
  assert.equal(auth.status, 200);
  const { access_token: token } = await auth.json();
  const example = JSON.parse(await readFile(new URL('../exemplos/pedido.json', import.meta.url), 'utf8'));
  const { catalog } = await fetch(trama + catalogPath).then(response => response.json());
  const original = example.items[0];
  const currentStock = async () => {
    const { updates } = await fetch(trama + catalogPath + '/stock').then(response => response.json());
    return updates.find(item => item.variantId === original.variantId);
  };
  const previousVersion = (await currentStock())?.entityVersion ?? 0;
  const variant = catalog.products.find(product => product.id === original.productId)
    ?.variants.find(item => item.id === original.variantId);
  assert.ok(variant?.stock > 0, 'O catálogo da demonstração precisa ter a variação M disponível');
  const requestId = randomUUID();
  const phoneSuffix = String(Number.parseInt(requestId.slice(0, 7), 16)).slice(-7).padStart(7, '0');
  const request = {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      ...example, requestId, customer: { ...example.customer, whatsapp: `8590${phoneSuffix}` },
      items: [{ ...original, qty: variant.stock }],
    }),
  };
  const first = await fetch(trama + orderPath, request);
  assert.equal(first.status, 200);
  const { order } = await first.json();

  try {
    const repeated = await fetch(trama + orderPath, request);
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).order.id, order.id);
    const changedRequest = JSON.parse(request.body);
    changedRequest.customer.name = 'Outro cliente fictício';
    const conflict = await fetch(trama + orderPath, { ...request, body: JSON.stringify(changedRequest) });
    assert.equal(conflict.status, 409);
    changedRequest.requestId = randomUUID();
    const soldOut = await fetch(trama + orderPath, { ...request, body: JSON.stringify(changedRequest) });
    assert.equal(soldOut.status, 400);

    const statusUrl = `${trama}${orderPath}/${order.id}`;
    assert.equal((await fetch(statusUrl)).status, 401);
    assert.equal((await fetch(statusUrl, { headers: { Authorization: `Bearer ${randomUUID()}` } })).status, 404);
    const status = await fetch(statusUrl, { headers: { Authorization: `Bearer ${requestId}` } });
    assert.equal(status.status, 200);
    const data = await status.json();
    assert.deepEqual(Object.keys(data.order).sort(), ['id', 'number', 'status', 'updatedAt']);
    assert.equal(data.order.status, 'Novo');

    const connection = await amqp.connect(broker.toString());
    t.after(() => connection.close());
    const channel = await connection.createConfirmChannel();
    const replay = await eventually(async () => {
      const message = await channel.get('trama.site');
      if (!message) return false;
      const event = JSON.parse(message.content.toString());
      if (event.data.orderId !== order.id) return false;
      channel.nackAll(true);
      return message.content;
    }, 'O RabbitMQ recebeu o evento do pedido');

    consumer = startWorker('consumir');
    await eventually(async () => {
      const stock = await currentStock();
      return stock?.stock === 0 && stock.entityVersion > previousVersion;
    }, 'O consumidor publicou o estoque esgotado para o site');
    await stopWorker(consumer);
    await stopWorker(publisher);

    const change = await fetch(`${trama}/api/catalog-admin`, {
      method: 'PATCH', headers: { ...jsonHeaders, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: order.id, status: 'Em atendimento' }),
    });
    assert.equal(change.status, 200);
    const readStatus = async () => {
      const result = await fetch(statusUrl, { headers: { Authorization: `Bearer ${requestId}` } });
      return (await result.json()).order.status;
    };
    assert.equal(await readStatus(), 'Novo');
    publisher = startWorker('publicar');
    await eventually(async () => (await queue())?.messages_ready > 0, 'A fila reteve eventos com o consumidor pausado');

    consumer = startWorker('consumir');
    await eventually(async () => await readStatus() === 'Em atendimento', 'O consumidor retomou a atualização de status');
    channel.sendToQueue('trama.site', replay, { persistent: true });
    await channel.waitForConfirms();
    await eventually(async () => {
      const info = await queue();
      return info?.messages_ready === 0 && info?.messages_unacknowledged === 0;
    }, 'O consumidor concluiu a entrega repetida');
    assert.equal(await readStatus(), 'Em atendimento');
  } finally {
    const cancel = await fetch(`${trama}/api/catalog-admin`, {
      method: 'PATCH', headers: { ...jsonHeaders, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: order.id, status: 'Cancelado' }),
    });
    assert.equal(cancel.status, 200);
  }
});
