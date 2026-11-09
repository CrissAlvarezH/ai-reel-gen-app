// A stand-in for the cloud's sync API (docs/studio-cloud.md §7), for server/sync.test.ts and to try the card by hand.
// It arbitrates a commit the way the real one does (cases A to D) and keeps blobs in memory behind fake presigned URLs.
import {createHash, randomUUID} from 'node:crypto';
import http from 'node:http';

export type FakeEntry = {path: string; rev: number; sha256: string | null; size: number; mtime: number; deleted: boolean; storage: 'doc' | 'blob'; content?: string};
export type FakeConflict = {id: string; path: string; status: string; winnerDevice: string; winnerMtime: number; loserDevice: string; loserMtime: number; loserDeleted: boolean; loserStorage: 'doc' | 'blob'; loserSha256: string | null; loserContent?: string; createdAt: string};
export type FakeProject = {id: string; slug: string; name: string; localCreated: number | null; kind: 'channel' | 'shared'; rev: number; entries: Map<string, FakeEntry>; primaryDeviceId: string | null; conflicts: FakeConflict[]; deleted?: boolean};

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const DOCS = /^(config\/(profile|voice|audience|images|social|account|chat|checks)\.json|ideas\.json|automations\.json|fact-audit\.json|sources\/(sources|items)\.json)$/;

