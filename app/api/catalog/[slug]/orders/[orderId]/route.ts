import { isOrderUuid } from '@/lib/catalog';
import { apiJson, bearer, supabaseRest } from '@/lib/server-supabase';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; orderId: string }> }) {
  const requestId = bearer(request);
  if (!isOrderUuid(requestId)) return apiJson({ error: 'Informe o token de acompanhamento.' }, 401);

  const { slug, orderId } = await params;
  if (!isOrderUuid(orderId)) return apiJson({ error: 'Pedido não encontrado.' }, 404);

  try {
    const response = await supabaseRest('/rest/v1/rpc/trama_get_order_tracking', '', {
      method: 'POST',
      body: JSON.stringify({ p_slug: slug, p_order_id: orderId, p_request_id: requestId }),
    });
    if (!response.ok) throw new Error();
    const order = await response.json();
    return order ? apiJson({ order }) : apiJson({ error: 'Pedido não encontrado.' }, 404);
  } catch {
    return apiJson({ error: 'Não foi possível consultar o pedido.' }, 503);
  }
}
