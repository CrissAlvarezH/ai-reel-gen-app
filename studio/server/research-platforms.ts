// Investigación's searches (server/research.ts): what each platform finds for a query, in one shape (Found).
//   TikTok:         ScrapeCreators /v1/tiktok/search/keyword (1 credit, ~30 videos, with the author's followers and saves).
//   YouTube Shorts: ScrapeCreators /v1/youtube/search?type=shorts (1 credit, ~25: only id, a translated title and rounded
//                   views), then /v1/youtube/video for the most viewed (1 credit each: the real title, likes, comments,
//                   date, channel, length). The rest are left out: without them there's nothing to judge.
//   Instagram:      Apify's apify/instagram-hashtag-scraper in keyword mode, reels only (charged per reel; one run per
//                   query, so each reel knows the query that found it). Recent reels, not the most viewed: the ranking
//                   is ours. ScrapeCreators' Instagram search goes through Google and brings no views: not used.
// Video links expire (TikTok's, Instagram's): the cover is downloaded right after a search and the video when analysed.
import * as sc from './scrapecreators.ts';
import {runActor} from './inspiration.ts';
import type {ResearchPlatform} from '../shared/types.ts';

// What a search brings of a video. videoUrl: a direct MP4 (TikTok, Instagram; YouTube's comes from yt-dlp when
// analysed). raw: the platform's answer, for meta.json.
export type Found = {
  platform: ResearchPlatform;
  id: string;
  url: string;
  author: string;
  authorName: string | null;
  followers: number | null;
  title: string;
  posted: string | null;
  duration: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  region: string | null;
  videoUrl: string | null;
  displayUrl: string | null;
  query: string;
  raw: unknown;
};

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (...vs: unknown[]) => {
  const v = vs.find((x) => typeof x === 'number' && Number.isFinite(x));
  return typeof v === 'number' && v >= 0 ? v : null;
};
const str = (...vs: unknown[]) => vs.find((x): x is string => typeof x === 'string' && !!x.trim()) ?? null;
const iso = (t: unknown) => (typeof t === 'number' && t > 0 ? new Date(t * 1000).toISOString() : typeof t === 'string' && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null);
// Of a list of links, the first that's a JPEG (TikTok also offers HEIC, which the app's browser can't show).
const jpeg = (lists: unknown[]) => {
  const all = lists.flatMap((l) => (Array.isArray(l) ? l.filter((u): u is string => typeof u === 'string') : []));
  return all.find((u) => /\.jpe?g$/i.test(u.split('?')[0])) ?? all.find((u) => !/\.heic$/i.test(u.split('?')[0])) ?? null;
};

/* ───── TikTok ───── */

// date_posted: what TikTok's search takes for the window (wider ones are filtered here, by date).
const TT_WINDOW: Record<number, string> = {7: 'this-week', 30: 'this-month'};

export function fromTikTok(a: J, query: string): Found | null {
  const id = str(a.aweme_id, a.id);
  const author = a.author ?? {};
  const handle = str(author.unique_id, author.uniqueId);
  if (!id || !handle) return null;
  const v = a.video ?? {};
  const s = a.statistics ?? a.stats ?? {};
  const d = num(v.duration, a.duration);
  return {
    platform: 'tiktok',
    id,
    url: `https://www.tiktok.com/@${handle}/video/${id}`,
    author: handle.toLowerCase(),
    authorName: str(author.nickname),
    followers: num(author.follower_count, author.followerCount),
    title: str(a.desc) ?? '',
    posted: iso(a.create_time ?? a.createTime),
    // In milliseconds (seconds in older answers).
    duration: d == null ? null : d > 1000 ? Math.round(d / 100) / 10 : d,
    views: num(s.play_count, s.playCount),
    likes: num(s.digg_count, s.diggCount),
    comments: num(s.comment_count, s.commentCount),
    shares: num(s.share_count, s.shareCount),
    saves: num(s.collect_count, s.collectCount),
    region: str(a.region)?.toUpperCase() ?? null,
    videoUrl: str(v.play_addr?.url_list?.[0], v.play_addr_h264?.url_list?.[0], v.download_addr?.url_list?.[0]),
    displayUrl: jpeg([v.cover?.url_list, v.origin_cover?.url_list, v.dynamic_cover?.url_list]),
    query,
    raw: a,
  };
}

export async function searchTikTok(query: string, o: {sinceDays: number; country: string | null}): Promise<Found[]> {
  const b = await sc.api('/v1/tiktok/search/keyword', {query, sort_by: 'most-liked', date_posted: TT_WINDOW[o.sinceDays], region: o.country ?? undefined});
  const list = (b.search_item_list ?? b.data ?? b.videos ?? []) as J[];
  return list.map((x) => fromTikTok(x.aweme_info ?? x, query)).filter((x): x is Found => !!x);
}

/* ───── YouTube Shorts ───── */

