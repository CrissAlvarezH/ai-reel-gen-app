// The creator's profile and voice, set in Ajustes and read by the agent's prompts and the tools. Per project
// (projects/<id>/, workspace.ts):
//   config/profile.json: who makes the videos, in what language, for which platform and audience, caption rules,
//                        and the style new videos start in.
//   config/voice.json:   the narration voice (ElevenLabs id, model, settings) and its measured pace.
//   videos/<slug>/voice.json: optional, a video narrated with another voice (merged over the project's).
//   config/images.json:  enabled image API integrations (web search is always available).
//   config/social.json:  where Inspiración and Mi cuenta download reels from (Apify or ScrapeCreators).
//   config/chat.json:    the model and effort last chosen in a conversation, per agent.
//   config/checks.json:  the model each script review (Alineación con tu audiencia, Fuerza del gancho) runs on, per agent.
//   config/chrome.json:  whether this project's agent may use Chrome. On unless it was turned off here.
// A project without its own images.json or social.json follows the workspace's config/ (where they were before
// they were per project) until it's changed there.
// tools/tts.py reads the same files. Only imports workspace.ts, platform.ts and scaffold.ts (the other server modules import this one).
import fs from 'node:fs';
import path from 'node:path';
import {IMAGE_SOURCES, SOCIAL_SOURCES, platformFormat, type Format, type ImageSources, type Profile, type SocialSourceId, type Voice, type VoiceRef} from '../shared/types.ts';

import {CONFIG, GLOBAL_CONFIG, STYLES, VIDEOS, appConfig} from './workspace.ts';
import {readJson, writeJson} from './platform.ts';
import {cleanFormat} from './scaffold.ts';

const PROFILE = () => path.join(CONFIG, 'profile.json');
const VOICE = () => path.join(CONFIG, 'voice.json');
const IMAGES = () => path.join(CONFIG, 'images.json');
const SOCIAL = () => path.join(CONFIG, 'social.json');
const CHAT = () => path.join(CONFIG, 'chat.json');
const CHECKS = () => path.join(CONFIG, 'checks.json');
const CHROME = () => path.join(CONFIG, 'chrome.json');
const orWorkspace = (file: string) => (fs.existsSync(file) ? file : path.join(GLOBAL_CONFIG, path.basename(file)));
const videoVoiceFile = (slug: string) => path.join(VIDEOS, slug, 'voice.json');

export const DEFAULT_PROFILE: Profile = {
  name: '',
  language: 'español',
  platform: 'Instagram Reels',
  audience: '',
  duration: 60,
  caption: 'Gancho en las dos primeras líneas, una lista corta con los puntos del video, una pregunta y una llamada a guardarlo, unos 12 hashtags, y una línea de créditos con autor y licencia de cada imagen que lo pida.',
  notes: '',
  format: platformFormat('Instagram Reels'),
  style: null,
};

export const DEFAULT_VOICE: Voice = {
  enabled: true,
  voiceId: null,
  voiceName: null,
  // The settings Cristian approved for narration (eleven_v4 a bit faster than normal, no extra style);
  // each person still chooses their own voice.
  model: 'eleven_v4',
  speed: 1.16,
  stability: 0.5,
  similarity: 0.75,
  style: 0,
  speakerBoost: true,
  wordsPerSec: 2.9, // measured with those settings; the sample in Ajustes → Voz measures each voice's own
};

// A settings file's fields ({} when missing or not an object).
function readFields<T>(p: string): Partial<T> {
  const v = readJson<Partial<T>>(p);
  return v && typeof v === 'object' ? v : {};
}

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/* ───── Profile ───── */

export function getProfile(): Profile {
  const p = {...DEFAULT_PROFILE, ...readFields<Profile>(PROFILE())};
  return {...p, format: formatFields(p.format) ?? platformFormat(p.platform), style: typeof p.style === 'string' && p.style ? p.style : null};
}

// The project's default style: null to go back to the workspace's; an id must be a style in styles/.
function styleField(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,60}$/.test(v) && fs.existsSync(path.join(STYLES, v, 'style.json'))) return v;
  throw Object.assign(new Error('ese estilo no existe'), {status: 400});
}

// A valid format, or undefined: the same check scripts/new-video.mjs makes when a video is created.
const formatFields = cleanFormat;

export function setProfile(input: unknown): Profile {
  const i = (input ?? {}) as Record<string, unknown>;
  const next = {
    ...getProfile(),
    ...clean({
      name: str(i.name, 80),
      language: str(i.language, 40),
      platform: str(i.platform, 60),
      audience: str(i.audience, 300),
      duration: num(i.duration, 10, 600),
      caption: str(i.caption),
      notes: str(i.notes),
      format: formatFields(i.format),
      style: styleField(i.style),
    }),
  };
  if (!next.language) next.language = DEFAULT_PROFILE.language;
  writeJson(PROFILE(), next);
  return next;
}

// The format a new video starts with (written to its src/format.json).
export const newVideoFormat = () => getProfile().format;
export const formatText = (f: Format) => `${f.width}×${f.height}, ${f.fps} fps, ${f.lufs} LUFS`;

// How the agent's prompts name the creator.
export const authorName = () => getProfile().name || 'El autor';

/* ───── Voice ───── */

