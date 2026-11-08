// The shapes that travel between the server (server/) and the UI (src/). Both import them from here,
// so `npm run typecheck` catches a field changed on one side and not the other.

/* ───── Reels ───── */

// How far the video is from done, judged from the reel's files. note says why a step that was done
// no longer counts (e.g. the script changed after the voice).
export type StepKey = 'guion' | 'voz' | 'sonido' | 'render';
export type ProgressStep = {key: StepKey; label: string; done: boolean; note?: string};
export type Version = {name: string; url: string; size: number; mtime: number};
export type Word = {w: string; s: number; e: number};
export type Act = {name: string; start: number | null; end: number | null};
export type BoardGroup = {name: string; images: string[]; mtime: number};
// Script structure: each part of the script starts at a line tagged with its beat. Kept in
// audio/beats.json, outside vo.txt (that text goes to the TTS as-is). `line` is the text of the line
// where the part starts, so the tag finds its line again after edits elsewhere.
export const BEAT_TAGS = ['hook', 'contexto', 'rehook', 'desarrollo', 'ejemplo', 'payoff', 'cta', 'cierre'] as const;
export type BeatTag = (typeof BEAT_TAGS)[number];
export type Beat = {tag: BeatTag; line: string};


export type ReelSummary = {
  slug: string;
  title: string | null; // title.txt, named from the first message
  style: StyleRef | null; // style.txt (an id in styles/), or the default style
  videoFormat: ReelFormatRef | null; // format.txt (an id in formats/), or the default format
  hook: string;
  progress: ProgressStep[];
  latest: Version | null;
  versionCount: number;
  thumb: string | null;
  updated: number;
  words: number;
  seconds: number; // estimated at the video's voice pace
  voice: VoiceRef | null; // the voice that narrates it (the global one, or its own voice.json)
  pace: number; // spoken words per second with that voice
  instagram: PostedReel | null; // the reel it was posted as, if Mi cuenta has it
};

// In the detail, words is the timed VO (src/words.json), not the summary's word count.
export type ReelDetail = Omit<ReelSummary, 'words'> & {
  script: string;
  beats: Beat[];
  words: Word[];
  voiceStale: boolean;
  hasVoice: boolean;
  acts: Act[];
  versions: Version[];
  cutouts: {name: string; url: string}[];
  boards: BoardGroup[];
  credits: string;
  caption: string;
  automation: string; // automatizacion.json as it is on disk: the comment-to-DM automation (ManyChat, InstantDM)
  thumbnail: {url: string; mtime: number} | null; // out/miniatura.png (./thumb.sh renders it): the cover posted with the reel
  previewEntry: string | null;
  format: Format | null; // src/format.json; null in videos made before it existed (1080×1920 at 30 fps in their Root.tsx)
  footage: FootageClip[]; // footage/: his own recording, for formats with footage
};

export type SkillCategory = 'general' | 'style' | 'format';
export type SkillSummary = {id: string; name: string; description: string; category: SkillCategory; path: string; fileCount: number};
export type SkillFile = {path: string; size: number};
export type SkillDetail = SkillSummary & {entry: string; files: SkillFile[]};
export type SkillDocument = {path: string; content: string | null; note?: string};
export type FootageClip = {name: string; url: string; size: number; mtime: number};

/* ───── Visual styles (styles/<id>/style.json at the repo root) ───── */

export type StyleColor = {name: string; hex: string; meaning: string};
export type StyleFont = {family: string; css: string; weight?: number; google?: string; use: string; sample: string}; // google: the family as Google Fonts' css2 wants it
// A style as a video names it. ready: it has its own skill and template.
// ready: the style has its own skill and template. template: the folder new videos copy (its own, or the default style's).
// How a video's thumbnail (its cover) looks in this style: style.json "thumbnail".
export type StyleThumbnail = {look: string[]; avoid: string[]; example: string | null}; // example: url of a sample
export type StyleRef = {id: string; name: string; ready: boolean; skill: string | null; template: string};
export type Style = {
  id: string;
  name: string;
  summary: string;
  default: boolean; // the workspace's default (style.json "default": true)
  projectDefault: boolean; // the open project's default (Ajustes → Perfil, its profile.json "style"); wins over default
  skill: string | null; // the skill that makes videos in this style (repo-relative)
  template: string | null; // the folder new videos are copied from
  cutouts: boolean; // makes photo cutouts (needs the Python venv with rembg)
  palette: StyleColor[];
  fonts: StyleFont[];
  look: string[];
  motion: string[];
  sources: string[]; // where its pictures come from
  avoid: string[];
  thumbnail: StyleThumbnail | null;
  examples: string[]; // urls of approved frames
  references: string[]; // urls of the inspiration it came from
};

