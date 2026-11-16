// Adiciona um login ao mural. Só aceita login válido do GitHub; nada de texto livre.
import { readFile, writeFile } from 'node:fs/promises';

const login = process.env.LOGIN || '';
if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login) || login.endsWith('[bot]')) {
  console.log('login ignorado'); process.exit(0);
}
const mural = JSON.parse(await readFile('data/mural.json', 'utf8').catch(() => '[]'));
const sem = mural.filter((l) => l.toLowerCase() !== login.toLowerCase());
sem.push(login);
await writeFile('data/mural.json', JSON.stringify(sem.slice(-200), null, 2) + '\n');
console.log(`mural: ${login} (${sem.length})`);
