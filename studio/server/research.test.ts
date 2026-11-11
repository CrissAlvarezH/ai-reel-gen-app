// Investigación: the platforms' answers in one shape, the score, and a research from its topic to its report, in its own
// project whichever is open. ScrapeCreators and the agent faked; temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-research-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
const write = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), {recursive: true});
  fs.writeFileSync(path.join(root, p), typeof v === 'string' ? v : JSON.stringify(v));
};
write('.env', 'SCRAPECREATORS_API_KEY=fake\n'); // no Apify: Instagram can't search
for (const id of ['uno', 'dos']) {
  write(`projects/${id}/project.json`, {name: id, created: id === 'uno' ? 1 : 2});
  write(`projects/${id}/config/profile.json`, {name: 'Cristian', language: 'español', platform: 'Instagram Reels', audience: 'Colombianos que quieren comprar vivienda', duration: 60});
  write(`projects/${id}/config/audience.json`, {onboarded: true, result: 'comprar casa', wants: [{want: 'ahorrar la cuota inicial', so1: '', so2: ''}], problems: ['pagar arriendo toda la vida']});
}

const now = Math.floor(Date.now() / 1000);
// TikTok: a good one, a duplicate from the second search, one too old for 30 days, one too long, one from another country.
const tt = (id: string, o: {plays: number; followers: number; days?: number; ms?: number; region?: string; user?: string}) => ({
  aweme_info: {
    aweme_id: id,
    desc: `Video ${id} sobre la cuota inicial`,
    create_time: now - (o.days ?? 3) * 86400,
    region: o.region ?? 'CO',
    author: {unique_id: o.user ?? `autor${id}`, nickname: `Autor ${id}`, follower_count: o.followers},
    statistics: {play_count: o.plays, digg_count: o.plays / 20, comment_count: 10, share_count: o.plays / 100, collect_count: o.plays / 50},
    video: {duration: o.ms ?? 45_000, play_addr: {url_list: ['https://v.test/v.mp4']}, cover: {url_list: ['https://p.test/c.heic', 'https://p.test/c~tplv:500:800.jpeg?x=1']}},
  },
});
const SEARCH: Record<string, unknown[]> = {
  'cuota inicial': [tt('1001', {plays: 2_900_000, followers: 71_000}), tt('1002', {plays: 40_000, followers: 500_000}), tt('1003', {plays: 900_000, followers: 1000, days: 60})],
  'subsidio vivienda': [tt('1001', {plays: 2_900_000, followers: 71_000}), tt('1004', {plays: 300_000, followers: 12_000, ms: 700_000}), tt('1005', {plays: 330_000, followers: 12_000, region: 'HN'})],
};
const SHORTS = {shorts: [{type: 'short', id: 'yt_AAAAAAA', title: 'Translated title', viewCountInt: 3600}, {type: 'short', id: 'yt_BBBBBBB', viewCountInt: 100}]};
const short = (id: string) => ({id, title: `Así se compra casa ${id}`, description: 'sin cuota inicial', likeCountInt: 125, commentCountInt: 10, viewCountInt: id === 'yt_AAAAAAA' ? 3601 : 120, publishDate: new Date(Date.now() - 2 * 86400_000).toISOString(), channel: {handle: '@MisFinanzas', title: 'Mis Finanzas'}, durationMs: 58_000});
const calls: string[] = [];
globalThis.fetch = (async (u: string | URL) => {
  const url = new URL(String(u));
  calls.push(url.pathname + url.search);
  if (url.hostname.endsWith('.test')) return new Response(new Uint8Array([0xff, 0xd8, 0xff]));
  if (url.hostname === 'i.ytimg.com') return new Response(new Uint8Array([0xff, 0xd8, 0xff]));
  if (url.pathname === '/v1/tiktok/search/keyword') return Response.json({search_item_list: SEARCH[url.searchParams.get('query')!] ?? []});
  if (url.pathname === '/v1/youtube/search') return Response.json(SHORTS);
  if (url.pathname === '/v1/youtube/video') return Response.json(short(url.searchParams.get('url')!.split('/').pop()!));
  return new Response('{}', {status: 404});
}) as typeof fetch;