/* ───── Formats: the kind of video (formats/<id>/format.json at the repo root) ───── */

// How a video is made, apart from how it looks (that's its style): all animation over a generated voice, or the
// creator talking to camera with animations over his recording, … footage: it needs his recording (uploaded to
// footage/); voiceOnly: of that recording only his voice is used (audio, or a video whose picture is dropped).
export type ReelFormatRef = {id: string; name: string; footage: boolean; voiceOnly: boolean; skill: string | null};
export type ReelFormat = {
  id: string;
  name: string;
  summary: string;
  default: boolean; // the workspace's default (format.json "default": true)
  skill: string | null; // the skill that makes videos in this format (repo-relative)
  overlay: string | null; // files it adds over the style's template when a video is created
  footage: boolean;
  voiceOnly: boolean;
  how: string[]; // how a video in this format gets made
  screen: string[]; // what's on screen
  editing: string[]; // how it's cut
  avoid: string[];
  examples: string[]; // urls of frames of videos made in it
  references: string[]; // urls of the references it came from
};

/* ───── Ideas de contenido (projects/<id>/ideas.json) ───── */

export const IDEA_COLORS = ['blue', 'green', 'amber', 'pink', 'violet', 'teal', 'orange', 'red', 'gray'] as const;
export type IdeaColor = (typeof IDEA_COLORS)[number];
// The icons a vertical can have (lucide's names; the page maps each one to its component). The first is the default.
export const IDEA_ICONS = [
  'lightbulb', 'wallet', 'piggy-bank', 'trending-up', 'landmark', 'briefcase', 'rocket', 'code', 'cpu',
  'bot', 'shield', 'globe', 'graduation-cap', 'book-open', 'brain', 'flask-conical', 'heart', 'heart-pulse',
  'dumbbell', 'utensils', 'plane', 'house', 'leaf', 'camera', 'clapperboard', 'mic', 'music', 'gamepad-2',
  'palette', 'pen-tool', 'megaphone', 'users', 'message-circle', 'newspaper', 'scale', 'sparkles', 'flame',
  'star', 'target', 'trophy',
] as const;
export type IdeaIcon = (typeof IDEA_ICONS)[number];
// A content vertical: a line of content the channel works on. Its description says what belongs in it.
export type IdeaVertical = {id: string; name: string; description: string; color: IdeaColor; icon: IdeaIcon};
export type Idea = {
  id: string;
  title: string;
  notes: string;
  vertical: string | null; // id of its IdeaVertical, if it has one
  created: number;
  updated: number;
};
export type IdeaList = {id: string; name: string; cards: Idea[]}; // cards in their order
export type IdeasBoard = {verticals: IdeaVertical[]; lists: IdeaList[]};

/* ───── Perfil de audiencia (projects/<id>/config/audience.json; the "who" is the profile's audience) ───── */

