import {useEffect, useRef, useState} from 'react';
import type {AutomationAgent, Audience, AudienceLevels, AudienceWant, PillarSet, ScriptCheckState, HookCheckState, CheckModels, WantOption, Agent, AgentChoice, AgentUsage, AutomationInput, AutomationsView, Beat, IdeaColor, IdeaIcon, IdeaRef, IdeasBoard, ImageSources, InspirationList, InspirationReel, InspirationRef, InspirationStatus, Profile, ReelFormat, Requirement, Style, StyleRef, ChatList, ChatOptions, SocialSourceId, Voice, VoiceModel, VoiceOption, VoiceRef, VoiceSample, ChatState, Comment, ReelDetail, ReelSummary, ServerEvent, Settings, SourceItem, SourceItemDetail, SourceItemList, SourceItemState, SourcesView} from '../shared/types';

export type * from '../shared/types';

async function json<T>(res: Response): Promise<T> {
  // The server always answers JSON; anything else (e.g. while it restarts) is an error, not an empty result.
  const body = await res.json().catch(() => null);
  if (!res.ok || body === null) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  reels: () => fetch('/api/reels').then((r) => json<ReelSummary[]>(r)),
  reel: (slug: string) => fetch(`/api/reels/${slug}`).then((r) => json<ReelDetail>(r)),
  // A new reel from its first message: the server names it and hands the message to its agent.
  // videoFormat: the kind of video (formats/<id>); clips: his recording, staged with uploadClip(), in order;
  // choice: the model and effort picked for it, if he changed them; brief: instructions for the agent only, not shown.
  create: (text: string, context?: unknown, style?: string, videoFormat?: string, clips?: string[], choice?: {model: string; effort: string}, brief?: string) =>
    fetch('/api/reels', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, brief, context, style, videoFormat, clips, ...choice})}).then((r) => json<{slug: string; title: string}>(r)),
  audienceCheck: (slug: string) => fetch(`/api/reels/${slug}/audience-check`).then((r) => json<ScriptCheckState>(r)),
  runAudienceCheck: (slug: string, force = false) => post(`/api/reels/${slug}/audience-check`, {force}) as Promise<ScriptCheckState>,
  // The model each review runs on (its badge): '' = the default.
  checkModels: () => fetch('/api/checks/models').then((r) => json<CheckModels>(r)),
  setCheckModel: (check: 'audience' | 'hook', model: string) =>
    fetch(`/api/checks/${check}/model`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({model})}).then((r) => json<CheckModels>(r)),
  hookCheck: (slug: string) => fetch(`/api/reels/${slug}/hook-check`).then((r) => json<HookCheckState>(r)),
  runHookCheck: (slug: string, force = false) => post(`/api/reels/${slug}/hook-check`, {force}) as Promise<HookCheckState>,
  // Deletes the video and everything of it, for good.
  remove: (slug: string) => fetch(`/api/reels/${slug}`, {method: 'DELETE'}).then((r) => json(r)),
  // The video's visual style (style.txt).
  setStyle: (slug: string, style: string) =>
    fetch(`/api/reels/${slug}/style`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({style})}).then((r) => json<StyleRef>(r)),
  // The voice that narrates the video: its own, or null to use the one in Ajustes.
  setVoice: (slug: string, voice: {voiceId: string; voiceName: string} | null) =>
    fetch(`/api/reels/${slug}/voice`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(voice ?? {})}).then((r) => json<VoiceRef | null>(r)),
  write: (slug: string, path: string, content: string) =>
    fetch(`/api/reels/${slug}/file`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path, content})}).then((r) => json(r)),
  // Opens the reel's folder in the file manager of the machine running the studio.
  reveal: (slug: string) => fetch(`/api/reels/${slug}/reveal`, {method: 'POST'}).then((r) => json(r)),
  revealVersion: (slug: string, url: string) => post(`/api/reels/${slug}/reveal-version`, {url}),
  revealThumbnail: (slug: string) => post(`/api/reels/${slug}/reveal-thumbnail`),
  // Structure tags for a script, suggested by the agent (not saved until the script is).
  suggestBeats: (slug: string, text: string) =>
    fetch(`/api/reels/${slug}/beats/suggest`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text})}).then((r) => json<Beat[]>(r)),
  // Visual styles (styles/<id>/style.json).
  styles: () => fetch('/api/styles').then((r) => json<Style[]>(r)),
  // "Nuevo estilo": a new general conversation where the agent asks for the style and writes it.
  newStyle: (context?: unknown) => post('/api/styles/new', {context}) as Promise<{chat: string}>,
  // Formats: the kinds of video (formats/<id>/format.json).
  formats: () => fetch('/api/formats').then((r) => json<ReelFormat[]>(r)),
  // His recording: to a video's footage/ (slug), or staged for a video Nuevo reel is about to create (no slug).
  uploadClip: (file: File, slug: string | null, onProgress?: (fraction: number) => void) =>
    new Promise<{id?: string; name?: string}>((resolve, reject) => {
      // XHR, not fetch: fetch can't report upload progress, and a clip can take minutes.
      const x = new XMLHttpRequest();
      x.open('POST', `${slug ? `/api/reels/${slug}/footage` : '/api/footage'}?name=${encodeURIComponent(file.name)}`);
      x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => {
        let body: {error?: string; id?: string; name?: string} | null = null;
        try {
          body = JSON.parse(x.responseText);
        } catch {
          /* not JSON */
        }
        if (x.status >= 200 && x.status < 300 && body) resolve(body);
        else reject(new Error(body?.error ?? `HTTP ${x.status}`));
      };
      x.onerror = () => reject(new Error('se cortó la subida'));
      x.send(file);
    }),
  removeClip: (slug: string, name: string) => fetch(`/api/reels/${slug}/footage/${encodeURIComponent(name)}`, {method: 'DELETE'}).then((r) => json(r)),
};

