import {formatCatalogOrder,validateCatalogOrder,whatsappLink,type CatalogCustomer,type CatalogLine,type CatalogProduct} from '@/lib/catalog';
import {apiJson,supabaseRest} from '@/lib/server-supabase';
type CatalogRow={store_name:string;minimum_qty:number;minimum_value:number;products:CatalogProduct[]};
type RpcResult={message?:string;store_name:string;whatsapp:string;order:{number:number;customer:CatalogCustomer;items:CatalogLine[];total_qty:number;total:number}};
export async function POST(request:Request,{params}:{params:Promise<{slug:string}>}){
 try{
  const{slug}=await params,text=await request.text();if(text.length>50000)return apiJson({error:'Pedido muito grande.'},413);
  const body=JSON.parse(text) as Record<string,unknown>,catalogResponse=await supabaseRest(`/rest/v1/trama_catalogs?slug=eq.${encodeURIComponent(slug)}&enabled=eq.true&select=store_name,minimum_qty,minimum_value,products`,'');
  if(!catalogResponse.ok)throw new Error('Não foi possível abrir o catálogo. Tente novamente.');
  const rows=await catalogResponse.json() as CatalogRow[];if(!rows[0])return apiJson({error:'Catálogo não encontrado.'},404);
  validateCatalogOrder({storeName:rows[0].store_name,minimumQty:rows[0].minimum_qty,minimumValue:rows[0].minimum_value,products:rows[0].products},body);
  const response=await supabaseRest('/rest/v1/rpc/trama_submit_catalog_order','',{method:'POST',body:JSON.stringify({p_slug:slug,p_request_id:body.requestId,p_customer:body.customer,p_items:body.items})}),result=await response.json() as RpcResult;
  if(!response.ok)throw new Error(result.message||'Não foi possível enviar o pedido.');
  const order=result.order,message=formatCatalogOrder({customer:order.customer,items:order.items,totalQty:order.total_qty,total:order.total,number:order.number},result.store_name);
  return apiJson({order,message,whatsappUrl:whatsappLink(result.whatsapp,message)});
 }catch(error){return apiJson({error:error instanceof Error?error.message:'Não foi possível enviar o pedido.'},400)}
}
