const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export function serverConfig(){if(!supabaseUrl||!publishableKey)throw new Error('Supabase não configurado.');return{supabaseUrl,publishableKey}}
export function bearer(request:Request){const value=request.headers.get('authorization')||'';return value.startsWith('Bearer ')?value.slice(7):''}
export async function supabaseRest(path:string,token:string,init:RequestInit={}){const config=serverConfig(),headers=new Headers(init.headers);headers.set('apikey',config.publishableKey);headers.set('Authorization',`Bearer ${token||config.publishableKey}`);if(init.body)headers.set('Content-Type','application/json');return fetch(`${config.supabaseUrl}${path}`,{...init,headers,cache:'no-store'})}
export async function authenticatedUser(token:string){if(!token)return null;const response=await supabaseRest('/auth/v1/user',token);return response.ok?await response.json() as {id:string}:null}
export const apiJson=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