// Server events over the websocket. onOpen also fires after a reconnect (server restart), so
// callers can reload whatever they may have missed. Reconnects every 1.5 s while down.
export function useSocket(onMessage: (msg: ServerEvent) => void, onOpen?: () => void) {
  const cb = useRef({onMessage, onOpen});
  cb.current = {onMessage, onOpen};
  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let closed = false;
    let first = true;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => {
        if (!first) cb.current.onOpen?.();
        first = false;
      };
      ws.onmessage = (e) => cb.current.onMessage(JSON.parse(e.data) as ServerEvent);
      ws.onclose = () => {
        if (!closed) timer = window.setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);
}

// Calls onChange(slug) whenever a reel's files change on disk.
export function useLive(onChange: (slug: string) => void) {
  useSocket((msg) => msg.type === 'changed' && onChange(msg.slug));
}

/* ───── Chat ───── */

const post = (url: string, body?: unknown) =>
  fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body ?? {})}).then((r) => json(r));

export const chatApi = {
  // key: a reel slug, or "_general" for the library's conversations; chat: one of them (a tab), or
  // "active" for the one open in the panel.
  list: (key: string) => fetch(`/api/chat/${key}`).then((r) => json<ChatList>(r)),
  // What an empty general conversation suggests, about the project's audience; [] if there's nothing yet.
  examples: () => fetch('/api/chat-examples').then((r) => json<string[]>(r)),
  create: (key: string) => post(`/api/chat/${key}/new`) as Promise<{id: string}>,
  state: (key: string, chat: string) => fetch(`/api/chat/${key}/${chat}`).then((r) => json<ChatState>(r)),
  // context: where Cristian is in the UI right now (studio.tsx UiContext); the server prepends it.
  // refs: reels from Inspiración attached to a message of the general conversation.
  // images: names of images already uploaded with uploadImage.
  // ideas: ideas from Ideas de contenido attached to a message of the general conversation.
  // audit: the reel's Alineación con tu audiencia goes with it (its conversation).
  send: (key: string, chat: string, text: string, comments: Comment[], context?: unknown, refs?: InspirationRef[], images?: string[], ideas?: IdeaRef[], audit?: ('audience' | 'hook')[]) =>
    post(`/api/chat/${key}/${chat}`, {text, comments, context, refs, images, ideas, audit}),
  // An image pasted or dropped into the message box, saved in the project; its name goes with the message.
  uploadImage: (file: Blob) => fetch('/api/chat-images', {method: 'POST', headers: {'Content-Type': file.type}, body: file}).then((r) => json<{name: string}>(r)),
  imageUrl: (name: string) => `/chat-images/${encodeURIComponent(name)}`,
  stop: (key: string, chat: string) => post(`/api/chat/${key}/${chat}/stop`),
  seen: (key: string, chat: string) => post(`/api/chat/${key}/${chat}/seen`),
  open: (key: string, chat: string) => post(`/api/chat/${key}/${chat}/open`),
  close: (key: string, chat: string) => post(`/api/chat/${key}/${chat}/close`),
  // The models, efforts and slash commands of the agent in use; and a conversation's choice of model and effort.
  options: () => fetch('/api/chat-options').then((r) => json<ChatOptions>(r)),
  setMode: (key: string, chat: string, mode: string) => post(`/api/chat/${key}/${chat}/mode`, {mode}) as Promise<{mode: string}>,
  answerPermission: (key: string, chat: string, item: string, allow: boolean) => post(`/api/chat/${key}/${chat}/permission/${item}`, {allow}),
  setOptions: (key: string, chat: string, o: {model?: string; effort?: string}) => post(`/api/chat/${key}/${chat}/options`, o) as Promise<{model: string; effort: string}>,
  frame: (slug: string, png: Blob) =>
    fetch(`/api/reels/${slug}/frames`, {method: 'POST', headers: {'Content-Type': 'image/png'}, body: png}).then((r) => json<{path: string}>(r)),
};

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
export function fmtAgo(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d < 30 ? `hace ${d} d` : new Date(ms).toLocaleDateString('es');
}