export type AudienceWant = {want: string; so1: string; so2: string}; // What they want → So I can… → So I can…
export type AudienceLevels = {problem: string; unaware: string; problemAware: string; solutionAware: string; productAware: string};
export type Audience = {
  who: string;
  result: string;
  product: {what: string; price: string; problems: string}; // what empty: no product
  wants: AudienceWant[];
  problems: string[]; // named problems, most important first
  levels: AudienceLevels[]; // one row per top problem
  onboarded: boolean;
};
// Reel page → Alineación con tu audiencia: the script judged against the Perfil de audiencia (videos/<slug>/audience-check.json).
export type ScriptCheckLevel = 'unaware' | 'problemAware' | 'solutionAware' | 'productAware' | '';
export type ScriptCheckCriterion = {key: string; label: string; score: number; max: number; note: string};
export type ScriptCheck = {
  score: number; // 0–100, the sum of the criteria
  verdict: string;
  problem: string; // the profile's problem or want it speaks to, '' if none
  level: ScriptCheckLevel; // the awareness level it talks to
  criteria: ScriptCheckCriterion[];
  good: string[];
  fixes: {line: string; why: string; try: string}[];
  script: string; // hash of the script it judged
  at: number;
  model?: string; // who judged it: the agent and its model ("Claude Code · claude-sonnet-…"); older checks don't say
};
export type ScriptCheckState = {audience: boolean; script: boolean; running: boolean; stale: boolean; check: ScriptCheck | null; error: string};
// Reel page → Fuerza del gancho: the script's opening judged on a fixed rubric (videos/<slug>/hook-check.json).
export type HookCheck = {
  score: number; // 0–100, the sum of the criteria
  verdict: string;
  hook: string; // the opening it judged as the hook, quoted from the script
  question: string; // the question it leaves the viewer with, '' if none
  criteria: ScriptCheckCriterion[];
  good: string[];
  fixes: {line: string; why: string; try: string}[];
  alternatives: {hook: string; second: string}[]; // other openings, each with its second sentence
  script: string; // hash of the script it judged
  at: number;
  model?: string;
};
// The model each script review runs on, per project and agent (its badge on the reel page). chosen: '' = the default.
export type CheckModels = {agent: string; options: {id: string; label: string}[]; chosen: Record<'audience' | 'hook', string>};
export type HookCheckState = {script: boolean; running: boolean; stale: boolean; check: HookCheck | null; error: string};
export type WantOption = {so1: string; so2: string};
export type Pillar = {name: string; icon: IdeaIcon; wants: string[]; posts: string[]; narrow: string};
export type PillarSet = {name: string; pillars: Pillar[]; leftovers: string[]};

/* ───── Where Cristian is in the UI (sent with every message to the agent) ───── */

export type UiContext = {
  page: 'account' | 'library' | 'ideas' | 'audience' | 'automations' | 'sources' | 'inspiration' | 'styles' | 'formats' | 'settings' | 'new' | 'reel';
  slug?: string;
  style?: string; // style open on the Estilos page (styles/<id>)
  videoFormat?: string; // format open on the Formatos page (formats/<id>)
  version?: string; // out/<version>.mp4 in the player
  live?: boolean; // live preview of the code instead of a render
  t?: number; // player time, seconds
  act?: string;
  playing?: boolean;
  tab?: string; // assets tab open (Recortes, Boards…)
  scriptDirty?: boolean;
  inspiration?: string; // account (and reel) open on the Inspiración page: "@user" or "@user/CODE"
  sourceItem?: string; // result open on the Fuentes de información page (its id)
};

/* ───── Chat ───── */

export type Comment = {id: string; t: number; act?: string; said?: string; version?: string; live?: boolean; text: string; frame?: string};
export type ChatItem =
  | {id: string; role: 'user'; text: string; comments: Comment[]; refs?: InspirationRef[]; ideas?: IdeaRef[]; images?: string[]; ts: number} // images: pasted ones, at /chat-images/<name>
  | {id: string; role: 'assistant'; text: string; ts: number}
  | {id: string; role: 'tool'; name: string; summary?: string; result?: string; isError?: boolean; done?: boolean; ts: number}
  | {id: string; role: 'permission'; name: string; summary?: string; detail?: string; state: 'pending' | 'allowed' | 'denied' | 'expired'; ts: number} // the agent asking before it acts
  | {id: string; role: 'status'; text: string; error?: boolean; ts: number};
export type ChatState = {
  id: string;
  sessionId: string | null;
  resume: string | null; // command that continues this conversation in a terminal
  items: ChatItem[];
  running: boolean;
  started: number | null;
  live: string;
  tool: string | null;
  model: string; // '' = the CLI's default
  effort: string; // '' = the model's default
  mode: string; // how it asks for permission; '' if this agent has no choice
  context: ChatContext | null; // how full the session's context window is, as of its last reply
};

// The model and reasoning effort a conversation runs with, chosen in the chat's message box.
export type AgentModel = {id: string; label: string; efforts: string[]; defaultEffort: string | null; contextWindow: number | null};
// How a conversation asks for permission (the first is the default). Chosen in its message box.
export type PermissionMode = {id: string; label: string; description: string};
// A slash command for the message box: the CLI's own (its skills and built-ins) or the studio's (studio: true).
export type ChatCommand = {name: string; description: string; args?: string; studio?: boolean};
// What the message box offers with the agent in use.
// choice: what a new conversation starts on (the last one chosen in this project, else the CLI's defaults).
export type ChatOptions = {agent: string; models: AgentModel[]; modes: PermissionMode[]; commands: ChatCommand[]; choice: {model: string; effort: string}};
// used: tokens in the context after the last reply (null: unknown, e.g. just compacted); window: the model's size.
export type ChatContext = {used: number | null; window: number | null};

