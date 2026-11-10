// The columns the agents' instructions name for the app's index (tools/studio_sql.py) are real ones: agents query
// them as written (e.g. "multiplicador" made them try own_reels.multiplier). Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-index-line-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/p'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/p/project.json'), JSON.stringify({name: 'p', created: 1}));

test('every column the instructions name for the index exists, and own_reels says its multiplier is ratio', async () => {
  await import('./projects-index.ts');
  await import('./inspiration-index.ts');
  const db = await import('./db.ts');
  const chat = await import('./chat.ts');
  db.sync(true);
  const d = db.open();
  const columns = (table: string) => new Set((d.prepare(`PRAGMA table_info(${table})`).all() as {name: string}[]).map((c) => c.name));

  const text = chat.instructions(chat.GENERAL);
  const cited = [...text.matchAll(/\b([a-z_]+) \(columnas: ([^)]*)\)/g)].map((m) => ({table: m[1], cols: m[2].split(',').map((c) => c.trim())}));
  for (const t of ['videos', 'own_reels', 'insp_reels']) assert.ok(cited.some((c) => c.table === t), `las instrucciones citan las columnas de ${t}`);
  for (const {table, cols} of cited) {
    const real = columns(table);
    assert.ok(real.size, `${table} existe`);
    for (const c of cols) assert.ok(real.has(c), `${table}.${c} existe`);
  }
  assert.ok(cited.find((c) => c.table === 'own_reels')!.cols.includes('ratio'));
  assert.doesNotMatch(text, /multiplier/);
});
