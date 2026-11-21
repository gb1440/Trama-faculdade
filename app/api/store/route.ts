import { applyAction, emptyState, hydrateState } from '@/lib/domain';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
type StoreRow = { user_id: string; state: ReturnType<typeof emptyState>; revision: number };

function config() {
  if (!supabaseUrl || !publishableKey) throw new Error('Supabase não configurado.');
  return { supabaseUrl, publishableKey };
}

function tokenFrom(request: Request) {
  const value = request.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function supabaseFetch(path: string, token: string, init: RequestInit = {}) {
  const current = config();
  const headers = new Headers(init.headers);
  headers.set('apikey', current.publishableKey);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return fetch(`${current.supabaseUrl}${path}`, { ...init, headers, cache: 'no-store' });
}

async function currentUser(token: string) {
  if (!token) return null;
  const response = await supabaseFetch('/auth/v1/user', token);
  return response.ok ? (await response.json()) as { id: string } : null;
}

async function readStore(userId: string, token: string): Promise<StoreRow> {
  const path = `/rest/v1/trama_store_state?user_id=eq.${encodeURIComponent(userId)}&select=user_id,state,revision`;
  let response = await supabaseFetch(path, token);
  if (!response.ok) throw new Error('O banco ainda não foi preparado. Execute a migração do Supabase.');
  let rows = (await response.json()) as StoreRow[];
  if (rows[0]) return { ...rows[0], state: hydrateState(rows[0].state) };

  response = await supabaseFetch('/rest/v1/trama_store_state?on_conflict=user_id', token, {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ user_id: userId, state: emptyState(), revision: 0 }),
  });
  if (!response.ok) throw new Error('Não foi possível criar a loja para este acesso.');
  rows = (await response.json()) as StoreRow[];
  if (rows[0]) return { ...rows[0], state: hydrateState(rows[0].state) };
  response = await supabaseFetch(path, token);
  rows = (await response.json()) as StoreRow[];
  if (!rows[0]) throw new Error('Não foi possível abrir a loja.');
  return { ...rows[0], state: hydrateState(rows[0].state) };
}

async function nextSku(token: string) {
  const response = await supabaseFetch('/rest/v1/rpc/trama_next_sku', token, { method: 'POST', body: '{}' });
  if (!response.ok) throw new Error('Não foi possível gerar o código do produto.');
  const sku = (await response.json()) as string | null;
  if (!sku) throw new Error('Não foi possível gerar o código do produto.');
  return sku;
}

export async function GET(request: Request) {
  try {
    const token = tokenFrom(request);
    const user = await currentUser(token);
    if (!user) return json({ error: 'Entre para acessar sua loja.' }, 401);
    const row = await readStore(user.id, token);
    return json({ state: row.state, revision: Number(row.revision), local: process.env.NODE_ENV === 'development' });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Não foi possível abrir os dados.' }, 503);
  }
}

export async function POST(request: Request) {
  try {
    const token = tokenFrom(request);
    const user = await currentUser(token);
    if (!user) return json({ error: 'Sua sessão expirou. Entre novamente.' }, 401);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: 'Origem inválida.' }, 403);
    const text = await request.text();
    if (text.length > 150000) return json({ error: 'Pedido muito grande.' }, 413);
    const body = JSON.parse(text) as Record<string, unknown>;
    const row = await readStore(user.id, token);
    if (body.revision !== Number(row.revision)) return json({ error: 'Seus dados foram atualizados enquanto você editava (em outra aba ou por um pedido do catálogo). A versão mais recente já foi carregada: confira e salve de novo.' }, 409);

    if (body.action === 'product') {
      const existing = typeof body.id === 'string' ? row.state.products.find((product) => product.id === body.id) : null;
      body.code = existing?.code || await nextSku(token);
    }

    const state = applyAction(row.state, body);
    const path = `/rest/v1/trama_store_state?user_id=eq.${encodeURIComponent(user.id)}&revision=eq.${row.revision}&select=state,revision`;
    const response = await supabaseFetch(path, token, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ state, revision: Number(row.revision) + 1, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) throw new Error('Não foi possível salvar no Supabase.');
    const rows = (await response.json()) as Pick<StoreRow, 'state' | 'revision'>[];
    if (!rows[0]) return json({ error: 'Seus dados foram atualizados enquanto você editava (em outra aba ou por um pedido do catálogo). A versão mais recente já foi carregada: confira e salve de novo.' }, 409);
    return json({ state: rows[0].state, revision: Number(rows[0].revision) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Não foi possível salvar.' }, 400);
  }
}
