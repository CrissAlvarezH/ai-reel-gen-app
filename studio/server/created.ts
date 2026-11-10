// When a video was created: videos/<slug>/created.txt, an ISO date-time written by scripts/new-video.mjs as it makes
// the folder. It travels with the video's sync (a folder's own creation time doesn't: a clone is new on that device).
// A video from before it has none: it gets the earliest time its folder and first files show, written once.
import fs from 'node:fs';
import path from 'node:path';

export const CREATED = 'created.txt';
// Written when the video is made and rarely after: the earliest of them is close to its birth.
const EARLY = ['style.txt', 'format.txt', 'title.txt', 'package.json', 'src/format.json', 'audio/vo.txt'];

// ms since epoch; null only when the folder is gone.
export function createdOf(dir: string): number | null {
  try {
    const at = Date.parse(fs.readFileSync(path.join(dir, CREATED), 'utf8').trim());
    if (!Number.isNaN(at)) return at;
  } catch {
    /* none yet */
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(dir);
  } catch {
    return null;
  }
  const times = [st.birthtimeMs || st.ctimeMs];
  for (const f of EARLY) {
    try {
      times.push(fs.statSync(path.join(dir, f)).mtimeMs);
    } catch {
      /* not in this one */
    }
  }
  const at = Math.round(Math.min(...times.filter((t) => t > 0)));
  try {
    fs.writeFileSync(path.join(dir, CREATED), `${new Date(at).toISOString()}\n`);
  } catch {
    /* read-only: estimated again next time */
  }
  return at;
}