const asked: string[] = [];
async function fakeAgent() {
  const {agentCli} = await import('./agent.ts');
  agentCli.ask = async (prompt: string) => {
    asked.push(prompt);
    if (prompt.includes('Propose 4 to 6 searches')) return '```json\n{"queries": ["cuota inicial", "subsidio vivienda", "cuota inicial"], "country": "co"}\n```';
    if (prompt.includes('useful to study')) {
      const keys = [...prompt.matchAll(/^((?:tiktok|youtube)-\S+) \|/gm)].map((m) => m[1]);
      return JSON.stringify(Object.fromEntries(keys.map((k) => [k, k === 'tiktok-1005' ? [false, 'es de Honduras'] : [true, 'habla de la cuota inicial']])));
    }
    return '## Los mejores videos\n\n1. [tiktok-1001] arriendo vs cuota';
  };
}

async function idle(r: typeof import('./research.ts'), project: string | undefined, id: string) {
  for (let i = 0; i < 200; i++) {
    const d = r.detail(project, id);
    if (!d.job) return d;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('la investigación no terminó');
}

test('the platforms in one shape', async () => {
  const pf = await import('./research-platforms.ts');
  const t = pf.fromTikTok(tt('77', {plays: 1000, followers: 10, ms: 83_300}).aweme_info, 'q')!;
  assert.equal(t.url, 'https://www.tiktok.com/@autor77/video/77');
  assert.equal(t.duration, 83.3); // milliseconds → seconds
  assert.equal(t.saves, 20);
  assert.equal(t.displayUrl, 'https://p.test/c~tplv:500:800.jpeg?x=1'); // the JPEG, never the HEIC
  const y = pf.fromShort(short('yt_AAAAAAA'), 'q')!;
  assert.equal(y.author, 'misfinanzas');
  assert.equal(y.url, 'https://www.youtube.com/shorts/yt_AAAAAAA');
  assert.equal(y.duration, 58);
  assert.match(y.title, /^Así se compra casa/); // the real title, not the search's translation
  const ig = pf.fromInstagram({shortCode: 'DdEv9AIDbZd', ownerUsername: 'Leo', caption: 'hola', videoPlayCount: 900, likesCount: -1, commentsCount: 3, videoUrl: 'https://x/v.mp4', timestamp: '2026-09-09T17:01:32.000Z'}, 'q')!;
  assert.equal(ig.author, 'leo');
  assert.equal(ig.likes, null); // hidden likes
  assert.equal(ig.views, 900);
  assert.equal(pf.fromInstagram({ownerUsername: 'x'}, 'q'), null);
});

test('the score ranks against the useful ones, and what a platform lacks weighs on the rest', async () => {
  const r = await import('./research.ts');
  const v = (key: string, views: number, followers: number | null, relevant: boolean | null = true) => ({key, platform: 'tiktok' as const, id: key, url: '', author: key, authorName: null, followers, title: '', posted: new Date(Date.now() - 2 * 86400_000).toISOString(), duration: 30, views, likes: views / 10, comments: 0, shares: 0, saves: 0, region: null, videoUrl: null, displayUrl: null, queries: [], relevant, reason: null, added: 1});
  const out = r.score([v('a', 1_000_000, 10_000), v('b', 10_000, 100_000), v('c', 500_000, null), v('d', 9_000_000, 1000, false)]);
  const by = Object.fromEntries(out.map((x) => [x.v.key, x]));
  assert.ok(by.a.score! > by.c.score! && by.c.score! > by.b.score!);
  assert.equal(by.a.ratio, 100);
  assert.equal(by.c.ratio, null); // no followers: its score comes from the rest
  assert.ok(by.c.score! > 0);
  // Judged against the useful ones without being one of them: above all of them (its interaction ties with theirs).
  assert.equal(by.d.score, 90);
  // Every value tied: right in the middle.
  assert.deepEqual(r.score([v('x', 10, 10), v('y', 10, 10)]).map((s) => s.score), [50, 50]);
});

test('a research: searches from the agent, search, filters, report; in its own project', async () => {
  await fakeAgent();
  const ws = await import('./workspace.ts');
  const r = await import('./research.ts');
  ws.openProject('uno');

  assert.throws(() => r.create(undefined, {topic: '  '}), /escribe el tema/);
  const created = r.create(undefined, {topic: 'Ahorrar para la cuota inicial', platforms: ['tiktok', 'youtube', 'instagram'], sinceDays: 30});
  let d = await idle(r, undefined, created.id);
  assert.deepEqual(d.queries, ['cuota inicial', 'subsidio vivienda']); // the agent's, without repeats
  assert.equal(d.options.country, 'CO');
  assert.match(asked[0], /ahorrar la cuota inicial/); // it knows the audience

  const est = await r.estimate(undefined, d.id);
  assert.deepEqual(est.lines.map((l) => l.platform), ['tiktok', 'youtube', 'instagram']);
  assert.match(est.lines[0].text, /2 créditos/);

  r.search(undefined, d.id);
  assert.throws(() => r.search(undefined, d.id), /ya está trabajando/);
  d = await idle(r, undefined, d.id);
  assert.equal(d.error, null);
  assert.ok(calls.some((c) => c.includes('region=CO') && c.includes('/tiktok/')));
  const keys = d.videos.map((v) => v.key).sort();
  // 1003 too old for 30 days, 1004 longer than 3 minutes; 1001 found by both searches is one.
  assert.deepEqual(keys, ['tiktok-1001', 'tiktok-1002', 'tiktok-1005', 'youtube-yt_AAAAAAA', 'youtube-yt_BBBBBBB']);
  const top = d.videos[0];
  assert.equal(top.key, 'tiktok-1001');
  assert.deepEqual(top.queries.sort(), ['cuota inicial', 'subsidio vivienda']);
  assert.equal(top.thumb, true);
  const hn = d.videos.find((v) => v.key === 'tiktok-1005')!;
  assert.equal(hn.relevant, false);
  assert.equal(hn.reason, 'es de Honduras');
  assert.equal(d.counts.relevant, 4);
  const ig = d.runs.find((x) => x.platform === 'instagram')!;
  assert.match(ig.error!, /falta la clave de Apify/);
  assert.equal(d.runs.find((x) => x.platform === 'tiktok')!.found, 3);
  // The video's own file keeps what tools/inspiration.py needs.
  const reel = JSON.parse(fs.readFileSync(path.join(root, 'projects/uno/research', d.id, 'videos/tiktok-1001/reel.json'), 'utf8'));
  assert.equal(reel.videoUrl, 'https://v.test/v.mp4');
  assert.equal(reel.platform, 'tiktok');

  // He corrects the agent: it enters the ranking. Searching again keeps his word.
  r.setRelevant(undefined, d.id, 'tiktok-1005', true);
  r.search(undefined, d.id);
  d = await idle(r, undefined, d.id);
  assert.equal(d.videos.find((v) => v.key === 'tiktok-1005')!.relevant, true);

  // Nothing to analyse without a transcriber; the report from the metrics.
  await assert.rejects(r.analyse(undefined, d.id, {top: 0}), /de 1 a/);
  await assert.rejects(r.analyse(undefined, d.id, {top: 2}), /falta la transcripción/);
  r.report(undefined, d.id);
  d = await idle(r, undefined, d.id);
  assert.match(d.report!.text, /\[tiktok-1001\]/);
  assert.match(asked.at(-1)!, /Todavía no se analizó ninguno/);

  // The agent of the other project works there, whichever is open.
  const other = r.create('dos', {topic: 'Subsidios', queries: ['mi casa ya']});
  assert.equal((await r.status()).researches.length, 1);
  assert.equal((await r.status('dos')).researches[0].id, other.id);
  assert.throws(() => r.detail(undefined, other.id), /no encontrada/);
  assert.ok(fs.existsSync(path.join(root, 'projects/dos/research', other.id, 'research.json')));

  r.remove(undefined, d.id);
  assert.equal((await r.status()).researches.length, 0);
});
