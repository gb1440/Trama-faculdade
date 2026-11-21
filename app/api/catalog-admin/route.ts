import {buildCatalogProducts,normalizeCatalogLogo,normalizeCatalogSlug,type CatalogPriceMode} from '@/lib/catalog';
import {hydrateState,type State} from '@/lib/domain';
import {apiJson,authenticatedUser,bearer,supabaseRest} from '@/lib/server-supabase';
export const dynamic='force-dynamic';
type CatalogRow={id:string;slug:string;enabled:boolean;store_name:string;logo:string;whatsapp:string;city:string;title:string;description:string;price_mode:CatalogPriceMode;minimum_qty:number;minimum_value:number;products:unknown[];updated_at:string};
const stringValue=(value:unknown)=>typeof value==='string'?value:'';
async function context(request:Request){const token=bearer(request),user=await authenticatedUser(token);if(!user)throw new Error('UNAUTHORIZED');return{token,user}}
export async function GET(request:Request){
 try{const{token,user}=await context(request);const[catalogResponse,ordersResponse]=await Promise.all([supabaseRest(`/rest/v1/trama_catalogs?user_id=eq.${user.id}&select=*`,token),supabaseRest(`/rest/v1/trama_catalog_orders?user_id=eq.${user.id}&select=*&order=created_at.desc&limit=100`,token)]);if(!catalogResponse.ok||!ordersResponse.ok)throw new Error('O catálogo ainda não foi preparado no Supabase.');return apiJson({catalog:((await catalogResponse.json()) as CatalogRow[])[0]||null,orders:await ordersResponse.json()})}
 catch(error){return apiJson({error:error instanceof Error&&error.message==='UNAUTHORIZED'?'Sua sessão expirou.':error instanceof Error?error.message:'Não foi possível abrir o catálogo.'},error instanceof Error&&error.message==='UNAUTHORIZED'?401:503)}
}
export async function POST(request:Request){
 try{
  const{token,user}=await context(request),body=await request.json() as Record<string,unknown>;const stateResponse=await supabaseRest(`/rest/v1/trama_store_state?user_id=eq.${user.id}&select=state`,token);if(!stateResponse.ok)throw new Error('Não foi possível consultar os produtos.');
  const rows=await stateResponse.json() as {state:State}[];if(!rows[0])throw new Error('Cadastre sua loja antes de publicar o catálogo.');
  const slug=normalizeCatalogSlug(stringValue(body.slug)),logo=normalizeCatalogLogo(body.logo),whatsapp=stringValue(body.whatsapp).replace(/\D/g,''),mode=body.priceMode==='Varejo'?'Varejo':'Atacado',storeName=stringValue(body.storeName).trim().slice(0,120),city=stringValue(body.city).trim().slice(0,100),title=stringValue(body.title).trim().slice(0,120),description=stringValue(body.description).trim().slice(0,500),minimumQty=Number(body.minimumQty),minimumValue=Number(body.minimumValue);
  if(slug.length<3)throw new Error('Escolha um endereço do catálogo com pelo menos 3 letras.');if(!storeName)throw new Error('Informe o nome da loja.');if(whatsapp.length<10||whatsapp.length>13)throw new Error('Informe o WhatsApp da loja com DDD.');if(!Number.isSafeInteger(minimumQty)||minimumQty<0||!Number.isSafeInteger(minimumValue)||minimumValue<0)throw new Error('Informe mínimos válidos.');
  const state=hydrateState(rows[0].state),products=buildCatalogProducts(state,mode),payload={user_id:user.id,slug,enabled:body.enabled!==false,store_name:storeName,logo,whatsapp,city,title:title||'Catálogo online',description,price_mode:mode,minimum_qty:minimumQty,minimum_value:minimumValue,products,updated_at:new Date().toISOString()};
  const response=await supabaseRest('/rest/v1/trama_catalogs?on_conflict=user_id',token,{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(payload)});
  if(!response.ok){const detail=await response.text();if(detail.includes('trama_catalogs_slug_key'))throw new Error('Este endereço de catálogo já está em uso. Escolha outro.');throw new Error('Não foi possível publicar o catálogo.');}
  return apiJson({catalog:(await response.json() as CatalogRow[])[0]});
 }catch(error){return apiJson({error:error instanceof Error&&error.message==='UNAUTHORIZED'?'Sua sessão expirou.':error instanceof Error?error.message:'Não foi possível salvar o catálogo.'},error instanceof Error&&error.message==='UNAUTHORIZED'?401:400)}
}
export async function PATCH(request:Request){
 try{const{token,user}=await context(request),body=await request.json() as Record<string,unknown>,status=stringValue(body.status);if(!['Novo','Em atendimento','Finalizado','Cancelado'].includes(status))throw new Error('Situação inválida.');const id=stringValue(body.id);if(!id)throw new Error('Pedido inválido.');const response=await supabaseRest('/rest/v1/rpc/trama_update_catalog_order_status',token,{method:'POST',body:JSON.stringify({p_order_id:id,p_status:status})}),order=await response.json() as Record<string,unknown>&{message?:string};if(!response.ok)throw new Error(order.message||'Não foi possível atualizar o pedido.');if(order.user_id!==user.id)throw new Error('Pedido não encontrado.');return apiJson({order})}
 catch(error){return apiJson({error:error instanceof Error&&error.message==='UNAUTHORIZED'?'Sua sessão expirou.':error instanceof Error?error.message:'Não foi possível atualizar.'},error instanceof Error&&error.message==='UNAUTHORIZED'?401:400)}
}
