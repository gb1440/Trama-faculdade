import type {Product,State} from './domain.ts';

export type CatalogPriceMode='Atacado'|'Varejo';
export type CatalogVariant={id:string;color:string;size:string;stock:number};
export type CatalogProduct={id:string;name:string;code:string;category:string;photo:string;price:number;minimum:number;variants:CatalogVariant[]};
export type CatalogCustomer={name:string;whatsapp:string;city:string;uf:string;document:string};
export type CatalogLine={productId:string;variantId:string;name:string;color:string;size:string;qty:number;unitPrice:number;total:number};
export type CatalogOrder={customer:CatalogCustomer;items:CatalogLine[];totalQty:number;total:number;number?:number};
export type CatalogForValidation={storeName:string;minimumQty:number;minimumValue:number;products:CatalogProduct[]};

const text=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';
const integer=(value:unknown,min:number,max:number)=>{const number=Number(value);if(!Number.isSafeInteger(number)||number<min||number>max)throw new Error('Informe uma quantidade válida.');return number};
export function normalizeCatalogSlug(value:string){return value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60).replace(/-+$/,'')}
export function normalizeCatalogLogo(value:unknown){const logo=text(value,2000);if(!logo)return'';if(/^https:\/\/[^\s]+$/i.test(logo)||/^storage:product-images\/[0-9a-f-]{36}\/catalog-logos\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/i.test(logo))return logo;throw new Error('A referência da logo é inválida.')}
export function publicCatalogImage(value:string,supabaseUrl:string){const prefix='storage:product-images/';return value.startsWith(prefix)?`${supabaseUrl}/storage/v1/object/public/product-images/${value.slice(prefix.length)}`:value}

export function buildCatalogProducts(state:State,mode:CatalogPriceMode):CatalogProduct[]{
 return state.products.filter(product=>product.catalogVisible!==false).map((product:Product)=>({
  id:product.id,name:product.name,code:product.code,category:product.category,photo:product.photo,
  price:mode==='Varejo'?product.retail:product.wholesale,minimum:product.orderMinimum||0,
  variants:product.variants.filter(variant=>variant.stock>0).map(({id,color,size,stock})=>({id,color,size,stock}))
 })).filter(product=>product.variants.length>0);
}

export function validateCatalogOrder(catalog:CatalogForValidation,input:unknown):CatalogOrder{
 if(!input||typeof input!=='object')throw new Error('Pedido inválido.');
 const raw=input as Record<string,unknown>,rawCustomer=(raw.customer||{}) as Record<string,unknown>;
 const customer:CatalogCustomer={name:text(rawCustomer.name,120),whatsapp:text(rawCustomer.whatsapp,30).replace(/\D/g,''),city:text(rawCustomer.city,100),uf:text(rawCustomer.uf,2).toLocaleUpperCase('pt-BR'),document:text(rawCustomer.document,30).replace(/\D/g,'')};
 if(!customer.name)throw new Error('Informe o nome do cliente.');
 if(customer.whatsapp.length<10||customer.whatsapp.length>13)throw new Error('Informe um WhatsApp válido com DDD.');
 if(!customer.city||!/^[A-Z]{2}$/.test(customer.uf))throw new Error('Informe cidade e UF.');
 if(customer.document&&![11,14].includes(customer.document.length))throw new Error('Informe um CPF ou CNPJ válido.');
 if(!Array.isArray(raw.items)||!raw.items.length||raw.items.length>200)throw new Error('Adicione pelo menos uma peça ao pedido.');
 const seen=new Set<string>(),perProduct=new Map<string,number>();
 const items:CatalogLine[]=raw.items.map(value=>{
  const item=value as Record<string,unknown>,product=catalog.products.find(product=>product.id===item.productId),variant=product?.variants.find(variant=>variant.id===item.variantId);
  if(!product||!variant)throw new Error('Uma peça escolhida não está mais disponível. Atualize o catálogo.');
  if(seen.has(variant.id))throw new Error('Agrupe a quantidade da mesma cor e tamanho.');seen.add(variant.id);
  const qty=integer(item.qty,1,100000);if(qty>variant.stock)throw new Error(`Estoque insuficiente para ${product.name}, ${variant.color} ${variant.size}.`);
  perProduct.set(product.id,(perProduct.get(product.id)||0)+qty);
  return{productId:product.id,variantId:variant.id,name:product.name,color:variant.color,size:variant.size,qty,unitPrice:product.price,total:product.price*qty};
 });
 for(const [productId,qty] of perProduct){const product=catalog.products.find(value=>value.id===productId)!;if(product.minimum>0&&qty<product.minimum)throw new Error(`${product.name} exige no mínimo ${product.minimum} peças.`)}
 const totalQty=items.reduce((sum,item)=>sum+item.qty,0),total=items.reduce((sum,item)=>sum+item.total,0);
 if(totalQty<catalog.minimumQty||total<catalog.minimumValue)throw new Error('O pedido não atingiu o mínimo configurado pela loja.');
 return{customer,items,totalQty,total};
}

const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export function formatCatalogOrder(order:CatalogOrder,storeName:string){
 const grouped=new Map<string,CatalogLine[]>();for(const item of order.items)grouped.set(item.name,[...(grouped.get(item.name)||[]),item]);
 const products=[...grouped.entries()].flatMap(([name,items])=>[name,...items.map(item=>`${item.qty}x ${item.color} ${item.size}`),'']).join('\n').trim();
 return[`Novo pedido #${order.number||''}`.trim(),`Cliente: ${order.customer.name}`,`${order.customer.city}/${order.customer.uf}`,'',products,'',`Total: ${order.totalQty} ${order.totalQty===1?'peça':'peças'}`,`Valor: ${money(order.total)}`,'',`Catálogo: ${storeName}`].join('\n');
}

export function whatsappLink(phone:string,message:string){const digits=phone.replace(/\D/g,'');return`https://wa.me/${digits.length<=11?'55'+digits:digits}?text=${encodeURIComponent(message)}`}
