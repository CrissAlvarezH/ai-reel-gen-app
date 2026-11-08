import {useCallback, useEffect, useMemo, useState} from 'react';
import {Marked, type Tokens} from 'marked';
import {Bot, Check, ChevronLeft, ChevronRight, ExternalLink, Globe, Lightbulb, Loader2, MoreHorizontal, Newspaper, Pencil, Play, Plus, Search, Trash2, Wand2, X} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Switch} from '@/components/ui/switch';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';
import PageSkeleton from '@/components/common/PageSkeleton';
import ListSkeleton from '@/components/common/ListSkeleton';
import {fmtAgo, sourcesApi, useSocket, type Source, type SourceInput, type SourceItemDetail, type SourceItemList, type SourceItemState, type SourcesView} from './api';
import {useConfirm} from './confirm';
import {useStudio} from './studio';
import {useColumns} from './Columns';
import {FilterSelect, SortHead} from './Inspiration';

// Fuentes de información: what the project follows to find material for its videos (official blogs, changelogs,
// news…). On top, the sources: each one what he wants from it in his words, its links and the instructions for the
// agent that extracts it, which reads them with whatever it has (no method to choose). A new one is made with the agent:
// he says what he wants to extract and a general conversation interviews him, finds the links and creates it.
// Below, a table with what the agents extracted, its filters, and each result's card with its text in markdown.
// Extracting is always an agent's: "Extraer" opens a general conversation; an automation's step does it on a schedule.
// Routes: #/fuentes[/<result id>].

const STATES: Record<SourceItemState, {label: string; className: string}> = {
  new: {label: 'Nuevo', className: 'border-sky-500/40 text-sky-400'},
  read: {label: 'Leído', className: 'text-muted-foreground'},
  used: {label: 'Usado', className: 'border-emerald-500/40 text-emerald-400'},
  discarded: {label: 'Descartado', className: 'text-muted-foreground line-through'},
};
const PAGE = 25;

function useItemHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.match(/^#\/fuentes\/([a-f0-9]{8})/)?.[1] ?? null;
}
const go = (item?: string | null) => {
  location.hash = `#/fuentes${item ? `/${item}` : ''}`;
};

// What an agent brought from the web is shown as text, never as HTML: raw HTML is escaped, and links and images
// only go to http(s).
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);
const web = (u: string) => /^https?:\/\//i.test(u);
const safeMd = new Marked({
  renderer: {
    html: ({text}: Tokens.HTML | Tokens.Tag) => esc(text),
    link(this: {parser: {parseInline: (t: Tokens.Link['tokens']) => string}}, {href, title, tokens}: Tokens.Link) {
      const inner = this.parser.parseInline(tokens);
      return web(href) ? `<a href="${esc(href)}" target="_blank" rel="noreferrer"${title ? ` title="${esc(title)}"` : ''}>${inner}</a>` : inner;
    },
    image: ({href, text}: Tokens.Image) => (web(href) ? `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy" />` : esc(text)),
  },
});
const renderMd = (s: string) => safeMd.parse(s, {async: false}) as string;

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};
const fmtDay = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es', {day: 'numeric', month: 'short', year: '2-digit'}) : '—');