/* ───── Agents (sidebar) ───── */

export const agentsApi = {
  list: () => fetch('/api/agents').then((r) => json<Agent[]>(r)),
};

/* ───── Requirements (Ajustes → Requisitos) ───── */

export const requirementsApi = {
  list: () => fetch('/api/requirements').then((r) => json<Requirement[]>(r)),
  fix: (id: string) => post(`/api/requirements/${id}/fix`),
};

/* ───── Workspace (welcome page) ───── */

export type WorkspaceStatus = {configured: boolean; path: string | null; packaged: boolean; suggested: string; missing: string[]};
export type FolderInfo = {path: string; exists: boolean; isDir: boolean; empty: boolean; workspace: boolean; videos: number; missing: string[]};

export const workspaceApi = {
  status: () => fetch('/api/workspace').then((r) => json<WorkspaceStatus>(r)),
  inspect: (path: string) => post('/api/workspace/inspect', {path}) as Promise<FolderInfo>,
  // Use this folder (created if needed); copies in what it lacks.
  set: (path: string) => post('/api/workspace', {path}) as Promise<WorkspaceStatus & {copied: string[]}>,
  reveal: () => post('/api/workspace/reveal'),
};

// The desktop app's bridge (desktop/preload.cjs): a native folder picker. Absent in a browser.
export const desktop = (window as unknown as {reelStudio?: {pickFolder: (defaultPath?: string) => Promise<string | null>}}).reelStudio ?? null;

/* ───── Settings (API keys, local mode, agent) ───── */

const put = <T>(url: string, body: unknown) =>
  fetch(url, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}).then((r) => json<T>(r));