// A key's conversations (a reel's, or the general one), shown as tabs; closed ones stay in the history.
// agent: the CLI whose session it is (null: none yet, so it'll be the one in use).
export type ChatMeta = {id: string; title: string | null; created: number; lastTs: number | null; running: boolean; unread: boolean; closed: boolean; agent: string | null};
export type ChatList = {active: string; chats: ChatMeta[]};

/* ───── Agents (sidebar) ───── */

export type AgentState = 'working' | 'needs' | 'review' | 'error' | 'idle' | 'new';
export type AgentInfo = {
  key: string;
  state: AgentState;
  started: number | null;
  tool: string | null;
  snippet: string;
  lastTs: number | null;
  error: string | null;
  agent: string | null; // the CLI of the conversation this state is from (null: none yet, so the one in use)
};
export type Agent = AgentInfo & {
  slug: string | null; // null = the general conversation (library)
  title: string | null;
};

/* ───── Image sources (config/images.json, set in Ajustes → Extracción de datos) ───── */

// Image tools, without a mandatory order. Entries without keys are always available;
// settings only toggle API integrations. Each tool lives in tools/ at the repo root.
export const IMAGE_SOURCES = [
  {id: 'commons', label: 'Wikimedia Commons', key: null, tool: 'commons.py', license: 'CC0, dominio público o CC BY / BY-SA (estas piden autor y licencia en los créditos)'},
  {id: 'openverse', label: 'Openverse', key: null, tool: 'openverse.py', license: 'CC0, dominio público o CC BY / BY-SA de Flickr, NASA, museos y más (las CC BY piden autor y licencia en los créditos)'},
  {id: 'pexels', label: 'Pexels', key: 'PEXELS_API_KEY', tool: 'pexels.py', license: 'Licencia Pexels: uso libre, crédito opcional'},
  {id: 'pixabay', label: 'Pixabay', key: 'PIXABAY_API_KEY', tool: 'pixabay.py', license: 'Licencia Pixabay: uso libre, crédito opcional; fotos, ilustraciones y vectores'},
  {id: 'unsplash', label: 'Unsplash', key: 'UNSPLASH_ACCESS_KEY', tool: 'unsplash.py', license: 'Licencia Unsplash: uso libre, con crédito al fotógrafo y a Unsplash'},
  {id: 'generated', label: 'Imágenes generadas (OpenAI)', key: 'OPENAI_API_KEY', tool: 'generate_image.py', license: 'Generadas con IA: se anotan como tales en los créditos'},
] as const;
export type ImageSourceId = (typeof IMAGE_SOURCES)[number]['id'];
export type ImageSources = Record<ImageSourceId, boolean>; // keyless tools always true; API integrations also need their key

/* ───── Social-media scraper (config/social.json, set in Ajustes → Extracción de datos) ───── */

// Where Inspiración downloads Instagram reels from: one at a time, each with its own key.
export const SOCIAL_SOURCES = [
  {id: 'apify', label: 'Apify', key: 'APIFY_TOKEN', pricing: 'Cobra por reel de tu saldo. El plan gratuito trae 5 US$ al mes; para gastar más hace falta un plan mensual.'},
  {
    id: 'scrapecreators',
    label: 'ScrapeCreators',
    key: 'SCRAPECREATORS_API_KEY',
    pricing: 'Créditos de prepago que no caducan, sin mensualidad: 25 000 por 47 US$ y 100 gratis al registrarte. Gasta 1 crédito por petición.',
  },
] as const;
export type SocialSourceId = (typeof SOCIAL_SOURCES)[number]['id'];

/* ───── Requirements (Ajustes → Requisitos) ───── */

// A program or download the studio relies on. neededBy: null when every video needs it, else what uses it
// (styles, or Inspiración); empty: nothing in the workspace uses it now, and unused says what would.
// fix: how to install or repair it; auto when the studio can run it itself (button), otherwise a command to copy.
export type Requirement = {
  id: string;
  label: string;
  ok: boolean;
  version: string | null;
  detail: string;
  neededBy: string[] | null;
  unused?: string;
  fix: {label: string; command: string; auto: boolean} | null;
  job: {running: boolean; ok: boolean | null; log: string; started: number} | null;
};

/* ───── Settings ───── */