export function fakeCloud() {
  const projects = new Map<string, FakeProject>();
  const blobs = new Map<string, Buffer>();
  const log: {method: string; url: string; body: Record<string, unknown> | null}[] = [];
  const ctl = {
    down: false,
    quotaFull: false,
    fetchLimit: 3_000_000,
    // Overrides, for a cloud that misbehaves.
    corrupt: new Set<string>(),
    extraEntries: [] as FakeEntry[],
    putHeaders: [] as Record<string, unknown>[],
    userName: null as string | null,
    onFetch: null as (() => void) | null,
  };

  const addProject = (id: string, slug: string, name: string, kind: FakeProject['kind'] = 'channel') => {
    const p: FakeProject = {id, slug, name, localCreated: 1000, kind, rev: 0, entries: new Map(), primaryDeviceId: null, conflicts: []};
    projects.set(id, p);
    return p;
  };
  const view = (p: FakeProject) => ({id: p.id, slug: p.slug, name: p.name, localCreated: p.localCreated, instagram: null, instagramSetAt: null, createdAt: '2026-01-01', updatedAt: '2026-01-01', sync: stateOf(p)});
  function stateOf(p: FakeProject) {
    const live = [...p.entries.values()].filter((e) => !e.deleted);
    const docBytes = live.filter((e) => e.storage === 'doc').reduce((n, e) => n + e.size, 0);
    const fileBytes = live.filter((e) => e.storage === 'blob').reduce((n, e) => n + e.size, 0);
    return {rev: p.rev, bytes: docBytes + fileBytes, docBytes, fileBytes, docs: live.filter((e) => e.storage === 'doc').length, files: live.filter((e) => e.storage === 'blob').length, groups: {}, quota: {projectBytes: 2147483648, accountBytes: 5368709120, accountUsedBytes: docBytes + fileBytes}, lastSyncedAt: null, lastSyncedDevice: null, primaryDeviceId: p.primaryDeviceId, openConflicts: p.conflicts.filter((c) => c.status === 'open').length};
  }

  let base = '';
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url!, 'http://x');
      const method = req.method!;
      const send = (status: number, v: unknown) => (res.writeHead(status, {'content-type': 'application/json'}), res.end(JSON.stringify(v)));
      if (ctl.down) return req.socket.destroy();

      const blob = /^\/s3\/([0-9a-f]{64})$/.exec(url.pathname);
      if (blob) {
        if (method === 'PUT') {
          ctl.putHeaders.push({...req.headers});
          if (sha(raw) !== blob[1]) return send(400, {error: 'hash'});
          blobs.set(blob[1], raw);
          return send(200, {});
        }
        const b = blobs.get(blob[1]);
        if (!b) return send(404, {error: 'no'});
        res.writeHead(200);
        return res.end(ctl.corrupt.has(blob[1]) ? Buffer.from('otra cosa') : b);
      }

      const body = raw.length ? JSON.parse(raw.toString('utf8')) : null;
      log.push({method, url: url.pathname + url.search, body});
      if (url.pathname === '/api/studio/auth/verify') return send(200, {token: 'tok', user: {id: 42, email: body.email, name: null}});
      if (url.pathname === '/api/studio/me') {
        if (method === 'PATCH') {
          ctl.userName = body.name;
          return send(200, {user: {id: 42, email: 'yo@x.co', name: ctl.userName}});
        }
        return send(200, {user: {id: 42, email: 'yo@x.co', name: ctl.userName}, metaApp: true, accounts: [], panelUrl: 'http://x/panel'});
      }
      if (url.pathname === '/api/studio/shared-project') {
        const found = [...projects.values()].find((p) => p.kind === 'shared') ?? addProject(randomUUID(), 'shared', 'shared', 'shared');
        return send(200, {project: view(found)});
      }
      if (url.pathname === '/api/studio/projects') return send(200, {projects: [...projects.values()].filter((p) => p.kind === 'channel' && !p.deleted).map(view)});
      const m = /^\/api\/studio\/projects\/([^/]+)(\/sync\/(.+))?$/.exec(url.pathname);
      if (!m) return send(404, {error: 'no'});
      const p = projects.get(m[1]) ?? (method === 'PUT' ? addProject(m[1], body.slug, body.name) : undefined);
      if (!p) return send(404, {error: 'Proyecto no encontrado'});
      if (p.deleted) return send(410, {error: 'eliminado'});
      if (!m[2]) {
        if (method === 'PATCH' && 'primaryDeviceId' in body) p.primaryDeviceId = body.primaryDeviceId;
        return send(200, {project: view(p)});
      }
      const action = m[3];
      if (action === 'state') return send(200, stateOf(p));
      if (action === 'changes') {
        const since = Number(url.searchParams.get('since'));
        const limit = Number(url.searchParams.get('limit') ?? 1000);
        const cursor = url.searchParams.get('cursor');
        const all = [...[...p.entries.values()].filter((e) => e.rev > since), ...ctl.extraEntries].sort((a, b) => a.path.localeCompare(b.path)).filter((e) => !cursor || e.path > cursor);
        const page = all.slice(0, limit);
        return send(200, {rev: p.rev, entries: page.map(({content: _c, ...e}) => e), next: all.length > limit ? page.at(-1)!.path : null});
      }
      if (action === 'fetch') {
        ctl.onFetch?.();
        const items: unknown[] = [];
        const omitted: string[] = [];
        let used = 0;
        for (const path of body.paths as string[]) {
          const e = p.entries.get(path) ?? ctl.extraEntries.find((x) => x.path === path);
          if (!e || e.deleted) continue;
          const cost = e.storage === 'doc' ? Buffer.byteLength(e.content!) : 300;
          if (used + cost > ctl.fetchLimit && items.length) {
            omitted.push(path);
            continue;
          }
          used += cost;
          items.push(e.storage === 'doc' ? {path, rev: e.rev, sha256: e.sha256, content: ctl.corrupt.has(e.sha256!) ? '{"manipulado":true}' : e.content} : {path, rev: e.rev, sha256: e.sha256, url: `${base}/s3/${e.sha256}`});
        }
        return send(200, {items, omitted});
      }
      if (action === 'prepare') {
        if (ctl.quotaFull) return send(413, {error: 'Superaste tu espacio'});
        const uploads: unknown[] = [];
        const present: string[] = [];
        for (const f of body.files as {sha256: string}[]) {
          if (blobs.has(f.sha256)) present.push(f.sha256);
          else uploads.push({sha256: f.sha256, url: `${base}/s3/${f.sha256}`, method: 'PUT', headers: {'Content-Type': 'application/octet-stream'}});
        }
        return send(200, {uploads, present, rejected: []});
      }
      if (action === 'commit') {
        const results: unknown[] = [];
        p.rev++;
        for (const c of body.changes as {path: string; baseRev: number; sha256?: string; size?: number; mtime: number; content?: string; deleted?: boolean}[]) {
          const cur = p.entries.get(c.path);
          const deleted = !!c.deleted;
          const next = (): FakeEntry => ({path: c.path, rev: p.rev, sha256: deleted ? null : c.sha256!, size: deleted ? 0 : c.size!, mtime: c.mtime, deleted, storage: DOCS.test(c.path) ? 'doc' : 'blob', content: c.content});
          if (cur && cur.sha256 === (deleted ? null : c.sha256) && cur.deleted === deleted) {
            results.push({path: c.path, status: 'same', rev: cur.rev});
            continue;
          }
          if (!cur || cur.rev === c.baseRev) {
            p.entries.set(c.path, next());
            results.push({path: c.path, status: 'applied', rev: p.rev});
            continue;
          }
          const incomingWins = c.mtime > cur.mtime || (c.mtime === cur.mtime && (c.sha256 ?? '') > (cur.sha256 ?? ''));
          const id = randomUUID();
          const conflict = (l: {device: string; mtime: number; deleted: boolean; storage: 'doc' | 'blob'; sha: string | null; content?: string}, w: {device: string; mtime: number}): FakeConflict => ({id, path: c.path, status: 'open', winnerDevice: w.device, winnerMtime: w.mtime, loserDevice: l.device, loserMtime: l.mtime, loserDeleted: l.deleted, loserStorage: l.storage, loserSha256: l.sha, loserContent: l.content, createdAt: new Date().toISOString()});
          if (incomingWins) {
            p.conflicts.push(conflict({device: 'otro', mtime: cur.mtime, deleted: cur.deleted, storage: cur.storage, sha: cur.sha256, content: cur.content}, {device: 'este', mtime: c.mtime}));
            p.entries.set(c.path, next());
            results.push({path: c.path, status: 'won', rev: p.rev, conflictId: id});
          } else {
            p.conflicts.push(conflict({device: 'este', mtime: c.mtime, deleted, storage: cur.storage, sha: c.sha256 ?? null, content: c.content}, {device: 'otro', mtime: cur.mtime}));
            results.push({path: c.path, status: 'lost', rev: cur.rev, conflictId: id});
          }
        }
        return send(200, {rev: p.rev, results});
      }
      if (action === 'conflicts') return send(200, {conflicts: p.conflicts.filter((c) => c.status === 'open')});
      const content = /^conflicts\/([^/]+)\/content$/.exec(action);
      if (content) {
        const c = p.conflicts.find((x) => x.id === content[1]);
        if (!c) return send(404, {error: 'no'});
        return send(200, c.loserStorage === 'doc' ? {content: c.loserContent} : {url: `${base}/s3/${c.loserSha256}`});
      }
      const dismiss = /^conflicts\/([^/]+)\/dismiss$/.exec(action);
      if (dismiss) {
        const c = p.conflicts.find((x) => x.id === dismiss[1]);
        if (c) c.status = 'dismissed';
        return send(200, {ok: true});
      }
      return send(404, {error: 'no'});
    });
  });
  return {
    server,
    projects,
    blobs,
    log,
    ctl,
    addProject,
    listen: () =>
      new Promise<string>((resolve) =>
        server.listen(0, '127.0.0.1', () => {
          base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
          resolve(base);
        }),
      ),
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  };
}