export const settingsApi = {
  get: () => fetch('/api/settings').then((r) => json<Settings>(r)),
  setKey: (name: string, value: string) =>
    fetch(`/api/settings/keys/${name}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({value})}).then((r) => json<Settings>(r)),
  verify: (name: string) => post(`/api/settings/keys/${name}/verify`) as Promise<Settings>,
  // The coding-agent CLIs installed on this machine (path, version, login) and the one in use. refresh re-checks them.
  agents: (refresh = false) => fetch(`/api/settings/agents${refresh ? '?refresh=1' : ''}`).then((r) => json<AgentChoice>(r)),
  setAgent: (id: string) => put<AgentChoice>('/api/settings/agent', {id}),
  chrome: () => fetch('/api/settings/chrome').then((r) => json<{enabled: boolean}>(r)),
  setChrome: (enabled: boolean) => put<{enabled: boolean}>('/api/settings/chrome', {enabled}),
  agentUsage: (id: string, refresh = false) => fetch(`/api/settings/agents/${encodeURIComponent(id)}/usage${refresh ? '?refresh=1' : ''}`).then((r) => json<AgentUsage>(r)),
};

export const skillsApi = {
  list: () => fetch('/api/skills').then((r) => json<import('../shared/types').SkillSummary[]>(r)),
  detail: (id: string) => fetch(`/api/skills/${encodeURIComponent(id)}`).then((r) => json<import('../shared/types').SkillDetail>(r)),
  file: (id: string, path: string) => fetch(`/api/skills/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`).then((r) => json<import('../shared/types').SkillDocument>(r)),
  reveal: (id: string) => post(`/api/skills/${encodeURIComponent(id)}/reveal`),
};

// The short name of the agent in use ("Claude", "Codex"), for the chat and buttons. Asked once per page
// load; Ajustes → Agente passes on every new choice (noteAgent) so open pages follow it.
let agentName = 'Claude';
let agentId = 'claude';
let asked = false;
const listeners = new Set<() => void>();
export function noteAgent(c: AgentChoice) {
  agentId = c.current;
  agentName = (c.agents.find((a) => a.id === c.current)?.label ?? 'Claude').replace(/\s+Code$/, '');
  listeners.forEach((fn) => fn());
}
function useAgentChoice() {
  const [, render] = useState(0);
  useEffect(() => {
    const fn = () => render((n) => n + 1);
    listeners.add(fn);
    if (!asked) {
      asked = true;
      settingsApi.agents().then(noteAgent, () => (asked = false));
    }
    return () => void listeners.delete(fn);
  }, []);
  return {id: agentId, name: agentName};
}
export const useAgentName = () => useAgentChoice().name;
// The id of the one in use, for a conversation that has no session yet.
export const useAgentId = () => useAgentChoice().id;

/* ───── Profile and voice (Ajustes) ───── */


export const imagesApi = {
  get: () => fetch('/api/images').then((r) => json<ImageSources>(r)),
  save: (v: Partial<ImageSources>) => put<ImageSources>('/api/images', v),
};

// Inspiración's scraper: Apify or ScrapeCreators (config/social.json).
export const socialApi = {
  get: () => fetch('/api/social').then((r) => json<{source: SocialSourceId}>(r)),
  save: (source: SocialSourceId) => put<{source: SocialSourceId}>('/api/social', {source}),
};

export const profileApi = {
  get: () => fetch('/api/profile').then((r) => json<Profile>(r)),
  save: (p: Partial<Profile>) => put<Profile>('/api/profile', p),
};

// Perfil de audiencia: the suggestions save nothing (server/audience.ts).
export const audienceApi = {
  get: () => fetch('/api/audience').then((r) => json<Audience>(r)),
  save: (a: Partial<Audience>) => put<Audience>('/api/audience', a),
  reset: () => del('/api/audience') as Promise<Audience>,
  // For the wants in `only`, given the table as it is on the page.
  wants: (wants: AudienceWant[], only: string[]) => post('/api/audience/suggest/wants', {wants, only}) as Promise<Record<string, WantOption[]>>,
  pillars: () => post('/api/audience/suggest/pillars') as Promise<PillarSet[]>,
  problems: (pillars: string[]) => post('/api/audience/suggest/problems', {pillars}) as Promise<{problems: string[]; top: string[]}>,
  levels: () => post('/api/audience/suggest/levels') as Promise<AudienceLevels[]>,
};

export const voiceApi = {
  get: () => fetch('/api/voice').then((r) => json<Voice>(r)),
  save: (v: Partial<Voice>) => put<Voice>('/api/voice', v),
  // From the ElevenLabs account (needs its key).
  voices: () => fetch('/api/voice/voices').then((r) => json<VoiceOption[]>(r)),
  models: () => fetch('/api/voice/models').then((r) => json<VoiceModel[]>(r)),
  sample: (text: string, settings: Partial<Voice>) => post('/api/voice/sample', {text, settings}) as Promise<VoiceSample>,
};

/* ───── Inspiración ───── */

// charge: what it will cost, in words (Apify's dollars or ScrapeCreators' credits); source: the scraper's name.
// Projects: one per channel (server/workspace.ts). Opening one makes every page reload on it.
export const projectsApi = {
  list: () => fetch('/api/projects').then((r) => json<import('../shared/types').Project[]>(r)),
  create: (name: string, audience: string) => post('/api/projects', {name, audience}) as Promise<import('../shared/types').Project[]>,
  rename: (id: string, name: string) =>
    fetch(`/api/projects/${id}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})}).then((r) => json<import('../shared/types').Project[]>(r)),
  open: (id: string) => post(`/api/projects/${id}/open`) as Promise<import('../shared/types').Project[]>,
  // What deleting it would take with it; it refuses if it can't be deleted now.
  contents: (id: string) => fetch(`/api/projects/${id}/contents`).then((r) => json<import('../shared/types').ProjectContents>(r)),
  remove: (id: string, name: string) =>
    fetch(`/api/projects/${id}`, {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})}).then((r) => json<import('../shared/types').Project[]>(r)),
  // Its picture: an image file, the profile photo of its Instagram account (Mi cuenta), or none.
  setAvatar: (id: string, file: File) =>
    fetch(`/api/projects/${id}/avatar`, {method: 'POST', headers: {'Content-Type': file.type}, body: file}).then((r) => json<import('../shared/types').Project[]>(r)),
  avatarFromInstagram: (id: string) => post(`/api/projects/${id}/avatar/instagram`) as Promise<import('../shared/types').Project[]>,
  removeAvatar: (id: string) => fetch(`/api/projects/${id}/avatar`, {method: 'DELETE'}).then((r) => json<import('../shared/types').Project[]>(r)),
  avatarUrl: (p: {id: string; avatar: number | null}) => (p.avatar ? `/project-files/${p.id}/avatar?v=${p.avatar}` : null),
};