export const getVoice = (): Voice => ({...DEFAULT_VOICE, ...readFields<Voice>(VOICE())});

const voiceFields = (i: Record<string, unknown>): Partial<Voice> =>
  clean({
    enabled: typeof i.enabled === 'boolean' ? i.enabled : undefined,
    voiceId: i.voiceId === null ? null : str(i.voiceId, 80),
    voiceName: i.voiceName === null ? null : str(i.voiceName, 120),
    model: str(i.model, 80),
    speed: num(i.speed, 0.7, 1.2),
    stability: num(i.stability, 0, 1),
    similarity: num(i.similarity, 0, 1),
    style: num(i.style, 0, 1),
    speakerBoost: typeof i.speakerBoost === 'boolean' ? i.speakerBoost : undefined,
    wordsPerSec: num(i.wordsPerSec, 0.5, 6),
  });

export function setVoice(input: unknown): Voice {
  const next = {...getVoice(), ...voiceFields((input ?? {}) as Record<string, unknown>)};
  writeJson(VOICE(), next);
  return next;
}

// A video's voice: the global one, with the video's own voice.json (if any) over it. Whether voice is
// generated at all is only set globally.
export function videoVoice(slug: string): Voice & {own: boolean} {
  const global = getVoice();
  const own = readFields<Voice>(videoVoiceFile(slug));
  return {...global, ...own, enabled: global.enabled, own: !!own.voiceId};
}
export function voiceRef(slug: string): VoiceRef | null {
  const v = videoVoice(slug);
  return v.voiceId ? {id: v.voiceId, name: v.voiceName ?? v.voiceId, own: v.own} : null;
}

// Narrate one video with another voice (id + name), or go back to the global one (null).
export function setVideoVoice(slug: string, voice: {voiceId: string; voiceName: string} | null) {
  const f = videoVoiceFile(slug);
  if (!voice) fs.rmSync(f, {force: true});
  else writeJson(f, {voiceId: str(voice.voiceId, 80), voiceName: str(voice.voiceName, 120)});
  return voiceRef(slug);
}

/* ───── Image sources ───── */

// All on except generated images (the tools in tools/ read the same file and default).
const DEFAULT_IMAGES = Object.fromEntries(IMAGE_SOURCES.map((s) => [s.id, s.id !== 'generated'])) as ImageSources;

export const getImageSources = (): ImageSources => {
  const saved = readFields<ImageSources>(orWorkspace(IMAGES()));
  return Object.fromEntries(IMAGE_SOURCES.map((s) => [s.id, !s.key || (typeof saved[s.id] === 'boolean' ? saved[s.id] : DEFAULT_IMAGES[s.id])])) as ImageSources;
};

export function setImageSources(input: unknown): ImageSources {
  const i = (input ?? {}) as Record<string, unknown>;
  const next = getImageSources();
  for (const s of IMAGE_SOURCES) if (s.key && typeof i[s.id] === 'boolean') next[s.id] = i[s.id] as boolean;
  writeJson(IMAGES(), next);
  return next;
}

/* ───── The model and effort last chosen ───── */

// New conversations start with it. A project that hasn't chosen yet follows the app's old, machine-wide choice.
type ChatChoice = {model: string; effort: string};
export const lastChatChoice = (agent: string): ChatChoice | undefined => readFields<Record<string, ChatChoice>>(CHAT())[agent] ?? appConfig().chat?.[agent];
export const setLastChatChoice = (agent: string, choice: ChatChoice) => writeJson(CHAT(), {...readFields<Record<string, ChatChoice>>(CHAT()), [agent]: choice});
// '' (or nothing saved): the review's default. Model ids belong to an agent, so each agent keeps its own.
export const checkModel = (agent: string, check: string): string => {
  const m = readFields<Record<string, Record<string, unknown>>>(CHECKS())[agent]?.[check];
  return typeof m === 'string' ? m : '';
};
export function setCheckModel(agent: string, check: string, model: string) {
  const all = readFields<Record<string, Record<string, string>>>(CHECKS());
  writeJson(CHECKS(), {...all, [agent]: {...all[agent], [check]: model}});
}

/* ───── Chrome ───── */

export const getChromeAccess = () => readFields<{enabled?: unknown}>(CHROME()).enabled !== false;

export function setChromeAccess(enabled: unknown): boolean {
  if (typeof enabled !== 'boolean') throw Object.assign(new Error('valor no válido'), {status: 400});
  writeJson(CHROME(), {enabled});
  return enabled;
}

/* ───── Social-media scraper ───── */

// The one chosen; before any choice, the first with a key (hasKey: settings.getKey, passed in so this module
// doesn't import settings.ts), else Apify.
export function getSocialSource(hasKey: (name: string) => boolean): SocialSourceId {
  const saved = readFields<{source?: string}>(orWorkspace(SOCIAL())).source;
  const known = SOCIAL_SOURCES.find((s) => s.id === saved);
  return (known ?? SOCIAL_SOURCES.find((s) => hasKey(s.key)) ?? SOCIAL_SOURCES[0]).id;
}

export function setSocialSource(id: unknown): SocialSourceId {
  const s = SOCIAL_SOURCES.find((x) => x.id === id);
  if (!s) throw Object.assign(new Error('fuente desconocida'), {status: 400});
  writeJson(SOCIAL(), {source: s.id});
  return s.id;
}