export type KeyStatus = {
  name: string;
  label: string;
  set: boolean;
  last4: string | null;
  check: {ok: boolean; info: string; at: number} | null;
};
export type Settings = {mode: 'local' | 'account'; keys: KeyStatus[]};

// The coding-agent CLI the studio drives: the one installed on this machine, with its own login.
export type AgentCliStatus = {
  id: string; // 'claude' | 'codex'
  label: string; // 'Claude Code' | 'Codex'
  installed: boolean;
  path: string | null;
  version: string | null;
  loggedIn: boolean;
  account: string | null; // e.g. "tú@correo · Org · team"
  error: string | null;
  checkedAt: number;
};

// Ajustes → Agente: every CLI the studio knows, and the one it uses (current).
export type AgentChoice = {current: string; agents: AgentCliStatus[]};
// What's left of a plan: one window per limit (the session's, the week's). resetsAt in ms; null when it isn't known.
// asOf: when a CLI that can't be asked last said it (Codex, in its session logs); null: it's the current figure.
// note: why there are no windows.
export type AgentUsageWindow = {label: string; percent: number; resetsAt: number | null};
export type AgentUsage = {windows: AgentUsageWindow[]; asOf: number | null; note: string | null};

/* ───── Websocket events ───── */

export type ChatEvent =
  | {op: 'append' | 'patch'; item: ChatItem}
  | {op: 'delta'; text: string}
  | {op: 'tool'; tool: string}
  | {op: 'state'; running: boolean; started?: number}
  | {op: 'session'; sessionId: string; resume: string}
  | {op: 'context'; context: ChatContext}
  | {op: 'options'; model: string; effort: string}
  | {op: 'mode'; mode: string}
  | {op: 'moved'; to: string} // a general conversation went on in the video it created
  | {op: 'chats'};

// workspace: the studio now works on another folder (every page reloads).
export type ServerEvent = {type: 'changed'; slug: string} | {type: 'workspace'} | {type: 'inspiration'} | {type: 'account'} | {type: 'projects'} | {type: 'ideas'} | {type: 'sources'} | {type: 'automations'} | {type: 'styles'} | {type: 'formats'} | ({type: 'chat'; slug: string; chat: string} & ChatEvent);

/* ───── Profile and voice (config/, set in Ajustes) ───── */

// Who makes the videos and for whom. The agent's prompts follow it over the skills' defaults.
export type Profile = {
  name: string;
  language: string; // of the videos and of the conversation with the agent
  platform: string;
  audience: string;
  duration: number; // target length in seconds
  caption: string; // rules for the post's caption
  notes: string; // anything else the agent should always keep in mind
  format: Format; // of new videos; set from the platform's preset, can be changed by hand
  style: string | null; // the style new videos start in (styles/<id>); null: the workspace's default
};

// Size, frame rate and loudness target of a video. Each video keeps its own in src/format.json, copied
// from the profile when it's created (the template's Root.tsx, lib.ts, render.sh, snap.sh and mix.py read it).
export type Format = {width: number; height: number; fps: number; lufs: number};
export const FPS_OPTIONS = [24, 25, 30, 50, 60] as const;
const VERTICAL: Format = {width: 1080, height: 1920, fps: 30, lufs: -14};
// What each platform asks for. Unknown platforms get the first one.
export const PLATFORM_FORMATS: Record<string, Format> = {
  'Instagram Reels': VERTICAL,
  TikTok: VERTICAL,
  'YouTube Shorts': VERTICAL,
  LinkedIn: VERTICAL,
};
export const platformFormat = (platform: string): Format => PLATFORM_FORMATS[platform] ?? VERTICAL;

// The narration voice (ElevenLabs). wordsPerSec is measured from a sample with these settings.
export type Voice = {
  enabled: boolean; // off: no narration is generated (the agent works with stand-in timings)
  voiceId: string | null;
  voiceName: string | null;
  model: string;
  speed: number;
  stability: number;
  similarity: number;
  style: number;
  speakerBoost: boolean;
  wordsPerSec: number;
};
export type VoiceRef = {id: string; name: string; own: boolean}; // own: the video has its own voice
// A voice of the ElevenLabs account, to choose from.
export type VoiceOption = {id: string; name: string; category: string; description: string | null; previewUrl: string | null; labels: string[]};
export type VoiceModel = {id: string; name: string; description: string | null; languages: string[]};
export type VoiceSample = {audio: string; seconds: number; words: number; wordsPerSec: number}; // audio: data: URL

