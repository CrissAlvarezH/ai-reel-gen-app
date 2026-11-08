// Reel Studio: local UI over the workspace's projects and their videos (server/workspace.ts). One port serves the API, the reels' media, a websocket that
// announces file changes, and the React app (through Vite in middleware mode).
// Runs as TypeScript directly (Node's type stripping): node server/index.ts.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import express, {type NextFunction, type Request, type Response} from 'express';
import {WebSocketServer} from 'ws';
import chokidar from 'chokidar';
import {createServer as createVite} from 'vite';
import {ROOT, VIDEOS, listSlugs, summary, detail, writeFile, validSlug, title, httpError, setStyle} from './reels.ts';
import * as chat from './chat.ts';
import * as settings from './settings.ts';
import * as skills from './skills.ts';
import * as config from './config.ts';
import * as voice from './voice.ts';
import {create, installing} from './create.ts';
import {AGENTS, agentUsage, currentAgent, setAgent} from './agent.ts';
import * as beats from './beats.ts';
import {listStyles, isStyleFile} from './styles.ts';
import {listFormats, isFormatFile} from './formats.ts';
import * as footage from './footage.ts';
import {loadShellPath, reveal} from './platform.ts';
import * as requirements from './requirements.ts';
import * as workspace from './workspace.ts';
import * as inspiration from './inspiration.ts';
import * as account from './account.ts';
import * as cloud from './cloud.ts';
import * as ideas from './ideas.ts';
import * as sources from './sources.ts';
import * as audience from './audience.ts';
import * as scriptCheck from './script-check.ts';
import * as hookCheck from './hook-check.ts';
import * as automations from './automations.ts';
import * as db from './db.ts';
import * as uploads from './uploads.ts';
import type {Agent, IdeasBoard, ServerEvent} from '../shared/types.ts';

const PORT = Number(process.env.PORT ?? 4000);
// Listens on the local network (Cristian opens it from another Mac on his own network).
// HOST=127.0.0.1 keeps it to this machine.
const HOST = process.env.HOST ?? '0.0.0.0';

const app = express();
const server = http.createServer(app);
app.use(express.json({limit: '2mb'}));

type Req = Request<Record<string, string>>;
const fail = (res: Response, e: unknown) => res.status((e as {status?: number}).status ?? 500).json({error: (e as Error).message});
// Route handlers return the JSON to send (or nothing for {ok: true}); a thrown httpError sets the status.
const handle = (fn: (req: Req) => unknown) => async (req: Req, res: Response) => {
  try {
    res.json((await fn(req)) ?? {ok: true});
  } catch (e) {
    fail(res, e);
  }
};

// The workspace (welcome page): which folder, what a candidate folder holds, and choosing one.
app.get('/api/workspace', handle(() => workspace.status()));
app.post('/api/workspace/inspect', handle((req) => {
  if (typeof req.body?.path !== 'string' || !req.body.path.trim()) throw httpError(400, 'escribe una ruta');
  return workspace.inspect(req.body.path);
}));
app.post('/api/workspace', handle((req) => {
  if (typeof req.body?.path !== 'string' || !req.body.path.trim()) throw httpError(400, 'escribe una ruta');
  const copied = workspace.setWorkspace(req.body.path);
  return {...workspace.status(), copied};
}));
app.post('/api/workspace/reveal', handle(() => {
  if (workspace.ROOT) reveal(workspace.ROOT);
}));
// Projects (server/workspace.ts): each channel's videos, profile, voice, account and conversations, in
// projects/<id>/. Opening another one makes every page reload on it.
app.get('/api/projects', handle(() => workspace.listProjects()));
app.post('/api/projects', handle((req) => workspace.createProject(req.body?.name, req.body?.audience)));
app.put('/api/projects/:id', handle((req) => projectsChanged(workspace.renameProject(req.params.id, req.body?.name))));
app.post('/api/projects/:id/open', handle((req) => workspace.openProject(req.params.id)));
// Not while something is writing into its folders.
const notBusy = (id: string) => {
  const dir = workspace.projectDir(id);
  if (chat.runningIn(dir)) throw httpError(409, 'Un agente está trabajando en este proyecto: detenlo antes de borrarlo.');
  if (automations.runningIn(id)) throw httpError(409, 'Hay una automatización en marcha en este proyecto: detenla antes de borrarlo.');
  const slugs = fs.existsSync(path.join(dir, 'videos')) ? fs.readdirSync(path.join(dir, 'videos')) : [];
  if (slugs.some(installing)) throw httpError(409, 'Aún se están instalando las dependencias de un video: inténtalo en un momento.');
};
app.get('/api/projects/:id/contents', handle((req) => {
  const contents = workspace.projectContents(req.params.id);
  notBusy(req.params.id);
  return contents;
}));
app.delete('/api/projects/:id', handle((req) => {
  workspace.projectContents(req.params.id);
  notBusy(req.params.id);
  const list = workspace.deleteProject(req.params.id, req.body?.name);
  db.sync(true);
  return projectsChanged(list);
}));
// Its picture (Ajustes → Proyecto): an image file, or the profile photo of its Instagram account (Mi cuenta).
const projectsChanged = <T>(v: T) => (send({type: 'projects'}), v);
app.post('/api/projects/:id/avatar', express.raw({type: ['image/png', 'image/jpeg', 'image/webp'], limit: '8mb'}), handle((req) => {
  if (!Buffer.isBuffer(req.body)) throw httpError(400, 'usa una imagen PNG, JPG o WebP');
  return projectsChanged(workspace.setProjectAvatar(req.params.id, req.body, String(req.headers['content-type'] ?? '').split(';')[0]));
}));
app.post('/api/projects/:id/avatar/instagram', handle((req) => {
  if (req.params.id !== workspace.PROJECT) throw httpError(400, 'abre ese proyecto primero');
  const pic = account.avatar();
  if (!pic) throw httpError(400, 'Mi cuenta aún no tiene la foto de Instagram: descarga tus reels allí primero');
  return projectsChanged(workspace.setProjectAvatar(req.params.id, fs.readFileSync(pic), 'image/jpeg'));
}));
app.delete('/api/projects/:id/avatar', handle((req) => projectsChanged(workspace.removeProjectAvatar(req.params.id))));
app.get('/project-files/:id/avatar', (req: Req, res: Response) => {
  const p = workspace.projectAvatar(req.params.id);
  if (!p) return res.sendStatus(404);
  res.sendFile(p);
});

