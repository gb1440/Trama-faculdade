import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const envFile = new URL('../.env.demo', import.meta.url);

if (!existsSync(envFile)) {
  const painel = randomBytes(32).toString('hex');
  const broker = randomBytes(32).toString('hex');
  writeFileSync(envFile, `TRAMA_DEMO_PASSWORD=${painel}\nRABBITMQ_PASSWORD=${broker}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

const config = parseEnv(readFileSync(envFile, 'utf8'));
const senhaValida = /^[a-f0-9]{64}$/;
const senhaPainel = config.TRAMA_DEMO_PASSWORD ?? '';
if (!senhaValida.test(senhaPainel) || !senhaValida.test(config.RABBITMQ_PASSWORD ?? '')) {
  throw new Error('As senhas de .env.demo devem ter 64 caracteres hexadecimais.');
}

const result = spawnSync('docker', [
  'exec', '-i', 'supabase_db_trama-faculdade', 'psql',
  '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt',
], {
  encoding: 'utf8',
  input: `
    \\set senha ${senhaPainel}
    update auth.users
    set encrypted_password = extensions.crypt(:'senha', extensions.gen_salt('bf')),
        updated_at = now()
    where id = '6820a0ec-240a-48c5-a93c-a7da20cc3221' and email = 'equipe@example.com'
    returning 'ok';
  `,
});

if (result.status !== 0 || result.stdout?.trim() !== 'ok') {
  throw new Error('Não foi possível configurar a conta fictícia. Rode npm run db:start e tente novamente.');
}

console.log('Acessos locais prontos. Consulte as senhas no arquivo .env.demo.');