/* ───── Inspiración (inspiration/ in the workspace) ───── */

// What the agent says about one reel (analysis.json). Text in the creator's language.
export type ReelAnalysis = {
  topic: string;
  hook: {text: string; visual: string; why: string}; // the first 3 s
  structure: {tag: BeatTag; start: number; end: number; summary: string}[];
  visuals: string[]; // visual devices (text on screen, b-roll, face to camera…)
  cta: string | null;
  takeaways: string[]; // what's worth borrowing
  at: number;
};
export type ReelTranscript = {language: string | null; duration: number | null; text: string; segments: {start: number; end: number; text: string}[]; words: number; wps: number | null; noAudio?: boolean};

// A reel of another account, downloaded with Apify. views: plays shown on Instagram (or views when absent).
// ratio: views over the median of the account's downloaded reels (null for accounts with fewer than 5).
export type InspirationReel = {
  account: string;
  code: string;
  url: string;
  caption: string;
  posted: string | null; // ISO date
  views: number | null;
  likes: number | null;
  comments: number | null;
  duration: number | null;
  music: string | null;
  ratio: number | null;
  files: {thumb: boolean; hook: boolean; sheets: string[]};
  transcript: ReelTranscript | null;
  analysis: ReelAnalysis | null;
  // pending: waiting to be processed · processed: transcribed, waiting for "Analizar video" (loose videos are
  // never analysed on their own) · error: the last processing or analysis failed
  state: 'pending' | 'processing' | 'processed' | 'analyzing' | 'ready' | 'error';
  error: string | null;
  added: number;
  metricsAt: number; // when views, likes, comments and meta were read from Instagram ("Actualizar métricas")
  refreshing: boolean; // reading them again now
  // The metadata saved with them (meta.json, all Apify returned), the fields worth listing: text, numbers,
  // yes/no, lists of text; objects flattened one level ("musicInfo.song_name").
  meta: Record<string, string | number | boolean | string[]> | null;
};

// A row of the reels table (from the index, server/inspiration-index.ts): what the table shows; the card asks
// for the whole reel (InspirationReel).
export type InspirationRow = {
  account: string;
  code: string;
  url: string;
  title: string; // the agent's topic, else the caption's first line, else the code
  hook: string | null; // what's said and read in the first 3 s
  posted: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  duration: number | null;
  ratio: number | null;
  wps: number | null;
  state: InspirationReel['state'];
  error: string | null;
  thumb: boolean;
  metricsAt: number;
};
export type InspirationList = {rows: InspirationRow[]; total: number; counts: Partial<Record<InspirationReel['state'], number>>; accounts: string[]};

// What's running for an account (in memory; reels left half-way show as pending after a restart).
export type InspirationJob = {stage: 'fetching' | 'processing' | 'analyzing' | 'summary'; done: number; total: number; started: number};

// From Apify's profile scraper, when the account is scanned or updated.
export type InspirationProfile = {followers: number | null; following: number | null; posts: number | null; bio: string | null; verified: boolean; category: string | null; website: string | null; at: number};

export type InspirationAccount = {
  username: string;
  fullName: string | null;
  profile: InspirationProfile | null;
  avatar: boolean; // avatar.jpg, its profile picture
  followed: boolean; // added as an account (false: only loose reels of it were added)
  added: number;
  fetched: number | null;
  reels: number;
  median: number | null;
  analysis: {text: string; at: number; reels: number; codes?: string[]} | null; // the account as a whole (markdown); codes: the reels it read, most viewed first (absent in older ones)
  job: InspirationJob | null;
  error: string | null; // the last fetch or job failure
};

export type InspirationStatus = {
  accounts: InspirationAccount[];
  scraper: {id: SocialSourceId; label: string; ready: boolean}; // the source in use; ready: its key is set
  transcriber: boolean; // faster-whisper and its model ready (Ajustes → Requisitos)
  loose: {job: InspirationJob | null; error: string | null}; // downloading loose reels (owners not known yet)
};

// A reel attached to a message of the general conversation: one of Inspiración's ("Usar como referencia"), or, own,
// one of his account's (Mi cuenta → "Preguntar sobre este reel").
export type InspirationRef = {account: string; code: string; label: string; own?: boolean};
// An idea from Ideas de contenido attached to a message: the server reads the rest from the board.
export type IdeaRef = {id: string; title: string};

