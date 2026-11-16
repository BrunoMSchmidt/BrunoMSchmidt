// Gera a ficha (SVG claro/escuro), o terminal animado e atualiza o README.
// Uso: GH_TOKEN=... node scripts/gerar.mjs
// Nunca escreve nome de repositório: repos privados entram só como números agregados.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const LOGIN = 'BrunoMSchmidt';
const CARREIRA_INICIO = '2021-08-01'; // base do "nível" (anos de experiência)
const PERFIL = {
  nome: 'Bruno Schmidt',
  titulo: 'Desenvolvedor de Software',
  local: 'Paraíso/SC',
  classe: 'Full-stack',
  passivas: ['Academia', 'Jogos', 'Side projects'],
};

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) throw new Error('Defina GH_TOKEN');

async function gql(query, variables) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const hoje = new Date();
const umAnoAtras = new Date(hoje.getTime() - 365 * 864e5);

const { user: { id: userId } } = await gql(`query($l:String!){ user(login:$l){ id } }`, { l: LOGIN });

const { user } = await gql(
  `query($login:String!,$from:DateTime!,$to:DateTime!,$uid:ID!,$since:GitTimestamp!){
    user(login:$login){
      avatarUrl(size:240)
      contributionsCollection(from:$from,to:$to){
        contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
      }
      repositories(first:100,ownerAffiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER],isFork:false,orderBy:{field:PUSHED_AT,direction:DESC}){
        nodes{
          pushedAt
          languages(first:8,orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name color } } }
          defaultBranchRef{ target{ ... on Commit{ history(since:$since,author:{id:$uid}){ totalCount } } } }
        }
      }
    }
  }`,
  { login: LOGIN, from: umAnoAtras.toISOString(), to: hoje.toISOString(), uid: userId, since: umAnoAtras.toISOString() },
);

// ---------- números ----------
const cc = user.contributionsCollection;
const dias = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
const total = cc.contributionCalendar.totalContributions;
const ativos = dias.filter((d) => d.contributionCount > 0).length;

let maiorStreak = 0, corrida = 0;
for (const d of dias) {
  corrida = d.contributionCount > 0 ? corrida + 1 : 0;
  maiorStreak = Math.max(maiorStreak, corrida);
}
let streakAtual = 0;
for (let i = dias.length - 1; i >= 0; i--) {
  if (dias[i].contributionCount > 0) streakAtual++;
  else if (i === dias.length - 1) continue; // hoje ainda sem commit não quebra
  else break;
}

// repos (seus, de org e de colaborador) onde você commitou no último ano.
// Privados só aparecem com STATS_TOKEN; nomes nunca saem daqui.
const recentes = user.repositories.nodes
  .map((r) => ({ ...r, commits: r.defaultBranchRef?.target?.history?.totalCount || 0 }))
  .filter((r) => r.commits > 0);
const reposTocados = recentes.length;

// stack: peso = seus commits no repo × fatia da linguagem no repo
const IGNORA = new Set(['HTML', 'CSS', 'SCSS', 'Dockerfile', 'Shell', 'PowerShell', 'Batchfile', 'Makefile']);
const peso = new Map();
for (const { languages, commits } of recentes) {
  const edges = languages.edges.filter((e) => !IGNORA.has(e.node.name));
  const totalSize = edges.reduce((a, e) => a + e.size, 0);
  if (!totalSize) continue;
  for (const { size, node } of edges) {
    const p = peso.get(node.name) || { v: 0, cor: node.color || '#888' };
    p.v += commits * (size / totalSize);
    peso.set(node.name, p);
  }
}
const somaPeso = [...peso.values()].reduce((a, b) => a + b.v, 0) || 1;
const stack = [...peso.entries()]
  .map(([nome, { v, cor }]) => ({ nome, cor, pct: (v / somaPeso) * 100 }))
  .sort((a, b) => b.pct - a.pct)
  .filter((l) => l.pct >= 1)
  .slice(0, 5);

// nível = anos completos de carreira; xp = progresso até o próximo aniversário
const inicio = new Date(CARREIRA_INICIO);
let nivel = hoje.getFullYear() - inicio.getFullYear();
const aniv = new Date(inicio); aniv.setFullYear(inicio.getFullYear() + nivel);
if (aniv > hoje) { nivel--; aniv.setFullYear(aniv.getFullYear() - 1); }
const prox = new Date(aniv); prox.setFullYear(aniv.getFullYear() + 1);
const xp = (hoje - aniv) / (prox - aniv);
const diasProNivel = Math.ceil((prox - hoje) / 864e5);

const avatarB64 = Buffer.from(await (await fetch(user.avatarUrl)).arrayBuffer()).toString('base64');

// ---------- SVG ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n) => n.toLocaleString('pt-BR');

const TEMAS = {
  escuro: { bg: '#0d1117', card: '#161b22', borda: '#30363d', txt: '#e6edf3', sub: '#8b949e', ac: '#f0b429', ac2: '#58a6ff', trilho: '#21262d' },
  claro: { bg: '#ffffff', card: '#f6f8fa', borda: '#d0d7de', txt: '#1f2328', sub: '#59636e', ac: '#b7791f', ac2: '#0969da', trilho: '#eaeef2' },
};
const MONO = `ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace`;
const SANS = `-apple-system,'Segoe UI',Helvetica,Arial,sans-serif`;