export function Sources() {
  const {uiRef, setOpen} = useStudio();
  const confirm = useConfirm();
  const open = useItemHash();
  const [view, setView] = useState<SourcesView | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<Source | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // The table's filter by source, set also from a source's card.
  const [sourceFilter, setSourceFilter] = useState('any');
  const load = useCallback(() => sourcesApi.view().then(setView, (e: Error) => setErr(e.message)), []);
  useEffect(() => void load(), [load]);
  useSocket((m) => m.type === 'sources' && void load(), load);
  uiRef.current = {page: 'sources', ...(open ? {sourceItem: open} : {})};

  // A request to a new general conversation, shown in the panel.
  const ask = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr('');
    try {
      await fn();
      setOpen(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const extract = (ids: string[]) => ask(ids.length === 1 ? ids[0] : 'all', () => sourcesApi.extract(ids, uiRef.current));
  const remove = async (s: Source & {items: number}) => {
    if (!(await confirm({title: `¿Borrar «${s.name}»?`, description: s.items ? `Se borran también sus ${s.items} resultados.` : undefined, action: 'Borrar', destructive: true}))) return;
    sourcesApi.remove(s.id).then(setView, (e: Error) => setErr(e.message));
    if (sourceFilter === s.id) setSourceFilter('any');
  };
  const toggle = (s: Source, enabled: boolean) => sourcesApi.edit(s.id, {enabled}).then(setView, (e: Error) => setErr(e.message));

  if (err && !view) return <p className="p-6 text-sm text-destructive">{err}</p>;
  if (!view)
    return (
      <PageSkeleton>
        <ListSkeleton count={3} announce={false} />
        <ListSkeleton variant="table" count={6} announce={false} />
      </PageSkeleton>
    );
  const active = view.sources.filter((s) => s.enabled);
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Fuentes de información</h1>
          <p className="text-sm text-muted-foreground">Las páginas que sigues para tus videos. Un agente las recorre, extrae lo nuevo y lo deja abajo.</p>
        </div>
        <div className="flex gap-2">
          {view.sources.length > 0 && (
            <Button variant="outline" disabled={!active.length || !!busy} onClick={() => void extract([])} title={active.length ? 'Un agente recorre todas las fuentes activas, en una conversación nueva' : 'No hay fuentes activas'}>
              {busy === 'all' ? <Loader2 className="animate-spin" /> : <Play />} Extraer todas
            </Button>
          )}
          {view.sources.length > 0 && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nueva fuente
            </Button>
          )}
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      {!view.sources.length ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Newspaper className="size-5" /> Todavía no sigues ninguna fuente
            </CardTitle>
            <CardDescription>
              Dile al agente qué información quieres extraer. Te preguntará lo que necesite, buscará las páginas si no las tienes y creará la fuente. Luego la extraes cuando quieras desde aquí, o cada día con un paso «Extraer fuentes» en{' '}
              <a href="#/automatizaciones" className="underline underline-offset-2">
                Automatizaciones
              </a>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewSourcePrompt onStarted={() => setOpen(true)} />
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {view.sources.map((s) => (
            <SourceCard
              key={s.id}
              s={s}
              busy={busy === s.id}
              anyBusy={!!busy}
              filtered={sourceFilter === s.id}
              onExtract={() => void extract([s.id])}
              onConfigure={() => void ask(s.id, () => sourcesApi.configure(s.id, uiRef.current))}
              onEdit={() => setEditing(s)}
              onRemove={() => void remove(s)}
              onToggle={(on) => void toggle(s, on)}
              onFilter={() => setSourceFilter(sourceFilter === s.id ? 'any' : s.id)}
            />
          ))}
        </section>
      )}

      {view.sources.length > 0 && <Results view={view} sourceFilter={sourceFilter} setSourceFilter={setSourceFilter} />}

      {editing && (
        <SourceForm
          source={editing}
          onClose={() => setEditing(null)}
          onSaved={(v) => {
            setView(v);
            setEditing(null);
          }}
        />
      )}
      {creating && (
        <Dialog open onOpenChange={(o) => !o && setCreating(false)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Nueva fuente</DialogTitle>
              <DialogDescription>Dile al agente qué quieres extraer. Se abre una conversación: te pregunta lo que necesite, busca las páginas si no las tienes y, cuando lo apruebes, crea la fuente.</DialogDescription>
            </DialogHeader>
            <NewSourcePrompt
              autoFocus
              onStarted={() => {
                setCreating(false);
                setOpen(true);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
      <ItemDialog id={open} sources={view.sources} onClose={() => go(null)} />
    </main>
  );
}

/* ───── A source ───── */

function SourceCard({s, busy, anyBusy, filtered, onExtract, onConfigure, onEdit, onRemove, onToggle, onFilter}: {s: SourcesView['sources'][number]; busy: boolean; anyBusy: boolean; filtered: boolean; onExtract: () => void; onConfigure: () => void; onEdit: () => void; onRemove: () => void; onToggle: (on: boolean) => void; onFilter: () => void}) {
  const run = s.lastRun;
  return (
    <Card className={cn('gap-3 py-4', !s.enabled && 'opacity-60')}>
      <CardHeader className="px-4">
        <div className="flex items-start gap-2">
          <CardTitle className="min-w-0 flex-1 leading-snug">{s.name}</CardTitle>
          <Switch checked={s.enabled} onCheckedChange={onToggle} aria-label={s.enabled ? `Desactivar ${s.name}` : `Activar ${s.name}`} title={s.enabled ? 'Activa: entra en «Extraer todas» y en las automatizaciones' : 'Desactivada'} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Más acciones de ${s.name}`} className="-my-1">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Editar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onConfigure} disabled={anyBusy}>
                <Wand2 /> Ajustar con el agente
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <Trash2 /> Borrar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {s.description && <CardDescription className="line-clamp-2">{s.description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 px-4">
        <div className="flex flex-wrap gap-1.5">
          {s.links.slice(0, 4).map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" title={l.url} className="inline-flex max-w-44 items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground">
              <Globe className="size-3 flex-none" />
              <span className="truncate">{l.label}</span>
            </a>
          ))}
          {s.links.length > 4 && <span className="px-1 py-0.5 text-xs text-muted-foreground">+{s.links.length - 4}</span>}
          {!s.links.length && (
            <button type="button" onClick={onConfigure} disabled={anyBusy} className="text-xs text-amber-400 underline-offset-2 hover:underline">
              Sin enlaces: que el agente los busque
            </button>
          )}
        </div>
        <div className="mt-auto flex items-end gap-2">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <button type="button" onClick={onFilter} className={cn('hover:text-foreground', filtered && 'font-medium text-foreground')} title={filtered ? 'Ver los resultados de todas' : 'Ver solo sus resultados en la tabla'}>
              {s.items} {s.items === 1 ? 'resultado' : 'resultados'}
              {s.fresh > 0 && <span className="text-sky-400"> · {s.fresh} sin abrir</span>}
            </button>
            <p className={cn('truncate', run && !run.ok && 'text-destructive')} title={run?.note || undefined}>
              {run ? `${run.ok ? 'Extraída' : 'Falló'} ${fmtAgo(run.at)}${run.ok ? ` · ${run.added} ${run.added === 1 ? 'nuevo' : 'nuevos'}` : ''}${run.note ? ` · ${run.note}` : ''}` : 'Nunca extraída'}
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={anyBusy} onClick={onExtract} title="Un agente la recorre y guarda lo nuevo, en una conversación nueva">
            {busy ? <Loader2 className="animate-spin" /> : <Play />} Extraer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// "Nueva fuente": what he wants to extract, in a line; the agent takes it from there in a new general conversation.
function NewSourcePrompt({autoFocus, onStarted}: {autoFocus?: boolean; onStarted: () => void}) {
  const {uiRef} = useStudio();
  const [want, setWant] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const start = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!want.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      await sourcesApi.create(want, uiRef.current);
      setWant('');
      onStarted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={start} className="flex flex-col gap-3">
      <Label htmlFor="source-want">¿Qué información quieres extraer?</Label>
      <Textarea
        id="source-want"
        value={want}
        rows={3}
        autoFocus={autoFocus}
        onChange={(e) => setWant(e.target.value)}
        // ⌘/Ctrl+Enter starts it, like sending a message.
        onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && void start()}
        placeholder="Las novedades de los modelos de IA: lanzamientos y actualizaciones de Anthropic, OpenAI, Google y xAI, para hacer videos de noticias."
      />
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button type="submit" className="self-end" disabled={!want.trim() || busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Bot />} Crear con el agente
      </Button>
    </form>
  );
}

// Editing a source by hand (a new one is always made with the agent).
function SourceForm({source, onClose, onSaved}: {source: Source; onClose: () => void; onSaved: (v: SourcesView) => void}) {
  const [name, setName] = useState(source.name);
  const [description, setDescription] = useState(source.description);
  const [links, setLinks] = useState(source.links.map((l) => (l.label && l.label !== host(l.url) ? `${l.label} | ${l.url}` : l.url)).join('\n'));
  const [instructions, setInstructions] = useState(source.instructions);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr('');
    const input: SourceInput = {name, description, links, instructions};
    try {
      onSaved(await sourcesApi.edit(source.id, input));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar fuente</DialogTitle>
          <DialogDescription>Para cambios grandes (otros sitios, otro enfoque), mejor «Ajustar con el agente»: busca y comprueba los enlaces y reescribe las instrucciones.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source-name">Nombre</Label>
            <Input id="source-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Novedades de modelos de IA" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source-description">Qué quieres sacar de aquí</Label>
            <Textarea id="source-description" value={description} rows={3} onChange={(e) => setDescription(e.target.value)} placeholder="Lanzamientos y actualizaciones de modelos de Anthropic, OpenAI, Google DeepMind y xAI: qué cambia, benchmarks, precios y disponibilidad. Sin artículos de opinión." />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source-links">Enlaces</Label>
            <Textarea id="source-links" value={links} rows={4} className="font-mono text-xs" onChange={(e) => setLinks(e.target.value)} placeholder={'https://www.anthropic.com/news\nOpenAI | https://openai.com/news/'} spellCheck={false} />
            <p className="text-xs text-muted-foreground">Uno por línea. Opcional: «Etiqueta | https://…».</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source-instructions">Instrucciones para el agente</Label>
            <Textarea id="source-instructions" value={instructions} rows={6} className="font-mono text-xs" onChange={(e) => setInstructions(e.target.value)} placeholder={'Qué buscar y qué ignorar, dónde mirar en cada página, cómo saber qué es nuevo, qué datos guardar de cada resultado y qué etiquetas usar (markdown).'} />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy && <Loader2 className="animate-spin" />} Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ───── What was extracted ───── */

type SortKey = 'published' | 'extracted' | 'title';
type Filters = {state: string; tag: string; sinceDays: string};
const NO_FILTERS: Filters = {state: 'any', tag: 'any', sinceDays: 'any'};

function Results({view, sourceFilter, setSourceFilter}: {view: SourcesView; sourceFilter: string; setSourceFilter: (s: string) => void}) {
  const [data, setData] = useState<SourceItemList | null>(null);
  const [err, setErr] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState(''); // q after a pause
  const [sort, setSort] = useState<{key: SortKey; desc: boolean}>({key: 'published', desc: true});
  const [page, setPage] = useState(0);
  const cols = useColumns('sources', [{key: 'source', label: 'Fuente'}, {key: 'tags', label: 'Etiquetas'}, {key: 'published', label: 'Publicado'}, {key: 'extracted', label: 'Extraído'}, {key: 'state', label: 'Estado'}]);
  const names = useMemo(() => new Map(view.sources.map((s) => [s.id, s.name])), [view.sources]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(0), [filters, query, sort, sourceFilter]);
  const load = useCallback(
    () =>
      sourcesApi
        .items({
          q: query || undefined,
          source: sourceFilter === 'any' ? undefined : sourceFilter,
          state: filters.state === 'any' ? undefined : filters.state,
          tag: filters.tag === 'any' ? undefined : filters.tag,
          sinceDays: filters.sinceDays === 'any' ? undefined : filters.sinceDays,
          sort: sort.key,
          desc: sort.desc,
          page,
          size: PAGE,
        })
        .then(setData, (e: Error) => setErr(e.message)),
    [query, sourceFilter, filters, sort, page],
  );
  useEffect(() => void load(), [load]);
  useSocket((m) => m.type === 'sources' && void load(), load);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const active = !!query || sourceFilter !== 'any' || Object.values(filters).some((v) => v !== 'any');
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">Resultados</h2>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en títulos, resúmenes y contenido…" className="h-8 pl-8" aria-label="Buscar" spellCheck={false} />
        </div>
        <FilterSelect value={sourceFilter} onChange={setSourceFilter} label="Fuente" options={[['any', 'Todas'], ...view.sources.map((s): [string, string] => [s.id, s.name])]} />
        <FilterSelect
          value={filters.state}
          onChange={(v) => setFilters((f) => ({...f, state: v}))}
          label="Estado"
          options={[['any', 'Cualquiera'], ['pending', 'Por revisar'], ...Object.entries(STATES).map(([k, s]): [string, string] => [k, s.label])]}
        />
        {view.tags.length > 0 && <FilterSelect value={filters.tag} onChange={(v) => setFilters((f) => ({...f, tag: v}))} label="Etiqueta" options={[['any', 'Todas'], ...view.tags.map((t): [string, string] => [t, `#${t}`])]} />}
        <FilterSelect
          value={filters.sinceDays}
          onChange={(v) => setFilters((f) => ({...f, sinceDays: v}))}
          label="Fecha"
          options={[['any', 'Cualquiera'], ['1', 'Último día'], ['7', 'Última semana'], ['30', 'Último mes'], ['90', 'Últimos 3 meses']]}
        />
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('');
              setFilters(NO_FILTERS);
              setSourceFilter('any');
            }}
          >
            <X /> Limpiar
          </Button>
        )}
        <div className="ml-auto">{cols.picker}</div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!data && !err && <ListSkeleton variant="table" count={8} />}
      {data && total === 0 && <p className="text-sm text-muted-foreground">{active ? 'Ningún resultado cumple esos filtros.' : 'Todavía no hay resultados: pulsa Extraer en una fuente.'}</p>}
      {data && total > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead<SortKey> k="title" sort={sort} setSort={setSort}>
                  Título
                </SortHead>
                {cols.shown('source') && <TableHead>Fuente</TableHead>}
                {cols.shown('tags') && <TableHead>Etiquetas</TableHead>}
                {cols.shown('published') && (
                  <SortHead<SortKey> k="published" sort={sort} setSort={setSort} title="Cuándo salió (o, sin fecha, cuándo se extrajo)">
                    Publicado
                  </SortHead>
                )}
                {cols.shown('extracted') && (
                  <SortHead<SortKey> k="extracted" sort={sort} setSort={setSort}>
                    Extraído
                  </SortHead>
                )}
                {cols.shown('state') && <TableHead>Estado</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id} className={cn('cursor-pointer', r.state === 'discarded' && 'opacity-60')} onClick={() => go(r.id)}>
                  <TableCell className="max-w-0 min-w-72 whitespace-normal">
                    <p className={cn('line-clamp-1', r.state === 'new' && 'font-medium')}>{r.title}</p>
                    {r.summary && <p className="line-clamp-1 text-xs text-muted-foreground">{r.summary}</p>}
                    <a href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      {host(r.url)} <ExternalLink className="size-3" />
                    </a>
                  </TableCell>
                  {cols.shown('source') && <TableCell className="text-sm text-muted-foreground">{names.get(r.source) ?? '—'}</TableCell>}
                  {cols.shown('tags') && (
                    <TableCell className="whitespace-normal">
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {r.tags.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilters((f) => ({...f, tag: t}));
                            }}
                            className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            #{t}
                          </button>
                        ))}
                      </div>
                    </TableCell>
                  )}
                  {cols.shown('published') && <TableCell className="text-muted-foreground tabular-nums">{fmtDay(r.published)}</TableCell>}
                  {cols.shown('extracted') && <TableCell className="text-muted-foreground tabular-nums">{fmtAgo(r.extracted)}</TableCell>}
                  {cols.shown('state') && (
                    <TableCell>
                      <StateBadge state={r.state} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
              <span className="mr-auto tabular-nums">
                {page * PAGE + 1}–{page * PAGE + data.rows.length} de {total}
              </span>
              <Button variant="ghost" size="icon-sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior">
                <ChevronLeft />
              </Button>
              <span className="tabular-nums">
                {page + 1} / {pages}
              </span>
              <Button variant="ghost" size="icon-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Página siguiente">
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      )}
      {data && total > 0 && pages === 1 && <p className="-mt-1 text-xs text-muted-foreground tabular-nums">{total === 1 ? '1 resultado' : `${total} resultados`}</p>}
    </section>
  );
}

