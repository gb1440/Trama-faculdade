import { formatCatalogOrder, isOrderUuid, validateCatalogCustomer, whatsappLink, type CatalogCustomer, type CatalogLine } from '@/lib/catalog';
import { apiJson, supabaseRest } from '@/lib/server-supabase';

type SavedOrder = { number: number; customer: CatalogCustomer; items: CatalogLine[]; total_qty: number; total: number };
type RpcResult = { store_name: string; whatsapp: string; order: SavedOrder };
const unavailable = 'Não foi possível enviar o pedido. Tente novamente.';

function validOrderItem(item: unknown) {
  if (!item || typeof item !== 'object') return false;
  const { productId, variantId, qty } = item as Record<string, unknown>;
  const number = typeof qty === 'number' || typeof qty === 'string' ? Number(qty) : NaN;
  return typeof productId === 'string' && productId.length > 0
    && typeof variantId === 'string' && variantId.length > 0
    && Number.isSafeInteger(number) && number > 0 && number <= 100000;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const text = await request.text();
  if (text.length > 50000) return apiJson({ error: 'Pedido muito grande.' }, 413);

  let body: Record<string, unknown> | null;
  try {
    body = JSON.parse(text);
  } catch {
    return apiJson({ error: 'Pedido inválido.' }, 400);
  }
  if (!isOrderUuid(body?.requestId)) return apiJson({ error: 'Identificador do pedido inválido.' }, 400);
  let customer: CatalogCustomer;
  try {
    customer = validateCatalogCustomer(body.customer);
  } catch (error) {
    return apiJson({ error: error instanceof Error ? error.message : 'Informe os dados do cliente.' }, 400);
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 200) {
    return apiJson({ error: 'Adicione pelo menos uma peça ao pedido.' }, 400);
  }
  if (!body.items.every(validOrderItem)) return apiJson({ error: 'Informe itens e quantidades válidos.' }, 400);
  const items = body.items.map(({ productId, variantId, qty }) => ({ productId, variantId, qty: Number(qty) }));

  try {
    const response = await supabaseRest('/rest/v1/rpc/trama_submit_catalog_order', '', {
      method: 'POST',
      body: JSON.stringify({ p_slug: slug, p_request_id: body.requestId, p_customer: customer, p_items: items }),
    });
    if (!response.ok) {
      const { code, message } = await response.json();
      if (message === 'Catálogo não encontrado ou indisponível.') return apiJson({ error: message }, 404);
      if (code === 'P0001') return apiJson({ error: message }, 400);
      return apiJson({ error: unavailable }, 503);
    }
    const { order, store_name, whatsapp } = await response.json() as RpcResult;
    const customerFields = Object.keys(customer) as Array<keyof CatalogCustomer>;
    const quantities = new Map(items.map(item => [JSON.stringify([item.productId, item.variantId]), item.qty]));
    if (customerFields.some(field => customer[field] !== order.customer[field])
      || order.items.length !== items.length
      || order.items.some(item => quantities.get(JSON.stringify([item.productId, item.variantId])) !== item.qty)) {
      return apiJson({ error: 'O identificador já está em uso por outro pedido.' }, 409);
    }
    const message = formatCatalogOrder({
      customer: order.customer, items: order.items, totalQty: order.total_qty, total: order.total, number: order.number,
    }, store_name);
    return apiJson({ order, message, whatsappUrl: whatsappLink(whatsapp, message) });
  } catch {
    return apiJson({ error: unavailable }, 503);
  }
}