function ficha(t) {
  const W = 860, H = 400;
  const stats = [
    { rot: 'ATAQUE', val: fmt(total), sub: 'contribuições em 365d' },
    { rot: 'CONSTÂNCIA', val: `${Math.round((ativos / dias.length) * 100)}%`, sub: `${ativos} dias ativos no ano` },
    { rot: 'COMBO', val: `${streakAtual}d`, sub: `recorde: ${maiorStreak} dias seguidos` },
    { rot: 'MAPAS', val: fmt(reposTocados), sub: 'projetos mexidos no ano' },
  ];
  const statBox = (s, i) => {
    const x = 330 + (i % 2) * 260, y = 40 + Math.floor(i / 2) * 82;
    return `<g class="in" style="animation-delay:${0.15 + i * 0.1}s">
      <rect x="${x}" y="${y}" width="245" height="70" rx="10" fill="${t.card}" stroke="${t.borda}"/>
      <text x="${x + 16}" y="${y + 22}" class="rot">${s.rot}</text>
      <text x="${x + 16}" y="${y + 50}" class="val">${esc(s.val)}</text>
      <text x="${x + 229}" y="${y + 50}" class="sub" text-anchor="end">${esc(s.sub)}</text>
    </g>`;
  };
  const barras = stack.map((l, i) => {
    const y = 236 + i * 22, w = Math.max(4, (l.pct / stack[0].pct) * 330);
    return `<g class="in" style="animation-delay:${0.6 + i * 0.08}s">
      <text x="330" y="${y + 10}" class="lang">${esc(l.nome)}</text>
      <rect x="440" y="${y}" width="330" height="12" rx="6" fill="${t.trilho}"/>
      <rect x="440" y="${y}" width="${w.toFixed(1)}" height="12" rx="6" fill="${l.cor}" class="barra" style="animation-delay:${0.7 + i * 0.08}s"/>
      <text x="${W - 40}" y="${y + 10}" class="sub" text-anchor="end">${l.pct.toFixed(0)}%</text>
    </g>`;
  }).join('');
  const chips = PERFIL.passivas.map((p, i) => {
    const w = p.length * 6.8 + 24;
    return { p, w };
  });
  let cx = 40;
  const chipsSvg = chips.map(({ p, w }) => {
    const g = `<rect x="${cx}" y="338" width="${w}" height="24" rx="12" fill="none" stroke="${t.borda}"/>
      <text x="${cx + w / 2}" y="354" class="chip" text-anchor="middle">${esc(p)}</text>`;
    cx += w + 8;
    return g;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ficha de ${esc(PERFIL.nome)}: nível ${nivel}, ${fmt(total)} contribuições no último ano">
<style>
  .rot{font:700 11px ${MONO};fill:${t.sub};letter-spacing:1.5px}
  .val{font:700 24px ${SANS};fill:${t.txt}}
  .sub{font:12px ${SANS};fill:${t.sub}}
  .lang{font:600 12px ${MONO};fill:${t.txt}}
  .chip{font:600 12px ${SANS};fill:${t.sub}}
  .nome{font:800 24px ${SANS};fill:${t.txt}}
  .tit{font:14px ${SANS};fill:${t.sub}}
  .sec{font:700 11px ${MONO};fill:${t.ac};letter-spacing:2px}
  .in{animation:in .5s ease-out backwards}
  .barra{transform-box:fill-box;transform-origin:left;animation:enche .9s cubic-bezier(.2,.8,.2,1) backwards}
  .xp{transform-box:fill-box;transform-origin:left;animation:enche 1.4s .3s cubic-bezier(.2,.8,.2,1) backwards}
  .pulso{animation:pulso 2.4s ease-in-out infinite}
  @keyframes in{from{opacity:0;transform:translateY(6px)}}
  @keyframes enche{from{transform:scaleX(0)}}
  @keyframes pulso{50%{opacity:.35}}
  @media (prefers-reduced-motion:reduce){.in,.barra,.xp,.pulso{animation:none}}
</style>
<defs><clipPath id="av"><circle cx="110" cy="100" r="56"/></clipPath></defs>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${t.bg}" stroke="${t.borda}"/>

<circle cx="110" cy="100" r="62" fill="none" stroke="${t.ac}" stroke-width="3"/>
<image href="data:image/png;base64,${avatarB64}" x="54" y="44" width="112" height="112" clip-path="url(#av)"/>
<g>
  <rect x="140" y="138" width="56" height="26" rx="13" fill="${t.ac}"/>
  <text x="168" y="156" text-anchor="middle" style="font:800 13px ${SANS};fill:${t.bg}">NV ${nivel}</text>
</g>

<text x="40" y="200" class="nome">${esc(PERFIL.nome)}</text>
<text x="40" y="222" class="tit">${esc(PERFIL.titulo)}</text>
<text x="40" y="242" class="tit">${esc(PERFIL.local)} · classe ${esc(PERFIL.classe)}</text>

<text x="40" y="276" class="rot">XP → NV ${nivel + 1}</text>
<text x="290" y="276" class="sub" text-anchor="end">faltam ${diasProNivel} dias</text>
<rect x="40" y="284" width="250" height="10" rx="5" fill="${t.trilho}"/>
<rect x="40" y="284" width="${(250 * xp).toFixed(1)}" height="10" rx="5" fill="${t.ac}" class="xp"/>

<text x="40" y="326" class="sec">PASSIVAS</text>
${chipsSvg}

<text x="330" y="30" class="sec">ATRIBUTOS</text>
${stats.map(statBox).join('')}

<text x="330" y="222" class="sec">STACK · ÚLTIMOS 365 DIAS</text>
${barras}

<circle cx="${W - 46}" cy="26" r="4" fill="#3fb950" class="pulso"/>
<text x="${W - 56}" y="30" class="sub" text-anchor="end">atualizado ${hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</text>
</svg>`;
}

function terminal(t) {
  const linhas = [
    ['$ whoami', `${PERFIL.nome.toLowerCase()} — dev de software @ ${PERFIL.local.toLowerCase()}`],
    ['$ uptime', `codando há ${nivel} anos, load average: café, café, café`],
    ['$ ps aux | grep bruno', 'side-projects  academia  música  jogos'],
    ['$ git log --since="1 year" | wc -l', `${fmt(total)}  # e contando`],
  ];
  const W = 860, H = 54 + linhas.length * 44;
  let delay = 0.3;
  const corpo = linhas.map(([cmd, out], i) => {
    const y = 58 + i * 44;
    const dCmd = delay, dur = cmd.length * 0.045;
    delay += dur + 0.35;
    const dOut = delay;
    delay += 0.25;
    const chars = cmd.length;
    return `<g>
      <clipPath id="c${i}"><rect x="24" y="${y - 14}" height="20" width="${chars * 8.4 + 4}" class="digita" style="animation-delay:${dCmd.toFixed(2)}s;animation-duration:${dur.toFixed(2)}s;animation-timing-function:steps(${chars})"/></clipPath>
      <text x="24" y="${y}" class="cmd" clip-path="url(#c${i})">${esc(cmd)}</text>
      <text x="24" y="${y + 20}" class="out aparece" style="animation-delay:${dOut.toFixed(2)}s">${esc(out)}</text>
    </g>`;
  }).join('');
  const yCursor = 58 + linhas.length * 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 20}" viewBox="0 0 ${W} ${H + 20}" role="img" aria-label="Terminal: ${esc(linhas.map((l) => l[1]).join('; '))}">
<style>
  .cmd{font:600 14px ${MONO};fill:${t.ac}}
  .out{font:14px ${MONO};fill:${t.txt}}
  .digita{transform-box:fill-box;transform-origin:left;animation-name:enche;animation-fill-mode:backwards}
  .aparece{animation:aparece .2s backwards}
  .cursor{animation:pisca 1s steps(1) infinite}
  @keyframes enche{from{transform:scaleX(0)}}
  @keyframes aparece{from{opacity:0}}
  @keyframes pisca{50%{opacity:0}}
  @media (prefers-reduced-motion:reduce){.digita,.aparece,.cursor{animation:none}}
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H + 19}" rx="12" fill="${t.card}" stroke="${t.borda}"/>
<circle cx="24" cy="20" r="6" fill="#ff5f57"/><circle cx="44" cy="20" r="6" fill="#febc2e"/><circle cx="64" cy="20" r="6" fill="#28c840"/>
<text x="${W / 2}" y="24" text-anchor="middle" style="font:12px ${MONO};fill:${t.sub}">bruno@paraiso: ~</text>
${corpo}
<text x="24" y="${yCursor}" class="cmd">$ <tspan class="cursor">▋</tspan></text>
</svg>`;
}

await mkdir('assets', { recursive: true });
for (const [nome, t] of Object.entries(TEMAS)) {
  await writeFile(`assets/ficha-${nome}.svg`, ficha(t));
  await writeFile(`assets/terminal-${nome}.svg`, terminal(t));
}

// ---------- mural ----------
const mural = JSON.parse(await readFile('data/mural.json', 'utf8').catch(() => '[]'));
const muralMd = mural.length
  ? mural.slice(-60).reverse()
      .map((l) => `<a href="https://github.com/${l}"><img src="https://github.com/${l}.png?size=64" width="40" height="40" alt="@${l}" title="@${l}"/></a>`)
      .join(' ')
  : '<sub>ninguém ainda. seja o primeiro 👀</sub>';

let readme = await readFile('README.md', 'utf8');
readme = readme.replace(/<!-- MURAL:INICIO -->[\s\S]*?<!-- MURAL:FIM -->/, `<!-- MURAL:INICIO -->\n${muralMd}\n<!-- MURAL:FIM -->`);
await writeFile('README.md', readme);

console.log({ nivel, total, ativos, streakAtual, maiorStreak, reposTocados, stack: stack.map((s) => `${s.nome} ${s.pct.toFixed(1)}%`), mural: mural.length });
