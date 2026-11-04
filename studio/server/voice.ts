// The narration voice in ElevenLabs: the account's voices and models to choose from, and a short sample
// with the chosen settings. The sample also measures the pace (spoken words per second) that the studio
// uses to estimate how long a script lasts.
import {getKey} from './settings.ts';
import {httpError} from './reels.ts';
import {getVoice} from './config.ts';
import type {Voice, VoiceModel, VoiceOption, VoiceSample} from '../shared/types.ts';

const API = 'https://api.elevenlabs.io/v1';

function key() {
  const k = getKey('ELEVENLABS_API_KEY');
  if (!k) throw httpError(400, 'Falta la clave de ElevenLabs: añádela en Ajustes → Voz.');
  return k;
}

async function call<T>(p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${p}`, {...init, headers: {'xi-api-key': key(), 'Content-Type': 'application/json', ...init?.headers}});
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const detail = (() => {
      try {
        const d = JSON.parse(body).detail;
        return typeof d === 'string' ? d : d?.message;
      } catch {
        return null;
      }
    })();
    throw httpError(r.status === 401 ? 400 : 502, r.status === 401 ? 'ElevenLabs rechazó la clave' : `ElevenLabs respondió ${r.status}${detail ? `: ${detail}` : ''}`);
  }
  return (await r.json()) as T;
}

type RawVoice = {voice_id: string; name: string; category?: string; description?: string | null; preview_url?: string | null; labels?: Record<string, string>};

// Your own voices (cloned, generated) first, then the library ones the account has.
export async function voices(): Promise<VoiceOption[]> {
  const {voices: vs} = await call<{voices: RawVoice[]}>('/voices');
  const rank = (c: string) => (c === 'cloned' ? 0 : c === 'generated' ? 1 : c === 'professional' ? 2 : 3);
  return vs
    .map((v) => ({
      id: v.voice_id,
      name: v.name,
      category: v.category ?? 'premade',
      description: v.description || null,
      previewUrl: v.preview_url || null,
      labels: Object.values(v.labels ?? {}).filter(Boolean),
    }))
    .sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name));
}

type RawModel = {model_id: string; name: string; description?: string; can_do_text_to_speech?: boolean; languages?: {name: string}[]};

export async function models(): Promise<VoiceModel[]> {
  const ms = await call<RawModel[]>('/models');
  return ms
    .filter((m) => m.can_do_text_to_speech !== false)
    .map((m) => ({id: m.model_id, name: m.name, description: m.description || null, languages: (m.languages ?? []).map((l) => l.name)}));
}

const countWords = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

// Say `text` with these settings (unsaved ones from the page, over the saved voice).
export async function sample(text: unknown, settings: Partial<Voice> | undefined): Promise<VoiceSample> {
  const t = typeof text === 'string' ? text.trim().slice(0, 600) : '';
  if (!t) throw httpError(400, 'escribe un texto para la muestra');
  const v = {...getVoice(), ...(settings ?? {})};
  if (!v.voiceId) throw httpError(400, 'elige una voz');
  const res = await call<{audio_base64: string; alignment?: {character_end_times_seconds?: number[]}}>(
    `/text-to-speech/${encodeURIComponent(v.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      body: JSON.stringify({
        text: t,
        model_id: v.model,
        voice_settings: {speed: v.speed, stability: v.stability, similarity_boost: v.similarity, style: v.style, use_speaker_boost: v.speakerBoost},
      }),
    },
  );
  const seconds = res.alignment?.character_end_times_seconds?.at(-1) ?? 0;
  const words = countWords(t);
  return {audio: `data:audio/mpeg;base64,${res.audio_base64}`, seconds, words, wordsPerSec: seconds > 0 ? Math.round((words / seconds) * 100) / 100 : v.wordsPerSec};
}
