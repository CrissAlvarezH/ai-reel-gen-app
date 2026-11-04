// API keys, "local" mode: entered in the UI and kept in the workspace's .env (gitignored, 0600), where the
// tools already read them. Keys never go back to the browser: only whether each is set, its last 4
// characters, and what the service said when it was checked.
import fs from 'node:fs';
import {httpError} from './reels.ts';
import {ENV} from './workspace.ts';
import type {KeyStatus, Settings} from '../shared/types.ts';


type KeyDef = {label: string; check: (key: string) => Promise<string>};

export const KEYS: Record<string, KeyDef> = {
  ELEVENLABS_API_KEY: {
    label: 'ElevenLabs',
    // GET /v1/user answers with the account's subscription when the key is good.
    check: async (key) => {
      const r = await fetch('https://api.elevenlabs.io/v1/user', {headers: {'xi-api-key': key}});
      if (!r.ok) throw new Error(r.status === 401 ? 'clave rechazada por ElevenLabs' : `ElevenLabs respondió ${r.status}`);
      const u = (await r.json()) as {subscription?: {tier?: string; character_limit?: number; character_count?: number}};
      const sub = u.subscription ?? {};
      const left = sub.character_limit != null ? sub.character_limit - (sub.character_count ?? 0) : null;
      return [sub.tier && `plan ${sub.tier}`, left != null && `${left.toLocaleString('es')} caracteres disponibles`].filter(Boolean).join(' · ') || 'válida';
    },
  },
  PEXELS_API_KEY: {
    label: 'Pexels',
    check: async (key) => {
      const r = await fetch('https://api.pexels.com/v1/search?query=paper&per_page=1', {headers: {Authorization: key}});
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'clave rechazada por Pexels' : `Pexels respondió ${r.status}`);
      const left = r.headers.get('x-ratelimit-remaining');
      return left ? `${Number(left).toLocaleString('es')} búsquedas disponibles este mes` : 'válida';
    },
  },
  PIXABAY_API_KEY: {
    label: 'Pixabay',
    // A bad key answers 400 "[ERROR 400] Invalid or missing API key".
    check: async (key) => {
      const r = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=paper&per_page=3`);
      if (!r.ok) throw new Error(r.status === 400 || r.status === 401 ? 'clave rechazada por Pixabay' : `Pixabay respondió ${r.status}`);
      const left = r.headers.get('x-ratelimit-remaining');
      return left ? `válida · ${left} búsquedas disponibles este minuto` : 'válida';
    },
  },
  UNSPLASH_ACCESS_KEY: {
    label: 'Unsplash',
    check: async (key) => {
      const r = await fetch('https://api.unsplash.com/search/photos?query=paper&per_page=1', {headers: {Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1'}});
      if (!r.ok) throw new Error(r.status === 401 ? 'clave rechazada por Unsplash' : `Unsplash respondió ${r.status}`);
      const left = r.headers.get('x-ratelimit-remaining');
      return left ? `${left} peticiones disponibles esta hora` : 'válida';
    },
  },
  OPENAI_API_KEY: {
    label: 'OpenAI',
    check: async (key) => {
      const r = await fetch('https://api.openai.com/v1/models', {headers: {Authorization: `Bearer ${key}`}});
      if (!r.ok) throw new Error(r.status === 401 ? 'clave rechazada por OpenAI' : `OpenAI respondió ${r.status}`);
      const {data} = (await r.json()) as {data?: {id: string}[]};
      const img = data?.filter((m) => m.id.startsWith('gpt-image')).map((m) => m.id) ?? [];
      return img.length ? `modelos de imagen: ${img.join(', ')}` : 'válida, pero sin modelos gpt-image en esta cuenta';
    },
  },
  SCRAPECREATORS_API_KEY: {
    label: 'ScrapeCreators',
    // The balance call: free, and says what's left.
    check: async (key) => {
      const r = await fetch('https://api.scrapecreators.com/v1/account/credit-balance', {headers: {'x-api-key': key}});
      if (r.status === 401) throw new Error('clave rechazada por ScrapeCreators');
      if (!r.ok) throw new Error(`ScrapeCreators respondió ${r.status}`);
      const b = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      const n = [b.creditCount, b.credits, b.credits_remaining, b.balance].find((v) => typeof v === 'number') as number | undefined;
      return n != null ? `${n.toLocaleString('es')} créditos disponibles` : 'válida';
    },
  },
  APIFY_TOKEN: {
    label: 'Apify',
    check: async (key) => {
      const r = await fetch('https://api.apify.com/v2/users/me', {headers: {Authorization: `Bearer ${key}`}});
      if (!r.ok) throw new Error(r.status === 401 ? 'token rechazado por Apify' : `Apify respondió ${r.status}`);
      const {data} = (await r.json()) as {data?: {username?: string; plan?: {id?: string}}};
      return [data?.username && `usuario ${data.username}`, data?.plan?.id && `plan ${data.plan.id}`].filter(Boolean).join(' · ') || 'válido';
    },
  },
};

function readEnv(): string {
  try {
    return fs.readFileSync(ENV, 'utf8');
  } catch {
    return '';
  }
}

export function getKey(name: string): string | null {
  const m = readEnv().match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*["']?([^"'\\n]*)["']?\\s*$`, 'm'));
  return m?.[1].trim() || null;
}

// Replace or append NAME=value, leaving every other line as it was. Empty value removes the line.
function writeKey(name: string, value: string) {
  const lines = readEnv()
    .split('\n')
    .filter((l, i, a) => !(i === a.length - 1 && l === ''));
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
  const i = lines.findIndex((l) => re.test(l));
  if (value) {
    if (i >= 0) lines[i] = `${name}=${value}`;
    else lines.push(`${name}=${value}`);
  } else if (i >= 0) lines.splice(i, 1);
  fs.writeFileSync(ENV, lines.join('\n') + '\n', {mode: 0o600});
  fs.chmodSync(ENV, 0o600);
}

// Result of the last check per key, so the page can show it without calling the service again.
const checked = new Map<string, NonNullable<KeyStatus['check']>>();

export function status(): Settings {
  return {
    mode: 'local',
    keys: Object.entries(KEYS).map(([name, k]) => {
      const v = getKey(name);
      return {name, label: k.label, set: !!v, last4: v ? v.slice(-4) : null, check: v ? (checked.get(name) ?? null) : null};
    }),
  };
}

export async function verify(name: string): Promise<Settings> {
  const k = KEYS[name];
  if (!k) throw httpError(400, 'clave desconocida');
  const v = getKey(name);
  if (!v) throw httpError(400, `${k.label}: no hay clave guardada`);
  try {
    checked.set(name, {ok: true, info: await k.check(v), at: Date.now()});
  } catch (e) {
    checked.set(name, {ok: false, info: (e as Error).message, at: Date.now()});
  }
  return status();
}

export async function setKey(name: string, value: unknown): Promise<Settings> {
  if (!KEYS[name]) throw httpError(400, 'clave desconocida');
  const v = typeof value === 'string' ? value.trim() : '';
  if (/[\s"'\n]/.test(v)) throw httpError(400, 'la clave no puede tener espacios ni comillas');
  writeKey(name, v);
  checked.delete(name);
  return v ? verify(name) : status();
}
