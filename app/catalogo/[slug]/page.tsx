import CatalogStorefront from './storefront';
export default async function CatalogPage({params}:{params:Promise<{slug:string}>}){const{slug}=await params;return <CatalogStorefront slug={slug}/>}