export type ShortHit = {id: string; views: number | null; query: string};
export async function searchShorts(query: string, o: {country: string | null}): Promise<ShortHit[]> {
  const b = await sc.api('/v1/youtube/search', {query, type: 'shorts', region: o.country ?? undefined});
  return ((b.shorts ?? []) as J[]).flatMap((s) => (str(s.id) ? [{id: s.id as string, views: num(s.viewCountInt), query}] : []));
}

export function fromShort(v: J, query: string): Found | null {
  const id = str(v.id);
  if (!id) return null;
  const ch = v.channel ?? {};
  const handle = str(ch.handle)?.replace(/^@/, '') ?? str(ch.title) ?? '';
  const ms = num(v.durationMs);
  return {
    platform: 'youtube',
    id,
    url: `https://www.youtube.com/shorts/${id}`,
    author: handle.toLowerCase(),
    authorName: str(ch.title),
    followers: null,
    title: [str(v.title), str(v.description)].filter(Boolean).join('\n\n'),
    posted: iso(v.publishDate),
    duration: ms == null ? num(v.lengthSeconds) : Math.round(ms / 100) / 10,
    views: num(v.viewCountInt),
    likes: num(v.likeCountInt),
    comments: num(v.commentCountInt),
    shares: null,
    saves: null,
    region: null,
    videoUrl: null,
    // YouTube's own thumbnail: it doesn't expire.
    displayUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    query,
    raw: v,
  };
}

export async function shortDetail(hit: ShortHit): Promise<Found | null> {
  const b = await sc.api('/v1/youtube/video', {url: `https://www.youtube.com/shorts/${hit.id}`});
  return fromShort(b, hit.query);
}

/* ───── Instagram (Apify) ───── */

export const IG_ACTOR = 'apify~instagram-hashtag-scraper';

export function fromInstagram(it: J, query: string): Found | null {
  const code = str(it.shortCode, it.shortcode, it.code);
  const owner = str(it.ownerUsername, it.owner?.username);
  if (!code || !owner || it.error) return null;
  const likes = num(it.likesCount); // -1 when hidden: null
  return {
    platform: 'instagram',
    id: code,
    url: `https://www.instagram.com/reel/${code}/`,
    author: owner.toLowerCase(),
    authorName: str(it.ownerFullName, it.owner?.full_name),
    followers: num(it.ownerFollowersCount, it.owner?.followers_count),
    title: str(it.caption) ?? '',
    posted: iso(it.timestamp ?? it.taken_at),
    duration: num(it.videoDuration),
    views: num(it.videoPlayCount, it.videoViewCount, it.playCount),
    likes,
    comments: num(it.commentsCount),
    shares: num(it.sharesCount, it.reshareCount),
    saves: null,
    region: null,
    videoUrl: str(it.videoUrl),
    displayUrl: str(it.displayUrl),
    query,
    raw: it,
  };
}

export async function searchInstagram(query: string, perQuery: number, maxUsd: number): Promise<{items: Found[]; problem: string | null}> {
  const {items, problem} = await runActor<J>(IG_ACTOR, {hashtags: [query], keywordSearch: true, resultsType: 'reels', resultsLimit: perQuery}, maxUsd);
  return {items: items.map((it) => fromInstagram(it, query)).filter((x): x is Found => !!x && !!x.videoUrl), problem};
}

// The hashtag actor's prices (per reel and per run) on his Apify plan, cached for an hour; the free plan's when unknown.
let pricing: {at: number; item: number; start: number} | null = null;
export async function igPrices(token: string | null) {
  if (pricing && Date.now() - pricing.at < 3600_000) return pricing;
  const fallback = {at: Date.now(), item: 0.0026, start: 0.001};
  try {
    type Tiered = {eventTieredPricingUsd?: Record<string, {tieredEventPriceUsd: number}>; eventPriceUsd?: number};
    const [act, me] = await Promise.all([
      fetch(`https://api.apify.com/v2/acts/${IG_ACTOR}`).then((r) => r.json() as Promise<J>),
      token ? fetch('https://api.apify.com/v2/users/me', {headers: {Authorization: `Bearer ${token}`}}).then((r) => r.json() as Promise<J>).catch(() => null) : null,
    ]);
    const events = (act?.data?.pricingInfos?.at(-1)?.pricingPerEvent?.actorChargeEvents ?? {}) as Record<string, Tiered>;
    const tier = String(me?.data?.plan?.tier ?? 'FREE').toUpperCase();
    const price = (e?: Tiered) => e?.eventTieredPricingUsd?.[tier]?.tieredEventPriceUsd ?? e?.eventTieredPricingUsd?.FREE?.tieredEventPriceUsd ?? e?.eventPriceUsd;
    const start = price(events['actor-start']) ?? fallback.start;
    // The charge per result: the dearest event that isn't the start (its name varies between actors).
    const item = Math.max(0, ...Object.entries(events).filter(([k]) => !/start/i.test(k)).map(([, e]) => price(e) ?? 0));
    pricing = item ? {at: Date.now(), item, start} : fallback;
  } catch {
    pricing = fallback;
  }
  return pricing;
}