// Until there is a workspace, only the welcome page's calls work (the agent check doesn't need one).
const OPEN = /^\/api\/(workspace|settings\/agent|requirements)(\/|$|\?)/;
app.use((req, res, next) => {
  if (workspace.ROOT || OPEN.test(req.path) || !/^\/(api|files|style-files|format-files|inspiration-files)\//.test(req.path)) return next();
  res.status(409).json({error: 'falta elegir la carpeta de trabajo', setup: true});
});

const reel = (req: Req, res: Response, next: NextFunction) => {
  if (!validSlug(req.params.slug) || !listSlugs().includes(req.params.slug)) return res.status(404).json({error: 'reel no encontrado'});
  next();
};

app.get('/api/reels', handle(() => listSlugs().map(summary).sort((a, b) => b.updated - a.updated)));
app.get('/api/reels/:slug', reel, handle((req) => detail(req.params.slug)));
// Alineación con tu audiencia (server/script-check.ts) and Fuerza del gancho (server/hook-check.ts): GET only reads;
// POST judges the script if it changed (force: again) and answers once done. ?format=text: the agent's reading of it.
const check = (agentText: (slug: string) => string, fn: (req: Req) => unknown) => async (req: Req, res: Response) => {
  try {
    const r = await fn(req);
    if (req.query.format === 'text') res.type('text/plain').send(agentText(req.params.slug) || 'Este video aún no tiene revisión de audiencia.');
    else res.json(r);
  } catch (e) {
    fail(res, e);
  }
};
app.get('/api/reels/:slug/audience-check', reel, check(scriptCheck.agentText, (req) => scriptCheck.state(req.params.slug)));
app.post('/api/reels/:slug/audience-check', reel, check(scriptCheck.agentText, (req) => scriptCheck.run(req.params.slug, req.body?.force === true)));
// The model each review runs on (its badge): the open project's choice for the agent in Ajustes.
app.get('/api/checks/models', handle(() => scriptCheck.models()));
app.put('/api/checks/:check/model', handle((req) => scriptCheck.setModel(req.params.check, req.body?.model)));
app.get('/api/reels/:slug/hook-check', reel, check(hookCheck.agentText, (req) => hookCheck.state(req.params.slug)));
app.post('/api/reels/:slug/hook-check', reel, check(hookCheck.agentText, (req) => hookCheck.run(req.params.slug, req.body?.force === true)));

app.put('/api/reels/:slug/file', reel, handle((req) => {
  const {path: rel, content} = req.body ?? {};
  if (typeof rel !== 'string' || typeof content !== 'string') throw httpError(400, 'path y content requeridos');
  writeFile(req.params.slug, rel, content);
}));

// The video's visual style (style.txt). The agent sees it in the [UI: …] line of the next message; the
// transcript gets a line so the change shows in the conversation.
app.put('/api/reels/:slug/style', reel, handle((req) => {
  const s = setStyle(req.params.slug, req.body?.style);
  chat.note(req.params.slug, `Estilo cambiado a «${s.name}».`);
  send({type: 'changed', slug: req.params.slug});
  return s;
}));

// The voice that narrates this video: its own (voice.json) or, with voice null, the one in Ajustes.
app.put('/api/reels/:slug/voice', reel, handle((req) => {
  const {voiceId, voiceName} = req.body ?? {};
  const v = config.setVideoVoice(req.params.slug, typeof voiceId === 'string' && voiceId ? {voiceId, voiceName: String(voiceName ?? voiceId)} : null);
  chat.note(req.params.slug, v?.own ? `Voz cambiada a «${v.name}» solo para este video.` : `Este video vuelve a usar la voz de Ajustes${v ? ` («${v.name}»)` : ''}.`);
  send({type: 'changed', slug: req.params.slug});
  return v;
}));

// His recording, for formats with footage (server/footage.ts): streamed, since a clip can weigh gigabytes. The
// name of the file comes in ?name=. Nuevo reel stages clips before the video exists (/api/footage).
const size = (req: Req) => Number(req.headers['content-length']) || 0;
app.post('/api/footage', handle((req) => footage.stage(req, req.query.name, size(req))));
app.post('/api/reels/:slug/footage', reel, handle(async (req) => {
  const r = await footage.upload(req.params.slug, req, req.query.name, size(req));
  chat.note(req.params.slug, `Subiste footage/${r.name}.`);
  send({type: 'changed', slug: req.params.slug});
  return r;
}));
app.delete('/api/reels/:slug/footage/:name', reel, handle((req) => {
  footage.remove(req.params.slug, req.params.name);
  chat.note(req.params.slug, `Quitaste footage/${req.params.name}.`);
  send({type: 'changed', slug: req.params.slug});
}));

// Open the reel's folder in the file manager (Finder, Explorer…) of the machine where the studio runs.
app.post('/api/reels/:slug/reveal', reel, handle((req) => reveal(path.join(VIDEOS, req.params.slug))));
app.post('/api/reels/:slug/reveal-version', reel, handle((req) => {
  const version = detail(req.params.slug).versions.find((v) => v.url === req.body?.url);
  if (!version) throw httpError(404, 'La versión seleccionada ya no está disponible.');
  const filename = decodeURIComponent(version.url.split('/').pop()!);
  reveal(path.join(VIDEOS, req.params.slug, 'out', filename), true);
}));
// The thumbnail (out/miniatura.png) selected in its folder, like a version.
app.post('/api/reels/:slug/reveal-thumbnail', reel, handle((req) => {
  const thumb = detail(req.params.slug).thumbnail;
  if (!thumb) throw httpError(404, 'Este video todavía no tiene miniatura.');
  reveal(path.join(VIDEOS, req.params.slug, 'out', decodeURIComponent(thumb.url.split('?')[0].split('/').pop()!)), true);
}));

// Structure tags for the script, suggested by the agent (the UI saves them to audio/beats.json).
app.post('/api/reels/:slug/beats/suggest', reel, handle((req) => beats.suggest(req.body?.text)));

// New reel from its first message (server/create.ts): named by the agent, copied from its style's template, and the
// message goes straight to the reel's own agent, on the model and effort chosen there. Its first turn only gives its
// read of the idea and asks whether to start (FIRST_TURN). npm install keeps running in the background.
const FIRST_TURN =
  'Antes de nada: en este primer turno NO investigues, no busques en internet, no leas skills ni archivos, no transcribas nada, no escribas ni cambies archivos y no uses ninguna herramienta. ' +
  'Responde solo con un párrafo breve, de tres o cuatro frases, con tu análisis de la idea (qué promete, a quién le sirve, qué ángulo ves y qué le falta) y termina con esta pregunta, tal cual y en su propia línea: ¿Empiezo la investigación para la creación? ' +
  'Cuando responda que sí, arranca el proceso completo (skill reel-studio). Si te corrige o añade algo, ajusta el párrafo y vuelve a preguntar: no empieces hasta su sí.';
// Started from a card (Usar una idea guardada, Idear para tu audiencia): no idea yet, so the first turn proposes three.
const FIRST_PICK =
  'Antes de nada: en este primer turno solo puedes leer, sin cambiar nada: el tablero de ideas (tools/ideas.py show), el perfil de audiencia (config/audience.json) y los títulos de los videos que ya hizo (videos/*/title.txt). No busques en internet, no escribas ni cambies archivos. ' +
  'Responde con una o dos frases de análisis y luego 3 propuestas numeradas, la que recomiendas primero. Cada una: un título corto en negrita, de qué va el video en una frase, a quién le pega (el problema o deseo de su perfil y el nivel de conciencia al que le habla) y el gancho de apertura entre comillas. ' +
  'Termina con esta pregunta, tal cual y en su propia línea: ¿Con cuál empezamos? ' +
  'Cuando elija una (o la corrija o combine), actualiza title.txt con ese tema y arranca el proceso completo (skill reel-studio): investigación, guion y video. Si ninguna le convence, propone otras 3 distintas y vuelve a preguntar.';
app.post('/api/reels', handle(async (req) => {
  const {text, brief, context, style: styleId, videoFormat, clips, model, effort} = req.body ?? {};
  const {slug, title, style, kind, uploaded} = await create(text, styleId, videoFormat, clips, (s, ok, log) => {
    send({type: 'changed', slug: s});
    if (!ok) chat.note(s, `npm install falló en videos/${s}${log ? `\n${log.trim().split('\n').slice(-5).join('\n')}` : ''}`, true);
  });
  chat.startWith(slug, {model, effort});
  chat.send(slug, {
    text,
    context: {...(context ?? {}), page: 'reel', slug},
    note: `[Video nuevo: acabo de crear videos/${slug}/ desde ${style.template}/ a partir de este mensaje, con el título «${title}» (en title.txt), el estilo «${style.name}» (styles/${style.id}/style.json, en style.txt)${style.ready ? '' : style.skill ? `; su skill: ${style.skill}, sobre la plantilla ${style.template}/` : `, que aún no tiene skill ni plantilla propias: su aspecto sale de su style.json, sobre la plantilla ${style.template}/`}${kind ? ` y el formato «${kind.name}» (formats/${kind.id}/format.json, en format.txt${kind.skill ? `; su skill: ${kind.skill}` : ''})` : ''}.${uploaded.length ? ` Subió su grabación: ${uploaded.map((n) => `footage/${n}`).join(', ')}.` : ''} npm install corre en segundo plano: no renderices ni hagas stills hasta que exista node_modules/.bin/remotion.]\n\n${typeof brief === 'string' && brief.trim() ? `[${FIRST_PICK}]\n\n[Lo que pidió al empezar (él solo ve su mensaje): ${brief.trim().slice(0, 4000)}]` : `[${FIRST_TURN}]`}`,
  });
  return {slug, title};
}));

// Delete a video for good: its folder (renders, script, voice, images, his recording) and its conversations. Its
// reel in Mi cuenta stays, without the link to it (the index works that out again). Not while something is writing
// into the folder.
app.delete('/api/reels/:slug', reel, handle((req) => {
  const {slug} = req.params;
  if (chat.running(slug)) throw httpError(409, 'El agente está trabajando en este video: detenlo antes de borrarlo.');
  if (installing(slug)) throw httpError(409, 'Aún se están instalando sus dependencias: inténtalo en un momento.');
  fs.rmSync(path.join(VIDEOS, slug), {recursive: true, force: true, maxRetries: 3});
  chat.remove(slug);
  db.sync(true);
  send({type: 'changed', slug});
}));

// Agent conversations (server/chat.ts): one per reel, plus the general one used from the library (key _general).
// Progress arrives over the websocket.
const chatKey = (req: Req, res: Response, next: NextFunction) => {
  const k = req.params.key;
  if (k === chat.GENERAL || (validSlug(k) && listSlugs().includes(k))) return next();
  res.status(404).json({error: 'conversación no encontrada'});
};
// The message box's model and effort menu and its slash commands, for the agent in use.
app.get('/api/chat-options', handle(() => chat.options()));
app.get('/api/chat-examples', handle(() => chat.examples()));
app.get('/api/chat/:key', chatKey, handle((req) => chat.list(req.params.key)));
// For the agent (curl, from the line each turn carries): its instructions as they are now, in plain text.
app.get('/api/chat/:key/instructions', chatKey, (req, res) => {
  try {
    res.type('text/plain').send(chat.instructions(req.params.key));
  } catch (e) {
    fail(res, e);
  }
});
app.post('/api/chat/:key/new', chatKey, handle((req) => chat.newChat(req.params.key)));
app.get('/api/chat/:key/:chat', chatKey, handle((req) => chat.state(req.params.key, req.params.chat)));
// Images pasted or dropped into the chat (server/uploads.ts): saved first, then named in the message.
app.post('/api/chat-images', express.raw({type: Object.keys(uploads.TYPES), limit: '25mb'}), handle((req) => uploads.save(req.body, String(req.headers['content-type'] ?? '').split(';')[0])));
app.get('/chat-images/:name', (req: Req, res: Response) => {
  const p = uploads.file(req.params.name);
  if (!p) return res.sendStatus(404);
  res.sendFile(p);
});
app.post('/api/chat/:key/:chat', chatKey, handle((req) => chat.send(req.params.key, req.body ?? {}, req.params.chat === 'active' ? undefined : req.params.chat)));
app.post('/api/chat/:key/:chat/move', chatKey, handle((req) => chat.requestMove(req.params.key, req.params.chat, req.body?.slug, req.body?.auto === true)));
app.post('/api/chat/:key/:chat/stop', chatKey, handle((req) => ({stopped: chat.stop(req.params.key, req.params.chat)})));
app.post('/api/chat/:key/:chat/seen', chatKey, handle((req) => chat.markSeen(req.params.key, req.params.chat)));
app.post('/api/chat/:key/:chat/open', chatKey, handle((req) => chat.open(req.params.key, req.params.chat)));
app.post('/api/chat/:key/:chat/close', chatKey, handle((req) => chat.close(req.params.key, req.params.chat)));
app.post('/api/chat/:key/:chat/options', chatKey, handle((req) => chat.setOptions(req.params.key, req.params.chat, req.body ?? {})));
app.post('/api/chat/:key/:chat/mode', chatKey, handle((req) => chat.setMode(req.params.key, req.params.chat, req.body?.mode)));
app.post('/api/chat/:key/:chat/permission/:item', chatKey, handle((req) => chat.answerPermission(req.params.key, req.params.chat, req.params.item, req.body?.allow === true)));
// Every agent at a glance (sidebar): the general one + one per video, with its state.
app.get('/api/agents', handle((): Agent[] =>
  [chat.GENERAL, ...listSlugs()].map((k) => {
    const general = k === chat.GENERAL;
    return {...chat.agent(k), slug: general ? null : k, title: general ? null : title(k)};
  }),
));
app.post('/api/reels/:slug/frames', reel, express.raw({type: 'image/png', limit: '20mb'}), handle((req) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(400, 'PNG vacío');
  return {path: chat.saveFrame(req.params.slug, req.body)};
}));