// Mi cuenta: the creator's own Instagram account (server/account.ts).
// Reel Studio's account (server/cloud.ts): the session with the site, and this project's Instagram account.
type CloudStatusT = import('../shared/types').CloudStatus;
export const cloudApi = {
  status: () => fetch('/api/cloud').then((r) => json<CloudStatusT>(r)),
  sendCode: (email: string) => post('/api/cloud/code', {email}) as Promise<{ok: true}>,
  verify: (email: string, code: string) => post('/api/cloud/verify', {email, code}) as Promise<CloudStatusT>,
  logout: () => post('/api/cloud/logout', {}) as Promise<CloudStatusT>,
  setUrl: (url: string) => put('/api/cloud/url', {url}) as Promise<CloudStatusT>,
  setAccount: (accountId: number | null) => put('/api/cloud/account', {accountId}) as Promise<CloudStatusT>,
};

export const accountApi = {
  status: () => fetch('/api/account').then((r) => json<import('../shared/types').AccountStatus>(r)),
  setUsername: (username: string) =>
    fetch('/api/account', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username})}).then((r) => json<import('../shared/types').AccountStatus>(r)),
  // What downloading the newest limit reels (and the profile) would cost at most.
  estimate: (limit: number) => post('/api/account/estimate', {limit}) as Promise<{limit: number; charge: string; source: string}>,
  fetch: (limit: number) => post('/api/account/fetch', {limit}) as Promise<import('../shared/types').AccountStatus>,
  // A new general conversation with one of "Analizar con el agente"'s requests (the agent only uses what's
  // already downloaded unless he agrees to spend).
  analyse: (kind: 'reels' | 'ideas' | 'variants' | 'general', context?: unknown) => post('/api/account/analyse', {kind, context}) as Promise<{chat: string}>,
  // The table: one page of the reels, filtered and in order (from the studio's index).
  list: (query: Record<string, string | number | boolean | undefined>) => {
    const qs = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (v === undefined || v === '' ? [] : [[k, String(v)]])));
    return fetch(`/api/account/reels?${qs}`).then((r) => json<import('../shared/types').OwnReelList>(r));
  },
  // One reel for its card: its numbers, its place by views (0: no views), its saved metadata (all the scraper
  // returned, flattened) and, once analysed, its transcript, frames and analysis.
  reel: (code: string) => fetch(`/api/account/reels/${code}`).then((r) => json<import('../shared/types').OwnReelCard>(r)),
  // "Analizar": those reels (again if they were), or all those not analysed yet; in the background.
  analyseReels: (what: {codes: string[]} | {all: true}) => post('/api/account/reels/analyse', what) as Promise<{queued: number}>,
  stopAnalysis: () => post('/api/account/reels/stop'),
  // "Actualizar métricas": one reel's numbers and links again (one reel's price), and what that costs.
  refreshCost: () => fetch('/api/account/refresh-cost').then((r) => json<{charge: string; source: string}>(r)),
  refresh: (code: string) => post(`/api/account/reels/${code}/refresh`) as Promise<import('../shared/types').OwnReelCard>,
  avatar: '/account-files/avatar.jpg',
  thumb: (code: string) => `/account-files/${code}/thumb.jpg`,
  file: (code: string, f: string) => `/account-files/${code}/${f}`,
};

