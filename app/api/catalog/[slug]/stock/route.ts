import { apiJson, supabaseRest } from '@/lib/server-supabase';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  try {
    const response = await supabaseRest('/rest/v1/rpc/trama_get_site_stock', '', {
      method: 'POST',
      body: JSON.stringify({ p_slug: slug }),
    });
    if (!response.ok) throw new Error();
    const updates = await response.json();
    return updates ? apiJson({ updates }) : apiJson({ error: 'Catálogo não encontrado.' }, 404);
  } catch {
    return apiJson({ error: 'Não foi possível consultar o estoque.' }, 503);
  }
}