function StateBadge({state}: {state: SourceItemState}) {
  return (
    <Badge variant="outline" className={STATES[state].className}>
      {STATES[state].label}
    </Badge>
  );
}

// A result's card: its text in markdown, its links, and what to do with it. Opening it marks it as read.
function ItemDialog({id, sources, onClose}: {id: string | null; sources: Source[]; onClose: () => void}) {
  const {uiRef, setOpen} = useStudio();
  const confirm = useConfirm();
  const [it, setIt] = useState<SourceItemDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    if (!id) return setIt(null);
    sourcesApi.item(id).then(setIt, (e: Error) => setErr(e.message));
  }, [id]);
  useEffect(() => {
    setErr('');
    load();
  }, [load]);
  useSocket((m) => m.type === 'sources' && void load(), load);
  useEffect(() => {
    if (it && it.id === id && it.state === 'new') void sourcesApi.editItem(it.id, {state: 'read'}).catch(() => {});
  }, [it, id]);

  const setState = (state: SourceItemState) => it && sourcesApi.editItem(it.id, {state}).then((x) => setIt({...it, ...x}), (e: Error) => setErr(e.message));
  const remove = async () => {
    if (!it || !(await confirm({title: '¿Borrar este resultado?', description: it.title, action: 'Borrar', destructive: true}))) return;
    sourcesApi.removeItem(it.id).then(onClose, (e: Error) => setErr(e.message));
  };
  const toIdea = async () => {
    if (!it) return;
    setBusy(true);
    try {
      await sourcesApi.toIdea(it.id, uiRef.current);
      setOpen(true);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const source = sources.find((s) => s.id === it?.source);
  const html = useMemo(() => (it?.markdown ? renderMd(it.markdown) : ''), [it?.markdown]);

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        {!it || it.id !== id ? (
          <>
            <DialogTitle className="sr-only">Resultado</DialogTitle>
            {err ? <p className="text-sm text-destructive">{err}</p> : <ListSkeleton variant="lines" count={10} />}
          </>
        ) : (
          <>
            <DialogHeader>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{source?.name ?? 'Fuente borrada'}</span>
                <span>·</span>
                <span>publicado {fmtDay(it.published)}</span>
                <span>·</span>
                <span>extraído {fmtAgo(it.extracted)}</span>
              </p>
              <DialogTitle className="pr-6 text-lg leading-snug">{it.title}</DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-col gap-2">
                  {it.summary && <p>{it.summary}</p>}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <a href={it.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-foreground hover:bg-muted">
                      <ExternalLink className="size-3" /> {host(it.url)}
                    </a>
                    {it.links.map((l) => (
                      <a key={l.url} href={l.url} target="_blank" rel="noreferrer" title={l.url} className="inline-flex max-w-56 items-center gap-1 truncate rounded-md border px-2 py-0.5 text-xs hover:bg-muted hover:text-foreground">
                        <Globe className="size-3 flex-none" /> <span className="truncate">{l.label}</span>
                      </a>
                    ))}
                    {it.tags.map((t) => (
                      <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/20 p-4">
              {html ? (
                <div className="prose prose-sm max-w-none prose-invert prose-headings:mt-4 prose-headings:mb-1 prose-headings:text-base prose-p:my-1.5 prose-ul:my-1.5 prose-img:rounded-md" dangerouslySetInnerHTML={{__html: html}} />
              ) : (
                <p className="text-sm text-muted-foreground">El agente no guardó contenido para este resultado.</p>
              )}
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <DialogFooter className="flex-wrap items-center gap-2 sm:justify-between">
              <div className="flex items-center gap-2">
                <Select value={it.state} onValueChange={(v) => void setState(v as SourceItemState)}>
                  <SelectTrigger size="sm" className="w-36" aria-label="Estado">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATES).map(([k, s]) => (
                      <SelectItem key={k} value={k}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon-sm" onClick={() => void remove()} title="Borrar" aria-label="Borrar resultado">
                  <Trash2 />
                </Button>
              </div>
              <div className="flex gap-2">
                {it.state !== 'discarded' && (
                  <Button variant="outline" size="sm" onClick={() => void setState('discarded')}>
                    <X /> Descartar
                  </Button>
                )}
                {it.state !== 'used' && (
                  <Button variant="outline" size="sm" onClick={() => void setState('used')} title="Ya lo usaste en una idea o un video">
                    <Check /> Marcar como usado
                  </Button>
                )}
                <Button size="sm" disabled={busy} onClick={() => void toIdea()} title="El agente propone ángulos para un reel y, si apruebas uno, lo añade a Ideas de contenido">
                  {busy ? <Loader2 className="animate-spin" /> : <Lightbulb />} Convertir en idea
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

