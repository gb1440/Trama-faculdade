import { setTimeout as wait } from 'node:timers/promises';
import amqp from 'amqplib';
import pg from 'pg';

const queue = 'trama.site';
const invalidQueue = 'trama.site.invalidos';
const stockType = 'estoque.atualizado';
const orderType = 'pedido.status_alterado';
const statuses = ['Novo', 'Em atendimento', 'Finalizado', 'Cancelado'];
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const mode = process.argv[2];
const connectionString = process.env.TRAMA_DATABASE_URL;

function brokerAddress() {
  if (process.env.TRAMA_AMQP_URL) return new URL(process.env.TRAMA_AMQP_URL);
  if (!process.env.RABBITMQ_PASSWORD) throw new Error('Configure RABBITMQ_PASSWORD em .env.demo.');
  const address = new URL('amqp://127.0.0.1:55672');
  address.username = 'trama_local';
  address.password = process.env.RABBITMQ_PASSWORD;
  address.searchParams.set('heartbeat', '10');
  return address;
}

function parseEvent(content) {
  if (content.length > 16_384) return null;
  try {
    const event = JSON.parse(content.toString());
    if (event?.schemaVersion !== 1
      || typeof event.eventId !== 'string' || !uuid.test(event.eventId)
      || typeof event.catalogId !== 'string' || !uuid.test(event.catalogId)
      || !Number.isSafeInteger(event.entityVersion) || event.entityVersion < 1
      || typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))) return null;

    const { data } = event;
    if (event.type === stockType && typeof data?.productId === 'string' && typeof data.variantId === 'string'
      && Number.isSafeInteger(data.stock) && data.stock >= 0) {
      return { ...event, data: { productId: data.productId, variantId: data.variantId, stock: data.stock } };
    }
    if (event.type === orderType && typeof data?.orderId === 'string' && uuid.test(data.orderId) && statuses.includes(data.status)) {
      return { ...event, data: { orderId: data.orderId, status: data.status } };
    }
    return null;
  } catch {
    return null;
  }
}

async function declareQueues(channel) {
  await channel.assertQueue(invalidQueue, { durable: true });
  await channel.assertQueue(queue, {
    durable: true,
    deadLetterExchange: '',
    deadLetterRoutingKey: invalidQueue,
  });
}

async function publish(db, channel, signal) {
  let returnedId;
  channel.on('return', message => { returnedId = message.properties.messageId; });

  while (!signal.aborted) {
    await db.query('begin');
    let event;
    try {
      const pending = await db.query(`
        select jsonb_build_object(
          'eventId', event_id, 'type', event_type, 'schemaVersion', 1,
          'catalogId', catalog_id, 'catalogSlug', catalog_slug,
          'entityVersion', version, 'occurredAt', occurred_at, 'data', data
        ) as event
        from trama_events.outbox where published_at is null
        order by version limit 1 for update skip locked
      `);
      event = pending.rows[0]?.event;
      if (event) {
        returnedId = null;
        channel.sendToQueue(queue, Buffer.from(JSON.stringify(event)), {
          persistent: true, mandatory: true, contentType: 'application/json', messageId: event.eventId,
        });
        await channel.waitForConfirms();
        if (returnedId === event.eventId) throw new Error('O RabbitMQ devolveu o evento sem roteamento.');
        await db.query('update trama_events.outbox set published_at = clock_timestamp() where event_id = $1', [event.eventId]);
      }
      await db.query('commit');
    } catch (error) {
      await db.query('rollback').catch(() => {});
      throw error;
    }

    if (event) console.log('Publicado', event.type, event.eventId);
    else await wait(400);
  }
}

async function handleDelivery(db, channel, message) {
  const event = parseEvent(message.content);
  if (!event) {
    channel.reject(message, false);
    console.error('Evento inválido encaminhado a', invalidQueue);
    return;
  }

  const { catalogId, type, entityVersion, occurredAt, data } = event;
  const entityKey = type === stockType ? JSON.stringify([data.productId, data.variantId]) : data.orderId;
  try {
    await db.query(`
      insert into trama_events.site_updates as updates
        (catalog_id, event_type, entity_key, version, data, occurred_at)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (catalog_id, event_type, entity_key) do update
        set version = excluded.version, data = excluded.data, occurred_at = excluded.occurred_at
        where updates.version < excluded.version
    `, [catalogId, type, entityKey, entityVersion, data, occurredAt]);
  } catch (error) {
    if (error.code !== '23503') throw error;
    channel.reject(message, false);
    console.error('Catálogo inexistente. Evento encaminhado a', invalidQueue);
    return;
  }
  channel.ack(message);
  console.log('Consumido', event.type, event.eventId);
}

async function consume(db, channel, signal) {
  await channel.prefetch(1);
  if (signal.aborted) return;
  await new Promise((resolve, reject) => {
    signal.addEventListener('abort', resolve, { once: true });
    channel.consume(queue, message => {
      if (!message) {
        reject(new Error('RabbitMQ interrompeu o consumidor.'));
        return;
      }
      handleDelivery(db, channel, message).catch(reject);
    }).catch(reject);
  });
}

if (!connectionString || !['publicar', 'consumir'].includes(mode)) {
  throw new Error('Configure TRAMA_DATABASE_URL e escolha publicar ou consumir.');
}
const address = brokerAddress();
const shutdown = new AbortController();
process.once('SIGINT', () => shutdown.abort());
process.once('SIGTERM', () => shutdown.abort());

while (!shutdown.signal.aborted) {
  const disconnected = new AbortController();
  const signal = AbortSignal.any([shutdown.signal, disconnected.signal]);
  const onDisconnect = () => disconnected.abort();
  const db = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  db.on('error', onDisconnect);
  let connection;
  let reason = '';
  try {
    await db.connect();
    connection = await amqp.connect(address.toString(), { timeout: 5000 });
    connection.on('error', onDisconnect);
    connection.on('close', onDisconnect);
    const channel = mode === 'publicar' ? await connection.createConfirmChannel() : await connection.createChannel();
    channel.on('error', onDisconnect);
    channel.on('close', onDisconnect);
    await declareQueues(channel);
    console.log(mode === 'publicar' ? 'Publicador pronto.' : 'Consumidor pronto.');
    if (mode === 'publicar') await publish(db, channel, signal);
    else await consume(db, channel, signal);
  } catch (error) {
    if (/^[A-Z0-9_]{3,25}$/.test(error.code ?? '')) reason = ` (${error.code})`;
  } finally {
    await connection?.close().catch(() => {});
    await db.end().catch(() => {});
  }
  if (!shutdown.signal.aborted) {
    console.error(`Sessão de mensageria interrompida${reason}. Reconectando...`);
    await wait(1500);
  }
}