export type InspirationEstimate = {accounts: string[]; urls: string[]; reels: number; usd: number; perReel: number; perRun: number; tier: string; source: string; charge: string};
const del = (url: string) => fetch(url, {method: 'DELETE'}).then((r) => json(r));

export const inspirationApi = {
  status: () => fetch('/api/inspiration').then((r) => json<InspirationStatus>(r)),
  // What a download would bring and cost at most (Apify charges per reel).
  // kind: the card it comes from (Agregar video: reel links · Escanear cuenta: accounts).
  estimate: (input: string, limit: number, kind?: 'video' | 'account') => post('/api/inspiration/estimate', {input, limit, kind}) as Promise<InspirationEstimate>,
  // refresh: only metrics, metadata and profile (Actualizar); nothing is transcribed or analysed.
  add: (input: string, limit: number, kind?: 'video' | 'account', refresh = false) => post('/api/inspiration', {input, limit, kind, refresh}) as Promise<InspirationEstimate>,
  // The agent analyses one reel (processing it first if needed); runs in the background.
  analyse: (r: {account: string; code: string}) => post(`/api/inspiration/accounts/${r.account}/reels/${r.code}/analyse`),
  // Read a reel's metrics and metadata again (one reel's price on Apify); the video isn't analysed again.
  refresh: (r: {account: string; code: string}) => post(`/api/inspiration/accounts/${r.account}/reels/${r.code}/refresh`) as Promise<InspirationReel>,
  // A page of the reels table (from the index): scope "all", "loose" or an account; filters, order and page.
  list: (scope: string, query: Record<string, string | number | boolean | undefined>) => {
    const qs = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (v === undefined || v === '' ? [] : [[k, String(v)]])));
    return fetch(`/api/inspiration/list/${encodeURIComponent(scope)}?${qs}`).then((r) => json<InspirationList>(r));
  },
  // One whole reel, for its card (account: where it is, when known).
  reel: (code: string, account?: string | null) => fetch(`/api/inspiration/reels/${code}${account ? `?account=${account}` : ''}`).then((r) => json<InspirationReel>(r)),
  // No limit: everything pending (loose videos). With one: an account's "Analizar…", as the automation's step.
  process: (account: string, opts: {reanalyse?: boolean; limit?: number; maxSeconds?: number; fetch?: boolean; codes?: string[]} = {}) => post(`/api/inspiration/accounts/${account}/process`, opts),
  // Detener: stop what's transcribing or analysing in an account (or the owner of a loose video).
  stop: (account: string) => post(`/api/inspiration/accounts/${account}/stop`),
  removeAccount: (account: string) => del(`/api/inspiration/accounts/${account}`),
  removeReel: (account: string, code: string) => del(`/api/inspiration/accounts/${account}/reels/${code}`),
  file: (r: {account: string; code: string}, f: string) => `/inspiration-files/${r.account}/${r.code}/${f}`,
};

/* ───── Automatizaciones ───── */

// Every change answers with the whole view.
const automationsCall = (method: string, path: string, body?: unknown) =>
  fetch(path, {method, headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)}).then((r) => json<AutomationsView>(r));
export const automationsApi = {
  view: () => automationsCall('GET', '/api/automations'),
  agents: () => fetch('/api/automations/agents').then((r) => json<AutomationAgent[]>(r)),
  add: (input: AutomationInput) => automationsCall('POST', '/api/automations', input),
  edit: (id: string, input: AutomationInput) => automationsCall('PUT', `/api/automations/${id}`, input),
  remove: (id: string) => automationsCall('DELETE', `/api/automations/${id}`),
  run: (id: string) => automationsCall('POST', `/api/automations/${id}/run`),
  stop: (run: string) => automationsCall('POST', `/api/automation-runs/${run}/stop`),
};

