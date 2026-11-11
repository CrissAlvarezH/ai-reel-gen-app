// ScrapeCreators (scrapecreators.com): Inspiración's other source of Instagram reels, chosen in Ajustes →
// Extracción de datos → Redes sociales. Prepaid credits that don't expire (no monthly plan): 1 credit per
// request. Its answers are turned into the shape Apify's reel scraper gives (SourceItem), which is what
// inspiration.ts stores; meta.json keeps ScrapeCreators' own answer (raw).
//   GET /v1/instagram/user/reels?handle=…&max_id=…  a page of an account's reels (no captions)
//   GET /v1/instagram/post?url=…                     one reel, with its caption (cache_max_age: free if cached)
//   GET /v1/instagram/profile?handle=…               the account's picture, followers, bio…
//   GET /v1/account/credit-balance                   what's left
import {getKey} from './settings.ts';

export const KEY = 'SCRAPECREATORS_API_KEY';
// The pack price (25 000 credits for 47 US$), for estimates in dollars.
export const CREDIT_USD = 47 / 25000;
// Reels per page of /user/reels (as seen; it may vary), for estimates.
export const PAGE = 12;

// The common shape (Apify's field names); raw: what the source returned, for meta.json.
export type SourceItem = {
  shortCode?: string;
  url?: string;
  caption?: string;
  timestamp?: string;
  type?: string;
  videoUrl?: string;
  displayUrl?: string;
  videoPlayCount?: number;
  videoViewCount?: number;
  likesCount?: number;
  commentsCount?: number;
  videoDuration?: number;
  ownerUsername?: string;
  ownerFullName?: string;
  musicInfo?: {artist_name?: string; song_name?: string};
  inputUrl?: string;
  error?: string;
  errorDescription?: string;
  raw?: unknown;
};
export type SourceProfile = {
  username?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  verified?: boolean;
  businessCategoryName?: string;
  externalUrl?: string;
  profilePicUrl?: string;
  profilePicUrlHD?: string;
};

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Also Investigación's (server/research-platforms.ts): any endpoint, with the key in Ajustes.
export async function api(path: string, params: Record<string, string | undefined>, key = getKey(KEY)): Promise<J> {
  if (!key) throw new Error('falta la clave de ScrapeCreators: ponla en Ajustes → Extracción de datos → Redes sociales');
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const r = await fetch(`https://api.scrapecreators.com${path}${q.size ? `?${q}` : ''}`, {headers: {'x-api-key': key}, signal: AbortSignal.timeout(90_000)});
  const body = (await r.json().catch(() => null)) as J | null;
  if (r.status === 401) throw new Error('clave rechazada por ScrapeCreators');
  if (r.status === 402) throw new Error('ScrapeCreators: no te quedan créditos (recarga en scrapecreators.com)');
  if (!r.ok || body?.success === false) throw new Error(`ScrapeCreators respondió ${r.status}${body?.message ? `: ${body.message}` : body?.error ? `: ${body.error}` : ''}`);
  return body ?? {};
}

const iso = (t: unknown) => (typeof t === 'number' && t > 0 ? new Date(t * 1000).toISOString() : undefined);
const nums = (...vs: unknown[]) => vs.find((v): v is number => typeof v === 'number' && Number.isFinite(v));
const strs = (...vs: unknown[]) => vs.find((v): v is string => typeof v === 'string' && !!v);

// A reel from an account's reels page (items[n].media).
function fromReel(m: J): SourceItem {
  const music = m.clips_metadata?.music_info?.music_asset_info;
  const orig = m.clips_metadata?.original_sound_info;
  const user = m.user ?? m.owner ?? {};
  return {
    shortCode: m.code,
    url: m.code ? `https://www.instagram.com/reel/${m.code}/` : m.url,
    caption: strs(m.caption?.text, typeof m.caption === 'string' ? m.caption : undefined),
    timestamp: iso(m.taken_at) ?? strs(m.created_at),
    type: 'Video',
    videoUrl: strs(m.video_versions?.[0]?.url),
    displayUrl: strs(m.image_versions2?.candidates?.[0]?.url, m.display_uri),
    videoPlayCount: nums(m.play_count, m.ig_play_count),
    likesCount: nums(m.like_count),
    commentsCount: nums(m.comment_count),
    videoDuration: nums(m.video_duration),
    ownerUsername: strs(user.username),
    ownerFullName: strs(user.full_name),
    musicInfo: {artist_name: strs(music?.display_artist, orig?.ig_artist?.username), song_name: strs(music?.title, orig?.original_audio_title)},
    raw: m,
  };
}