// Settings: API keys in local mode (server/settings.ts; written, never read back) and the agent CLI.
app.get('/api/settings', handle(() => settings.status()));
app.get('/api/skills', handle(() => skills.listSkills()));
app.get('/api/skills/:id', handle((req) => skills.skillDetail(req.params.id)));
app.get('/api/skills/:id/file', handle((req) => skills.skillDocument(req.params.id, req.query.path)));
app.post('/api/skills/:id/reveal', handle((req) => skills.revealSkill(req.params.id)));
app.put('/api/settings/keys/:name', handle((req) => settings.setKey(req.params.name, req.body?.value)));
app.post('/api/settings/keys/:name/verify', handle((req) => settings.verify(req.params.name)));
// Profile and voice (server/config.ts → config/*.json): what the agent's prompts and tools/tts.py follow.
app.get('/api/profile', handle(() => config.getProfile()));
app.put('/api/profile', handle((req) => config.setProfile(req.body)));
// Perfil de audiencia (server/audience.ts): the suggestions save nothing until he picks.
app.get('/api/audience', handle(() => audience.get()));
app.put('/api/audience', handle((req) => audience.save(req.body)));
app.delete('/api/audience', handle(() => audience.reset()));
app.post('/api/audience/suggest/wants', handle((req) => audience.suggestWants(req.body)));
app.post('/api/audience/suggest/pillars', handle(() => audience.suggestPillars()));
app.post('/api/audience/suggest/problems', handle((req) => audience.suggestProblems(Array.isArray(req.body?.pillars) ? req.body.pillars.filter((x: unknown) => typeof x === 'string').slice(0, 30) : [])));
app.post('/api/audience/suggest/levels', handle(() => audience.suggestLevels()));
app.get('/api/voice', handle(() => config.getVoice()));
app.put('/api/voice', handle((req) => {
  const v = config.setVoice(req.body);
  for (const s of listSlugs()) send({type: 'changed', slug: s}); // estimated lengths follow the new pace
  return v;
}));
app.get('/api/voice/voices', handle(() => voice.voices()));
app.get('/api/voice/models', handle(() => voice.models()));
app.post('/api/voice/sample', handle((req) => voice.sample(req.body?.text, req.body?.settings)));
// Image sources (config/images.json): which ones the agent may use. Their keys are in /api/settings.
app.get('/api/images', handle(() => config.getImageSources()));
// Inspiración's scraper (config/social.json): Apify or ScrapeCreators. Their keys are in /api/settings.
app.get('/api/social', handle(() => ({source: config.getSocialSource((k) => !!settings.getKey(k))})));
app.put('/api/social', handle((req) => ({source: config.setSocialSource(req.body?.source)})));
app.put('/api/images', handle((req) => config.setImageSources(req.body)));
// What this machine needs (server/requirements.ts), and installing or repairing it.
app.get('/api/requirements', handle(() => requirements.check()));
app.post('/api/requirements/:id/fix', handle((req) => requirements.fix(req.params.id)));
// The agent CLIs this studio can drive (server/agent.ts), and which one it uses.
const agents = async (refresh = false) => ({current: currentAgent().id, agents: await Promise.all(AGENTS.map((a) => a.status(refresh)))});
app.get('/api/settings/agents', handle((req) => agents(req.query.refresh === '1')));
app.get('/api/settings/agents/:id/usage', handle((req) => agentUsage(req.params.id, req.query.refresh === '1')));
app.put('/api/settings/agent', handle((req) => (setAgent(String(req.body?.id)), agents())));
app.get('/api/settings/chrome', handle(() => ({enabled: config.getChromeAccess()})));
app.put('/api/settings/chrome', handle((req) => ({enabled: config.setChromeAccess(req.body?.enabled)})));