/* ───── Ideas de contenido ───── */

// Every change answers with the whole board.
const ideasCall = (method: string, path: string, body?: unknown) =>
  fetch(`/api/ideas${path}`, {method, headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)}).then((r) => json<IdeasBoard>(r));
const seg = encodeURIComponent;
export const ideasApi = {
  board: () => ideasCall('GET', ''),
  addCard: (input: {title: string; list: string; vertical?: string | null}) => ideasCall('POST', '/cards', input),
  editCard: (id: string, input: {title?: string; notes?: string; vertical?: string | null}) => ideasCall('PUT', `/cards/${seg(id)}`, input),
  // before: the card it goes in front of; null, last.
  moveCard: (id: string, list: string, before: string | null) => ideasCall('POST', `/cards/${seg(id)}/move`, {list, before}),
  removeCard: (id: string) => ideasCall('DELETE', `/cards/${seg(id)}`),
  addList: (name: string) => ideasCall('POST', '/lists', {name}),
  renameList: (id: string, name: string) => ideasCall('PUT', `/lists/${seg(id)}`, {name}),
  moveList: (id: string, before: string | null) => ideasCall('POST', `/lists/${seg(id)}/move`, {before}),
  removeList: (id: string) => ideasCall('DELETE', `/lists/${seg(id)}?withCards=1`),
  addVertical: (input: {name: string; description: string; color?: IdeaColor; icon: IdeaIcon}) => ideasCall('POST', '/verticals', input),
  editVertical: (id: string, input: {name?: string; description?: string; color?: IdeaColor; icon?: IdeaIcon}) => ideasCall('PUT', `/verticals/${seg(id)}`, input),
  removeVertical: (id: string) => ideasCall('DELETE', `/verticals/${seg(id)}`),
};

/* ───── Fuentes de información ───── */

const sourcesCall = <T>(method: string, path: string, body?: unknown) =>
  fetch(path, {method, headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)}).then((r) => json<T>(r));
export type SourceInput = {name?: string; description?: string; instructions?: string; links?: string; enabled?: boolean};
export const sourcesApi = {
  view: () => sourcesCall<SourcesView>('GET', '/api/sources'),
  add: (input: SourceInput) => sourcesCall<SourcesView>('POST', '/api/sources', input),
  edit: (id: string, input: SourceInput) => sourcesCall<SourcesView>('PUT', `/api/sources/${seg(id)}`, input),
  remove: (id: string) => sourcesCall<SourcesView>('DELETE', `/api/sources/${seg(id)}`),
  // A new general conversation (shown in the panel) where the agent interviews him and creates a source from what he
  // wants to extract (text), extracts them (none: every active one), fills in
  // a source he described in words, or turns a result into an idea.
  create: (text: string, context?: unknown) => sourcesCall<{chat: string}>('POST', '/api/sources/new', {text, context}),
  extract: (ids: string[], context?: unknown) => sourcesCall<{chat: string}>('POST', '/api/sources/extract', {ids, context}),
  configure: (id: string, context?: unknown) => sourcesCall<{chat: string}>('POST', `/api/sources/${seg(id)}/configure`, {context}),
  toIdea: (id: string, context?: unknown) => sourcesCall<{chat: string}>('POST', `/api/source-items/${seg(id)}/idea`, {context}),
  items: (query: Record<string, string | number | boolean | undefined>) =>
    sourcesCall<SourceItemList>('GET', `/api/source-items?${new URLSearchParams(Object.entries(query).filter((e): e is [string, string | number | boolean] => e[1] !== undefined && e[1] !== '').map(([k, v]) => [k, String(v)]))}`),
  item: (id: string) => sourcesCall<SourceItemDetail>('GET', `/api/source-items/${seg(id)}`),
  editItem: (id: string, input: {state?: SourceItemState; tags?: string[]}) => sourcesCall<SourceItem>('PUT', `/api/source-items/${seg(id)}`, input),
  removeItem: (id: string) => sourcesCall('DELETE', `/api/source-items/${seg(id)}`),
};
