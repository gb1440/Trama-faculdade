import type {Metadata} from 'next';
import './catalog.css';

export const metadata:Metadata={
 title:'Nova coleção | Catálogo de moda feminina',
 description:'Descubra cores, tamanhos e peças disponíveis e monte seu pedido online.',
};

export default function CatalogLayout({children}:{children:React.ReactNode}){return children}