// Inspiración (server/inspiration.ts): other accounts' reels, downloaded with Apify or ScrapeCreators, processed and analysed.
// tools/social.py (inspiration analyse) names the agent's project, as for Mi cuenta: refused if another one is open now.
app.use('/api/inspiration', (req: Req, res: Response, next: () => void) => {
  const p = req.get('x-reel-studio-project');
  if (p && p !== workspace.PROJECT) return void res.status(409).json({error: `Inspiración está abierta en otro proyecto; abre «${p}» en Reel Studio para esto`});
  next();
});
app.get('/api/inspiration', handle(() => inspiration.status()));
const addKind = (v: unknown) => (v === 'video' || v === 'account' ? v : undefined);
app.post('/api/inspiration/estimate', handle((req) => inspiration.estimate(req.body?.input, Number(req.body?.limit) || 30, addKind(req.body?.kind))));
app.post('/api/inspiration', handle((req) => inspiration.add(req.body?.input, req.body?.limit, addKind(req.body?.kind), req.body?.refresh === true)));
// The reels table (server/inspiration-index.ts): scope "all", "loose" or an account; filters, order and page in the query string.
app.get('/api/inspiration/list/:scope', handle((req) => inspiration.list(req.params.scope, req.query as Record<string, unknown>)));
app.get('/api/inspiration/reels/:code', handle((req) => inspiration.detail(req.params.code, req.query.account)));
app.post('/api/inspiration/accounts/:user/process', handle((req) => inspiration.processAccount(req.params.user, req.body ?? {})));
app.post('/api/inspiration/accounts/:user/stop', handle((req) => inspiration.stopAccount(req.params.user)));
app.delete('/api/inspiration/accounts/:user', handle((req) => inspiration.removeAccount(req.params.user)));
app.post('/api/inspiration/accounts/:user/reels/:code/analyse', handle((req) => inspiration.analyseOne(req.params.user, req.params.code)));
app.post('/api/inspiration/accounts/:user/reels/:code/refresh', handle((req) => inspiration.refreshReel(req.params.user, req.params.code)));
app.delete('/api/inspiration/accounts/:user/reels/:code', handle((req) => inspiration.removeReel(req.params.user, req.params.code)));
app.get('/inspiration-files/:user/avatar.jpg', (req: Req, res: Response) => {
  const p = inspiration.avatar(req.params.user);
  if (!p) return res.sendStatus(404);
  res.sendFile(p);
});
app.get('/inspiration-files/:user/:code/:file', (req: Req, res: Response) => {
  const p = inspiration.file(req.params.user, req.params.code, req.params.file);
  if (!p) return res.sendStatus(404);
  res.sendFile(p);
});

