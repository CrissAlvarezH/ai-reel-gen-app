// The library as a table (Biblioteca → Tabla): every video of the project in rows, 15 a page, with a search, filters
// and sortable columns. All of it on what /api/reels already sends (ReelSummary): nothing is asked of the server.
import {useEffect, useMemo, useState} from 'react';
import {ChevronLeft, ChevronRight, Eye, Film, MoreHorizontal, Search, Trash2, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {fmtAgo, fmtTime, type ReelSummary} from './api';
import {useColumns} from './Columns';
import {FilterSelect, SortHead} from './Inspiration';
import {ReelProgressRing} from './ReelProgress';
import {ReleaseLine} from './Release';

const PAGE = 15;
// Video (its picture and title) is always there; these he can hide.
const COLUMNS = [
  {key: 'release', label: 'Publicación'},
  {key: 'progress', label: 'Progreso'},
  {key: 'style', label: 'Estilo'},
  {key: 'seconds', label: 'Duración'},
  {key: 'views', label: 'Vistas'},
  {key: 'versions', label: 'Versiones'},
  {key: 'created', label: 'Creado'},
  {key: 'updated', label: 'Actualizado'},
] as const satisfies {key: string; label: string}[];

// Publicación: where each one stands; "unfinished" are those without a line (still being made).
type Stage = NonNullable<ReelSummary['release']>['state'] | 'unfinished';
const stageOf = (r: ReelSummary): Stage => r.release?.state ?? 'unfinished';
const STAGES: [string, string][] = [
  ['any', 'Todas'],
  ['published', 'Publicados'],
  ['scheduled', 'Programados'],
  ['publishing', 'Publicándose'],
  ['ready', 'Listos para publicar'],
  ['unfinished', 'En progreso'],
];

type SortKey = 'title' | 'release' | 'seconds' | 'views' | 'versions' | 'created' | 'updated';
// Publicación sorts by stage (on its way, scheduled, out, ready, in progress), then by its date.
const STAGE_ORDER: Record<Stage, number> = {publishing: 0, scheduled: 1, published: 2, ready: 3, unfinished: 4};
const value = (r: ReelSummary, k: SortKey): string | number | null => {
  switch (k) {
    case 'title':
      return (r.title ?? r.slug).toLocaleLowerCase('es');
    case 'release':
      return STAGE_ORDER[stageOf(r)] * 1e13 - (r.release?.at ? Date.parse(r.release.at) : 0);
    case 'seconds':
      return r.seconds;
    case 'views':
      return r.instagram?.views ?? null;
    case 'versions':
      return r.versionCount;
    case 'created':
      return r.created ?? null;
    case 'updated':
      return r.updated;
  }
};

// Creado: its day (the year only when it isn't this one); the hour on hover.
const createdDay = (ms: number) => {
  const d = new Date(ms);
  return d.toLocaleDateString('es', {day: 'numeric', month: 'short', ...(d.getFullYear() === new Date().getFullYear() ? {} : {year: 'numeric'})});
};

// For the search: title, slug and hook, without accents or case.
const plain = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function LibraryTable({reels, onDelete}: {reels: ReelSummary[]; onDelete: (r: ReelSummary) => void}) {
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('any');
  const [style, setStyle] = useState('any');
  const [format, setFormat] = useState('any');
  const [sort, setSort] = useState<{key: SortKey; desc: boolean}>({key: 'updated', desc: true});
  const [page, setPage] = useState(0);

  // The styles and formats its videos use: a filter only when there's more than one to choose from.
  const styles = useMemo(() => distinct(reels.map((r) => r.style && [r.style.id, r.style.name])), [reels]);
  const formats = useMemo(() => distinct(reels.map((r) => r.videoFormat && [r.videoFormat.id, r.videoFormat.name])), [reels]);
  // The columns he picked (Columnas, kept per project like Mi cuenta's); those no video has anything for stay out too.
  const cols = useColumns('library', COLUMNS);
  const show = {
    release: cols.shown('release'),
    progress: cols.shown('progress'),
    style: cols.shown('style') && (styles.length > 0 || reels.some((r) => r.videoFormat?.footage)),
    seconds: cols.shown('seconds'),
    views: cols.shown('views') && reels.some((r) => r.instagram),
    versions: cols.shown('versions'),
    created: cols.shown('created'),
    updated: cols.shown('updated'),
  };

  const rows = useMemo(() => {
    const words = plain(q).split(/\s+/).filter(Boolean);
    const shown = reels.filter(
      (r) =>
        (stage === 'any' || stageOf(r) === stage) &&
        (style === 'any' || r.style?.id === style) &&
        (format === 'any' || r.videoFormat?.id === format) &&
        words.every((w) => plain(`${r.title ?? ''} ${r.slug} ${r.hook}`).includes(w)),
    );
    // Those without a value (no views yet) go last either way.
    return shown.sort((a, b) => {
      const x = value(a, sort.key);
      const y = value(b, sort.key);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      const c = typeof x === 'string' ? x.localeCompare(y as string, 'es') : x - (y as number);
      return sort.desc ? -c : c;
    });
  }, [reels, q, stage, style, format, sort]);

  // A new search, filter or order starts at the first page; one that shrinks under the current page goes to its last.
  useEffect(() => setPage(0), [q, stage, style, format, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const slice = rows.slice(pg * PAGE, pg * PAGE + PAGE);
  const active = !!q || stage !== 'any' || style !== 'any' || format !== 'any';

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título o gancho…" className="h-8 pl-8" aria-label="Buscar" spellCheck={false} />
        </div>
        <FilterSelect value={stage} onChange={setStage} label="Publicación" options={STAGES} />
        {styles.length > 1 && <FilterSelect value={style} onChange={setStyle} label="Estilo" options={[['any', 'Todos los estilos'], ...styles]} />}
        {formats.length > 1 && <FilterSelect value={format} onChange={setFormat} label="Formato" options={[['any', 'Todos los formatos'], ...formats]} />}
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('');
              setStage('any');
              setStyle('any');
              setFormat('any');
            }}
          >
            <X /> Limpiar
          </Button>
        )}
        <div className="ml-auto">{cols.picker}</div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ningún video cumple esos filtros.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14" />
                <SortHead k="title" sort={sort} setSort={setSort}>
                  Video
                </SortHead>
                {show.release && (
                  <SortHead k="release" sort={sort} setSort={setSort}>
                    Publicación
                  </SortHead>
                )}
                {show.progress && <TableHead>Progreso</TableHead>}
                {show.style && <TableHead>Estilo</TableHead>}
                {show.seconds && (
                  <SortHead k="seconds" sort={sort} setSort={setSort} title="Estimada al ritmo de su voz">
                    Dur.
                  </SortHead>
                )}
                {show.views && (
                  <SortHead k="views" sort={sort} setSort={setSort} title="En Instagram, según Mi cuenta">
                    Vistas
                  </SortHead>
                )}
                {show.versions && (
                  <SortHead k="versions" sort={sort} setSort={setSort}>
                    Versiones
                  </SortHead>
                )}
                {show.created && (
                  <SortHead k="created" sort={sort} setSort={setSort}>
                    Creado
                  </SortHead>
                )}
                {show.updated && (
                  <SortHead k="updated" sort={sort} setSort={setSort}>
                    Actualizado
                  </SortHead>
                )}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {slice.map((r) => (
                <TableRow key={r.slug} className="cursor-pointer" onClick={() => (location.hash = `#/reel/${r.slug}`)}>
                  <TableCell className="w-14 min-w-14 py-1.5">
                    {r.thumb ? (
                      <img src={r.thumb} alt="" loading="lazy" className="h-14 w-10 max-w-none min-w-10 rounded-sm object-cover object-top" />
                    ) : (
                      <div className="grid h-14 w-10 place-items-center rounded-sm bg-muted">
                        <Film className="size-4 text-muted-foreground" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-0 min-w-56 whitespace-normal">
                    <a href={`#/reel/${r.slug}`} className="line-clamp-1 font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {r.title ?? r.slug}
                    </a>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{r.hook || 'Sin guion'}</p>
                  </TableCell>
                  {show.release && (
                    <TableCell className="whitespace-nowrap">{r.release && <ReleaseLine r={r.release} compact />}</TableCell>
                  )}
                  {show.progress && (
                    <TableCell>
                      <ReelProgressRing steps={r.progress} className="size-5" />
                    </TableCell>
                  )}
                  {show.style && (
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {r.style?.name ?? '—'}
                      {r.videoFormat?.footage && <p className="text-xs">{r.videoFormat.name}</p>}
                    </TableCell>
                  )}
                  {show.seconds && <TableCell className="text-muted-foreground tabular-nums">~{fmtTime(r.seconds)}</TableCell>}
                  {show.views && (
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {r.instagram?.views != null ? (
                        <span className="inline-flex items-center gap-1">
                          <Eye className="size-3.5 text-muted-foreground" />
                          {r.instagram.views.toLocaleString('es')}
                          {r.instagram.ratio != null && <span className={r.instagram.ratio >= 2 ? 'text-emerald-400' : 'text-muted-foreground'}>· {r.instagram.ratio.toFixed(1)}×</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  {show.versions && <TableCell className="text-muted-foreground tabular-nums">{r.versionCount}</TableCell>}
                  {show.created && (
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums" title={r.created ? new Date(r.created).toLocaleString('es') : undefined}>
                      {r.created ? createdDay(r.created) : '—'}
                    </TableCell>
                  )}
                  {show.updated && (
                    <TableCell className="whitespace-nowrap text-muted-foreground" title={new Date(r.updated).toLocaleString('es')}>
                      {fmtAgo(r.updated)}
                    </TableCell>
                  )}
                  <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" title="Más opciones" aria-label={`Más opciones de ${r.title ?? r.slug}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(r)}>
                          <Trash2 /> Borrar video
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
            <span className="mr-auto tabular-nums">
              {pg * PAGE + 1}–{pg * PAGE + slice.length} de {rows.length}
              {active ? ` (de ${reels.length})` : ''}
            </span>
            <Button variant="ghost" size="icon-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)} aria-label="Página anterior">
              <ChevronLeft />
            </Button>
            <span className="tabular-nums">
              {pg + 1} / {pages}
            </span>
            <Button variant="ghost" size="icon-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label="Página siguiente">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// [id, name] pairs, each once, by name.
function distinct(pairs: (false | null | undefined | [string, string])[]): [string, string][] {
  const m = new Map<string, string>();
  for (const p of pairs) if (p) m.set(p[0], p[1]);
  return [...m].sort((a, b) => a[1].localeCompare(b[1], 'es'));
}
