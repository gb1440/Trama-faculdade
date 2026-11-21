import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Trama · Sua loja em ordem',description:'Vendas, estoque, clientes e financeiro para atacado e varejo.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>;}