// Mi cuenta (server/account.ts): the creator's own Instagram account, its latest reels and their numbers.
// tools/social.py names the project of the agent that runs it: this route always works on the open one, and an
// agent goes on working in its own after he switches.
app.use('/api/account', (req: Req, res: Response, next: () => void) => {
  const p = req.get('x-reel-studio-project');
  if (p && p !== workspace.PROJECT) return void res.status(409).json({error: `Mi cuenta está abierta en otro proyecto; abre «${p}» en Reel Studio para esto`});
  next();
});
// Reel Studio's account (server/cloud.ts): the session, and this project's Instagram account.
app.get('/api/cloud', handle(() => cloud.status(account.username())));
app.post('/api/cloud/code', handle((req) => cloud.sendCode(req.body?.email)));
app.post('/api/cloud/verify', handle((req) => cloud.verify(req.body?.email, req.body?.code)));
app.post('/api/cloud/logout', handle(() => cloud.logout()));
app.put('/api/cloud/url', handle((req) => cloud.setUrl(req.body?.url)));
app.put('/api/cloud/account', handle((req) => cloud.setAccount(req.body?.accountId ?? null, account.username())));

app.get('/api/account', handle(() => account.status()));
app.put('/api/account', handle((req) => account.setUsername(req.body?.username)));
app.post('/api/account/estimate', handle((req) => account.estimate(req.body?.limit)));
app.get('/api/account/reels', handle((req) => account.list(req.query)));
app.get('/api/account/reels/:code', handle((req) => account.reel(req.params.code)));
app.post('/api/account/fetch', handle((req) => account.fetchLatest(req.body?.limit)));
// Its reels' analysis (Analizar): {codes} or {all: true}; it runs in the background, the page follows it by the socket.
app.post('/api/account/reels/analyse', handle((req) => account.analyseReels(req.body ?? {})));
app.post('/api/account/reels/stop', handle(() => (account.stopAnalysis(), {ok: true})));
app.post('/api/account/reels/:code/refresh', handle((req) => account.refreshReel(req.params.code)));
app.get('/api/account/refresh-cost', handle(() => account.refreshCost()));
// "Analizar con el agente": a new general conversation with the analysis request.
app.post(
  '/api/account/analyse',
  handle((req) => {
    const {text, note} = account.analysisRequest(req.body?.kind);
    const {id} = chat.newChat(chat.GENERAL);
    chat.send(chat.GENERAL, {text, note, context: req.body?.context}, id);
    return {chat: id};
  }),
);
app.get('/account-files/avatar.jpg', (_req: Req, res: Response) => {
  const p = account.avatar();
  if (!p) return res.sendStatus(404);
  res.sendFile(p);
});
app.get('/account-files/:code/:file', (req: Req, res: Response) => {
  const p = account.file(req.params.code, req.params.file);
  if (!p) return res.sendStatus(404);
  res.sendFile(p);
});
// Automatizaciones (server/automations.ts), of the open project. Every change answers with the whole view.
app.get('/api/automations', handle(() => automations.view()));
app.get('/api/automations/agents', handle(() => chat.automationAgents()));
app.post('/api/automations', handle((req) => automations.add(req.body)));
app.put('/api/automations/:id', handle((req) => automations.edit(req.params.id, req.body)));
app.delete('/api/automations/:id', handle((req) => automations.remove(req.params.id)));
app.post('/api/automations/:id/run', handle((req) => automations.runNow(req.params.id)));
app.post('/api/automation-runs/:id/stop', handle((req) => automations.stop(req.params.id)));
// Ideas de contenido (server/ideas.ts): the page and the agent (tools/ideas.py, which says its project in ?project=).
// Every change answers with the whole board and tells the pages.
const ideasProject = (req: Req) => (typeof req.query.project === 'string' ? req.query.project : undefined);
const ideasChange = (fn: (project: string | undefined, req: Req) => IdeasBoard) =>
  handle((req) => {
    const b = fn(ideasProject(req), req);
    send({type: 'ideas'});
    return b;
  });