// One post or reel (data.xdt_shortcode_media).
function fromPost(m: J): SourceItem {
  const mu = m.clips_music_attribution_info ?? {};
  return {
    shortCode: m.shortcode,
    url: m.shortcode ? `https://www.instagram.com/reel/${m.shortcode}/` : undefined,
    caption: strs(m.edge_media_to_caption?.edges?.[0]?.node?.text) ?? '',
    timestamp: iso(m.taken_at_timestamp) ?? strs(m.created_at),
    type: m.is_video || m.video_url ? 'Video' : 'Image',
    videoUrl: strs(m.video_url),
    displayUrl: strs(m.display_url),
    videoPlayCount: nums(m.video_play_count),
    videoViewCount: nums(m.video_view_count),
    likesCount: nums(m.edge_media_preview_like?.count, m.edge_liked_by?.count),
    commentsCount: nums(m.edge_media_to_parent_comment?.count, m.edge_media_preview_comment?.count, m.edge_media_to_comment?.count),
    videoDuration: nums(m.video_duration),
    ownerUsername: strs(m.owner?.username),
    ownerFullName: strs(m.owner?.full_name),
    musicInfo: {artist_name: strs(mu.artist_name), song_name: strs(mu.song_name)},
    raw: m,
  };
}

// One reel by its URL. cached: a copy up to 30 days old is fine (free), e.g. only for its caption.
export async function post(url: string, cached = false): Promise<SourceItem | null> {
  const b = await api('/v1/instagram/post', {url, cache_max_age: cached ? '30d' : undefined});
  const m = b.data?.xdt_shortcode_media ?? b.data?.shortcode_media;
  return m ? fromPost(m) : null;
}

// At most n at once.
async function eachLimited<T>(xs: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({length: Math.min(n, xs.length)}, async () => {
    while (i < xs.length) await fn(xs[i++]);
  }));
}

// An account's newest reels, up to limit (pages of ~12, newest first). The reels page has no captions: each
// reel's comes from its post (a cached copy when there is one), except those caption(code) already knows.
export async function accountReels(handle: string, limit: number, caption: (code: string) => string | null): Promise<{items: SourceItem[]; problem: string | null}> {
  const items: SourceItem[] = [];
  let maxId: string | undefined;
  let problem: string | null = null;
  for (let page = 0; items.length < limit && page < Math.ceil(limit / 6) + 2; page++) {
    let b: J;
    try {
      b = await api('/v1/instagram/user/reels', {handle, max_id: maxId});
    } catch (e) {
      if (!items.length) throw e;
      problem = `se cortó a los ${items.length} reels: ${(e as Error).message}`;
      break;
    }
    for (const it of (b.items ?? []) as J[]) if (it.media?.code && items.length < limit && !items.some((x) => x.shortCode === it.media.code)) items.push(fromReel(it.media));
    maxId = b.paging_info?.max_id;
    if (!b.paging_info?.more_available || !maxId) break;
  }
  const missing = items.filter((it) => !it.caption && it.shortCode && caption(it.shortCode) == null);
  let failed = 0;
  await eachLimited(missing, 4, async (it) => {
    try {
      const p = await post(it.url!, true);
      it.caption = p?.caption ?? '';
    } catch {
      failed++;
    }
  });
  for (const it of items) if (!it.caption && it.shortCode) it.caption = caption(it.shortCode) ?? '';
  if (failed && !problem) problem = `no pude leer el caption de ${failed} reel${failed > 1 ? 's' : ''}`;
  return {items, problem};
}

export async function profile(handle: string): Promise<SourceProfile | null> {
  const u = (await api('/v1/instagram/profile', {handle})).data?.user;
  if (!u) return null;
  return {
    username: u.username,
    fullName: u.full_name,
    biography: u.biography,
    followersCount: u.edge_followed_by?.count,
    followsCount: u.edge_follow?.count,
    postsCount: u.edge_owner_to_timeline_media?.count,
    verified: u.is_verified,
    businessCategoryName: u.category_name ?? u.business_category_name,
    externalUrl: u.external_url,
    profilePicUrl: u.profile_pic_url,
    profilePicUrlHD: u.profile_pic_url_hd,
  };
}

// The credits left (for Ajustes' key check).
export async function balance(key: string) {
  const b = await api('/v1/account/credit-balance', {}, key);
  const n = nums(b.creditCount, b.credits, b.credits_remaining, b.balance, b.data?.credits);
  return n;
}