/* ───── Mi cuenta: the creator's own Instagram account (config/account.json; its reels in account/<user>/) ───── */

export type OwnReel = {
  code: string;
  url: string;
  caption: string;
  posted: string | null;
  views: number | null;
  likes: number | null; // null when hidden
  comments: number | null;
  duration: number | null;
  music: string | null;
  thumb: boolean; // thumb.jpg, its cover
  ratio: number | null; // views ÷ the median of the loaded reels (needs 5)
  engagement: number | null; // (likes + comments) ÷ views
  metricsAt: number;
  video: {slug: string; title: string | null} | null; // the project's video it was made from (matched by its text)
  // Its analysis, started by hand ("Analizar"): like Inspiración's (the video is transcribed, its frames taken,
  // then the agent analyses it), plus queued: waiting for its turn.
  state: 'pending' | 'queued' | 'processing' | 'processed' | 'analyzing' | 'ready' | 'error';
  error: string | null;
  topic: string | null; // the agent's, once analysed
  hook: string | null; // what's said and read in the first 3 s (the agent's)
  wps: number | null; // words per second of the voice, once transcribed
  // From Instagram itself, through his Reel Studio account (Ajustes → Instagram); null without it or while Meta
  // has nothing yet (up to 48 h after posting).
  saves: number | null;
  shares: number | null;
  reach: number | null; // accounts that saw it (Meta's estimate)
  avgWatch: number | null; // seconds watched per play, on average
  retention: number | null; // avgWatch ÷ duration
  skipRate: number | null; // % of plays skipped in the first seconds
};

// A reel's card in Mi cuenta: the reel, its place by views (0: no views), its saved metadata (flattened like
// Inspiración's), and once processed its transcript, frames and the agent's analysis.
export type OwnReelCard = {
  reel: OwnReel;
  rank: number;
  meta: Record<string, string | number | boolean | string[]> | null;
  transcript: ReelTranscript | null;
  analysis: ReelAnalysis | null;
  files: {hook: boolean; sheets: string[]};
};

// A video's reel on Instagram (Mi cuenta), for the library.
export type PostedReel = {code: string; url: string; views: number | null; ratio: number | null; posted: string | null};

// Mi cuenta's table: one page of the reels (the studio's index), filtered and in order.
export type OwnReelList = {rows: OwnReel[]; total: number};

export type AccountStatus = {
  username: string | null; // null: not set up yet
  fullName: string | null;
  profile: InspirationProfile | null;
  avatar: boolean;
  fetched: number | null; // last download
  count: number; // reels downloaded
  top: OwnReel[]; // the most viewed
  median: number | null;
  engagement: number | null; // mean of the reels' (likes + comments) ÷ views
  job: {limit: number; started: number} | null; // downloading now
  error: string | null; // of the last download
  states: Partial<Record<OwnReel['state'], number>>; // reels by their analysis's state
  analysis: {done: number; total: number; started: number} | null; // reels being analysed now (Analizar), in memory
  transcriber: boolean; // faster-whisper ready (Ajustes → Requisitos): analysing needs it
  scraper: {id: SocialSourceId; label: string; ready: boolean};
  // Instagram's own numbers (saves, shares…), read with each download when the project has an account in
  // Ajustes → Instagram: which one, when they were last read and what went wrong then.
  insights: {account: string | null; at: number | null; error: string | null};
};

/* ───── Reel Studio's account (server/cloud.ts, the ai-reel-gen-cloud site) ───── */

// insights: false → it was connected before the metrics permission: connect it again in the panel.
export type CloudAccount = {id: number; username: string; name: string | null; pictureUrl: string | null; tokenExpiresAt: string; insights: boolean};
// account: the one this project uses (picked, or the one with Mi cuenta's handle).
export type CloudStatus = {
  url: string;
  email: string | null;
  signedIn: boolean;
  user: {email: string; name: string | null} | null;
  metaApp: boolean;
  accounts: CloudAccount[];
  panelUrl: string;
  account: CloudAccount | null;
  error: string | null;
};
export type CloudReelMetrics = {views: number | null; reach: number | null; saves: number | null; shares: number | null; likes: number | null; comments: number | null; interactions: number | null; avgWatchMs: number | null; totalWatchMs: number | null; skipRate: number | null; reposts: number | null};
export type CloudReelInsights = {code: string | null; mediaId: string; permalink: string | null; postedAt: string | null; metrics: CloudReelMetrics; error: string | null};