app.get('/api/ideas', handle((req) => ideas.board(ideasProject(req))));
app.post('/api/ideas/cards', ideasChange((p, req) => ideas.addCard(p, req.body ?? {})));
app.put('/api/ideas/cards/:id', ideasChange((p, req) => ideas.editCard(p, req.params.id, req.body ?? {})));
app.post('/api/ideas/cards/:id/move', ideasChange((p, req) => ideas.moveCard(p, req.params.id, req.body ?? {})));
app.delete('/api/ideas/cards/:id', ideasChange((p, req) => ideas.removeCard(p, req.params.id)));
app.post('/api/ideas/lists', ideasChange((p, req) => ideas.addList(p, req.body ?? {})));
app.put('/api/ideas/lists/:id', ideasChange((p, req) => ideas.renameList(p, req.params.id, req.body?.name)));
app.post('/api/ideas/lists/:id/move', ideasChange((p, req) => ideas.moveList(p, req.params.id, req.body ?? {})));
app.delete('/api/ideas/lists/:id', ideasChange((p, req) => ideas.removeList(p, req.params.id, {moveTo: req.query.moveTo, withCards: req.query.withCards === '1'})));
app.post('/api/ideas/verticals', ideasChange((p, req) => ideas.addVertical(p, req.body ?? {})));
app.put('/api/ideas/verticals/:id', ideasChange((p, req) => ideas.editVertical(p, req.params.id, req.body ?? {})));
app.delete('/api/ideas/verticals/:id', ideasChange((p, req) => ideas.removeVertical(p, req.params.id)));
// Fuentes de información (server/sources.ts): the page and the agent (tools/sources.py, which says its project in ?project=).
// Every change tells the pages.
const sourcesChange = <T>(fn: (project: string | undefined, req: Req) => T | Promise<T>) =>
  handle(async (req) => {
    const out = await fn(ideasProject(req), req);
    send({type: 'sources'});
    return out;
  });
