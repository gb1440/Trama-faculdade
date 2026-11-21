import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyAction,emptyState} from '../lib/domain.ts';
import {buildCatalogProducts,normalizeCatalogLogo,normalizeCatalogSlug,publicCatalogImage,validateCatalogOrder,formatCatalogOrder} from '../lib/catalog.ts';

function fixture(){
 let state=applyAction(emptyState(),{action:'product',name:'Conjunto Luna',code:'IGNORADO',category:'Conjuntos',photo:'',cost:2000,retail:5990,wholesale:3990,minimum:2,orderMinimum:2,catalogVisible:true,variants:[{color:'Preto',size:'M',stock:3},{color:'Bege',size:'G',stock:8},{color:'Branco',size:'P',stock:0}]});
 state=applyAction(state,{action:'product',name:'Produto oculto',code:'IGNORADO2',category:'Outros',photo:'',cost:1000,retail:2000,wholesale:1500,minimum:1,catalogVisible:false,variants:[{color:'Azul',size:'M',stock:5}]});
 return state;
}

test('catalog slug is readable, normalized and safely bounded',()=>{
 assert.equal(normalizeCatalogSlug(' Coleção Luna 2026! '),'colecao-luna-2026');
 assert.equal(normalizeCatalogSlug('---'),'');
 assert.equal(normalizeCatalogSlug('A'.repeat(80)).length,60);
});

test('catalog logo accepts a safe upload reference and becomes a public URL',()=>{
 const reference='storage:product-images/11111111-1111-4111-8111-111111111111/catalog-logos/22222222-2222-4222-8222-222222222222.webp';
 assert.equal(normalizeCatalogLogo(reference),reference);
 assert.equal(publicCatalogImage(reference,'https://example.supabase.co'),'https://example.supabase.co/storage/v1/object/public/product-images/11111111-1111-4111-8111-111111111111/catalog-logos/22222222-2222-4222-8222-222222222222.webp');
 assert.equal(normalizeCatalogLogo('https://site.example/logo.png'),'https://site.example/logo.png');
 assert.equal(normalizeCatalogLogo(''),'');
 assert.throws(()=>normalizeCatalogLogo('javascript:alert(1)'),/logo/i);
});

test('catalog publishes only visible products and in-stock variations without private costs',()=>{
 const products=buildCatalogProducts(fixture(),'Atacado');
 assert.equal(products.length,1);
 assert.equal(products[0].name,'Conjunto Luna');
 assert.equal(products[0].price,3990);
 assert.deepEqual(products[0].variants.map(v=>v.stock),[3,8]);
 assert.equal('cost' in products[0],false);
});

test('order total is recalculated from current catalog and duplicate or unavailable lines fail',()=>{
 const products=buildCatalogProducts(fixture(),'Atacado'),catalog={storeName:'Trama',minimumQty:4,minimumValue:10000,products};
 const customer={name:'Loja Bella Moda',whatsapp:'85999999999',city:'Fortaleza',uf:'CE',document:''};
 const items=[{productId:products[0].id,variantId:products[0].variants[0].id,qty:2},{productId:products[0].id,variantId:products[0].variants[1].id,qty:3}];
 const order=validateCatalogOrder(catalog,{customer,items});
 assert.equal(order.totalQty,5);
 assert.equal(order.total,19950);
 assert.equal(order.items[0].unitPrice,3990);
 assert.throws(()=>validateCatalogOrder(catalog,{customer,items:[items[0],items[0]]}),/Agrupe/);
 assert.throws(()=>validateCatalogOrder(catalog,{customer,items:[{...items[0],qty:4}]}),/estoque/i);
 assert.throws(()=>validateCatalogOrder(catalog,{customer,items:[{...items[0],qty:2}]}),/mínimo/i);
});

test('customer data and merchant WhatsApp message are formatted for daily use',()=>{
 const products=buildCatalogProducts(fixture(),'Atacado'),catalog={storeName:'Trama',minimumQty:1,minimumValue:0,products};
 const order=validateCatalogOrder(catalog,{customer:{name:'Loja Bella Moda',whatsapp:'(85) 99999-9999',city:'Fortaleza',uf:'ce',document:'12.345.678/0001-90'},items:[{productId:products[0].id,variantId:products[0].variants[0].id,qty:2}]});
 assert.equal(order.customer.whatsapp,'85999999999');
 assert.equal(order.customer.uf,'CE');
 const message=formatCatalogOrder({...order,number:1045},catalog.storeName);
 assert.match(message,/Novo pedido #1045/);
 assert.match(message,/2x Preto M/);
 assert.match(message,/Total: 2 peças/);
 assert.throws(()=>validateCatalogOrder(catalog,{customer:{name:'',whatsapp:'1',city:'',uf:''},items:[]}),/nome/i);
});