/* ───── Projects: one per channel, in projects/<id>/ (server/workspace.ts) ───── */

// avatar: when its picture (projects/<id>/avatar.*) last changed, for the image's URL; null: none (its initial shows).
export type Project = {id: string; name: string; created: number; videos: number; current: boolean; avatar: number | null};
// What deleting a project would take with it. account: its Instagram handle; reels: those downloaded in Mi cuenta.
export type ProjectContents = {videos: number; ideas: number; verticals: number; account: string | null; reels: number; inspiration: number; conversations: number};

/* ───── Automatizaciones (projects/<id>/automations.json) ───── */

// What a step does; other kinds of action join this union. account: downloads the newest reels of Mi cuenta and its
// profile. post: reads one of Mi cuenta's reels again (label: its caption when it was chosen, to tell which one it is).
export const MAX_ACCOUNT_REELS = 200;
export const MAX_ANALYSIS_SECONDS = 180; // the longest reel an account's "Analizar…" takes
// agent step: agent/model/effort pin the CLI it runs on (absent: the one in Ajustes, with its starting choice).
// sources: an agent extracts what's new from Fuentes de información (those ids; none: every active one), on its CLI like an agent step.
export type AutomationStep = {type: 'agent'; prompt: string; agent?: string; model?: string; effort?: string} | {type: 'sources'; sources: string[]; agent?: string; model?: string; effort?: string} | {type: 'account'; limit: number} | {type: 'post'; code: string; label: string} | {type: 'external'; username: string; limit: number}; // username ALL_EXTERNAL: every scanned account of the project when it runs
export const ALL_EXTERNAL = '*';
export type Automation = {id: string; name: string; cron: string; enabled: boolean; steps: AutomationStep[]; created: number};
export type AutomationInput = Pick<Automation, 'name' | 'cron' | 'enabled' | 'steps'>;
// interrupted: the studio closed while it was running.
export type AutomationRunState = 'running' | 'done' | 'error' | 'stopped' | 'interrupted';
// A step as it was when the run started. chat: its conversation (an agent's, once started). summary: what it ended up saying or doing.
// video: the video its conversation moved to (it made one); absent: it's in the general conversation. videos: the ones it created.
export type AutomationRunStep = AutomationStep & {state: AutomationRunState | 'pending'; chat: string | null; video?: string; videos?: string[]; summary?: string};
// stopping: asked to stop while a step that can't be cut short finishes.
export type AutomationRun = {id: string; automation: string; name: string; trigger: 'cron' | 'manual'; started: number; ended: number | null; state: AutomationRunState; stopping?: boolean; error?: string; steps: AutomationRunStep[]};
// runs: most recent first.
// Automatizaciones → a step's agent: each CLI that can run one, with its models and what a new conversation starts on.
export type AutomationAgent = {id: string; label: string; ready: boolean; default: boolean; models: AgentModel[]; choice: {model: string; effort: string}};
export type AutomationsView = {automations: (Automation & {running: boolean})[]; runs: AutomationRun[]};

/* ───── Fuentes de información (projects/<id>/sources/) ───── */

export type SourceLink = {url: string; label: string};
// The last time an agent went through it (sources.py done). added: new results it saved.
export type SourceRun = {at: number; ok: boolean; added: number; note: string};
// description: what he wants from it, in his words; instructions: for the agent that extracts it (markdown). How to read
// it is always the agent's call, with whatever it has (fetch, RSS, readers, his Chrome when he's there, Apify).
export type Source = {id: string; name: string; description: string; instructions: string; links: SourceLink[]; enabled: boolean; created: number; updated: number; lastRun: SourceRun | null};
// new: not opened yet; read; used: went into an idea or a video; discarded.
export const SOURCE_ITEM_STATES = ['new', 'read', 'used', 'discarded'] as const;
export type SourceItemState = (typeof SOURCE_ITEM_STATES)[number];
// One thing an extraction found. url: its own page (unique within its source); published: the date it came out (YYYY-MM-DD).
export type SourceItem = {id: string; source: string; title: string; url: string; links: SourceLink[]; summary: string; published: string | null; extracted: number; tags: string[]; state: SourceItemState};
export type SourceItemDetail = SourceItem & {markdown: string};
// items/fresh: how many results each source has, and how many not opened yet.
export type SourcesView = {sources: (Source & {items: number; fresh: number})[]; tags: string[]};
export type SourceItemList = {rows: SourceItem[]; total: number};