// A new general conversation with a request about the sources (the open project's), shown in the panel.
const sourcesChat = (fn: (req: Req) => {text: string; note: string}) =>
  handle((req) => {
    const {text, note} = fn(req);
    const {id} = chat.newChat(chat.GENERAL);
    chat.send(chat.GENERAL, {text, note, context: req.body?.context}, id);
    return {chat: id};
  });
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
app.get('/api/sources', handle((req) => sources.view(ideasProject(req))));
app.post('/api/sources', sourcesChange((p, req) => sources.addSource(p, req.body ?? {})));
app.post('/api/sources/new', sourcesChat((req) => sources.createRequest(undefined, req.body?.text, chat.SOURCES_TOOL())));
app.post('/api/sources/extract', sourcesChat((req) => sources.extractRequest(undefined, ids(req.body?.ids), chat.SOURCES_TOOL())));
app.post('/api/sources/apify', handle((req) => sources.apify(req.body ?? {})));
app.put('/api/sources/:id', sourcesChange((p, req) => sources.editSource(p, req.params.id, req.body ?? {})));
app.delete('/api/sources/:id', sourcesChange((p, req) => sources.removeSource(p, req.params.id)));
app.post('/api/sources/:id/done', sourcesChange((p, req) => sources.markRun(p, req.params.id, req.body ?? {})));
app.post('/api/sources/:id/configure', sourcesChat((req) => sources.configureRequest(undefined, req.params.id, chat.SOURCES_TOOL())));
app.get('/api/source-items', handle((req) => sources.listItems(ideasProject(req), req.query as sources.ItemQuery)));
app.post('/api/source-items', sourcesChange((p, req) => sources.addItem(p, req.body ?? {})));
app.get('/api/source-items/:id', handle((req) => sources.item(ideasProject(req), req.params.id)));
app.put('/api/source-items/:id', sourcesChange((p, req) => sources.editItem(p, req.params.id, req.body ?? {})));
app.delete('/api/source-items/:id', sourcesChange((p, req) => sources.removeItem(p, req.params.id)));
app.post('/api/source-items/:id/idea', sourcesChat((req) => sources.ideaRequest(undefined, req.params.id, chat.SOURCES_TOOL())));

// The studio's index (server/db.ts): tools/studio_sql.py asks for it to be brought up to date before a query.
app.post('/api/index/sync', handle(() => (db.sync(true), {ok: true})));

// The scraper for the agent (tools/social.py): reels, one reel or a profile, without saving them; and their cost.
app.post('/api/social/cost', handle((req) => account.scrapeCost(req.body?.kind, req.body?.limit)));
app.post('/api/social/reels', handle((req) => account.scrapeReels(req.body?.account, req.body?.limit)));
app.post('/api/social/reel', handle((req) => account.scrapeReel(req.body?.url)));
app.post('/api/social/profile', handle((req) => account.scrapeProfile(req.body?.account)));

// Visual styles (styles/<id>/style.json) and the images they list.
app.get('/api/styles', handle(() => listStyles()));
// "Nuevo estilo": a new general conversation where the agent interviews him and writes the style (the
// new-style skill).
app.post(
  '/api/styles/new',
  handle((req) => {
    const {id} = chat.newChat(chat.GENERAL);
    chat.send(
      chat.GENERAL,
      {
        text: 'Quiero crear un estilo nuevo para mis videos.',
        note: '[Botón «Nuevo estilo» de la página Estilos. Sigue la skill new-style (.claude/skills/new-style/SKILL.md): sé breve: un paso por mensaje, en pocas líneas, con tu propuesta para que baste un «sí». Empieza ya con la primera pregunta, sin introducción.]',
        context: req.body?.context,
      },
      id,
    );
    return {chat: id};
  }),
);
// Formats: the kinds of video (formats/<id>/format.json) and the images they list.
app.get('/api/formats', handle(() => listFormats()));
app.get('/format-files/*', (req: Req, res: Response) => {
  const rel = path.posix.normalize(req.params[0]);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !isFormatFile(rel)) return res.sendStatus(404);
  res.sendFile(rel, {root: ROOT, dotfiles: 'deny'});
});
app.get('/style-files/*', (req: Req, res: Response) => {
  const rel = path.posix.normalize(req.params[0]);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !isStyleFile(rel)) return res.sendStatus(404);
  res.sendFile(rel, {root: ROOT, dotfiles: 'deny'});
});

// Media of a reel (videos with range requests, images). Never node_modules or dotfiles.
app.get('/files/:slug/*', reel, (req: Req, res: Response) => {
  const rel = path.posix.normalize(req.params[0]);
  if (rel.startsWith('..') || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split(/[\\/]/).includes('node_modules')) return res.sendStatus(403);
  res.sendFile(rel, {root: path.join(VIDEOS, req.params.slug), dotfiles: 'deny'}, (err) => {
    if (err && !res.headersSent) res.sendStatus((err as {status?: number}).status ?? 404);
  });
});

// Any image of the workspace, for the agent to show in the chat (![…](/workspace-files/<path>)). Only images
// (no SVG: it could run script), never outside the workspace or inside node_modules.
app.get('/workspace-files/*', (req: Req, res: Response) => {
  const rel = path.posix.normalize(req.params[0]);
  if (!ROOT || rel.startsWith('..') || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split(/[\\/]/).includes('node_modules') || !/\.(png|jpe?g|webp|gif)$/i.test(rel)) return res.sendStatus(404);
  res.sendFile(rel, {root: ROOT, dotfiles: 'allow'}, (err) => {
    if (err && !res.headersSent) res.sendStatus((err as {status?: number}).status ?? 404);
  });
});

// Live updates: tell the UI which reel changed on disk (when the agent, a tool or an editor writes files).
const wss = new WebSocketServer({noServer: true});
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
function send(obj: ServerEvent) {
  const msg = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
chat.setBroadcast(send);
inspiration.setBroadcast(send);
account.setBroadcast(send);
const pending = new Map<string, NodeJS.Timeout>();
const announce = (slug: string) => {
  clearTimeout(pending.get(slug));
  pending.set(
    slug,
    setTimeout(() => {
      pending.delete(slug);
      send({type: 'changed', slug});
    }, 400),
  );
};
let watcher: ReturnType<typeof chokidar.watch> | null = null;
function watchVideos() {
  watcher?.close();
  watcher = null;
  if (!VIDEOS) return;
  const dir = VIDEOS;
  watcher = chokidar
    .watch(dir, {
      ignoreInitial: true,
      ignored: (p) => /(^|[\\/])(node_modules|\.git|__pycache__)([\\/]|$)/.test(p) || /[\\/]assets[\\/]src[\\/]/.test(p),
      awaitWriteFinish: {stabilityThreshold: 300},
    })
    .on('all', (_ev, p) => {
      const slug = path.relative(dir, p).split(path.sep)[0];
      if (slug) announce(slug);
    });
}
watchVideos();

// Styles change on disk when the agent writes one (Nuevo estilo): the Estilos page reloads them.
let styleWatcher: ReturnType<typeof chokidar.watch> | null = null;
let stylesPending: NodeJS.Timeout | undefined;
function watchStyles() {
  styleWatcher?.close();
  styleWatcher = null;
  if (!workspace.STYLES) return;
  styleWatcher = chokidar
    .watch(workspace.STYLES, {ignoreInitial: true, depth: 3, ignored: (p) => /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(p), awaitWriteFinish: {stabilityThreshold: 300}})
    .on('all', () => {
      clearTimeout(stylesPending);
      stylesPending = setTimeout(() => send({type: 'styles'}), 400);
    });
}
watchStyles();

// The same for formats/ (the Formatos page).
let formatWatcher: ReturnType<typeof chokidar.watch> | null = null;
let formatsPending: NodeJS.Timeout | undefined;
function watchFormats() {
  formatWatcher?.close();
  formatWatcher = null;
  if (!workspace.FORMATS) return;
  formatWatcher = chokidar
    .watch(workspace.FORMATS, {ignoreInitial: true, depth: 3, ignored: (p) => /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(p), awaitWriteFinish: {stabilityThreshold: 300}})
    .on('all', () => {
      clearTimeout(formatsPending);
      formatsPending = setTimeout(() => send({type: 'formats'}), 400);
    });
}
watchFormats();

const STUDIO = path.resolve(import.meta.dirname, '..');
const vite = await createVite({
  root: STUDIO,
  // Installed, the app's folder may not be writable (opened from the .dmg, or /Applications without rights):
  // Vite's cache goes to the app's settings folder, and its config is loaded in memory ('runner'), not
  // bundled to a temporary file in node_modules/.vite-temp.
  ...(workspace.PACKAGED ? {cacheDir: path.join(workspace.CONFIG_DIR, 'vite-cache'), configLoader: 'runner' as const} : {}),
  server: {middlewareMode: true, ws: {server}, fs: {allow: [STUDIO]}},
  appType: 'spa',
});
// Reels' source lives outside the Vite root: let Vite serve it (/@fs/) and watch it so edits hot-reload
// the live preview. Again when the workspace changes.
function serveWorkspace() {
  if (!ROOT) return;
  const allow = vite.config.server.fs.allow;
  if (!allow.includes(ROOT)) allow.push(ROOT);
  vite.watcher.add(path.join(VIDEOS, '*/src').replace(/\\/g, '/'));
}
serveWorkspace();
app.use(vite.middlewares);

// A new workspace (welcome page or Ajustes): stop the agents and Inspiración's work in the old one, watch the
// new one and tell every open page to reload.
workspace.onChange(() => {
  chat.stopAll();
  inspiration.reset();
  account.reset();
  watchVideos();
  watchStyles();
  watchFormats();
  serveWorkspace();
  send({type: 'workspace'});
});

// Another project: its videos, Mi cuenta and Inspiración are other folders. Agents working in the old one go on
// (they write to its folders, and their events reach no page of this one); its downloads are left behind.
workspace.onProjectChange(() => {
  inspiration.reset();
  account.reset();
  watchVideos();
  serveWorkspace();
  send({type: 'workspace'});
});

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    chat.stopAll();
    process.exit(0);
  });

// Commands the studio runs (npm, ffmpeg, python…) need the terminal's PATH, also when opened from the Dock.
await loadShellPath();

// Find the agent CLI now, so the first message doesn't wait for it (and the log says if it's missing).
for (const a of AGENTS)
  a.status().then((s) => {
    const used = a === currentAgent() ? ' (por defecto)' : '';
    console.log(s.installed ? `${s.label} ${s.version ?? ''} → ${s.path}${s.loggedIn ? '' : ' (sin sesión)'}${used}` : `${used ? '⚠ ' : ''}${s.error}${used}`);
  });

// The agents' tools call this server (tools/social.py): they inherit its address.
process.env.REEL_STUDIO_URL = `http://${HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST}:${PORT}`;
server.listen(PORT, HOST, () => {
  console.log(`Reel Studio → http://localhost:${PORT}`);
  automations.startScheduler(() => send({type: 'automations'}));
  if (HOST === '0.0.0.0') {
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i!.address);
    for (const ip of ips) console.log(`  desde otra máquina → http://${ip}:${PORT}`);
  }
});
