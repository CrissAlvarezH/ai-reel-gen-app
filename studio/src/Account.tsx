import {useCallback, useEffect, useRef, useState} from 'react';
import {
  AlertTriangle,
  AtSign,
  BadgeCheck,
  ChartLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  Bookmark,
  Film,
  Heart,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  MessageSquarePlus,
  Trophy,
  UserRound,
  X,
} from 'lucide-react';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {cn} from '@/lib/utils';
import PageSkeleton from '@/components/common/PageSkeleton';
import ListSkeleton from '@/components/common/ListSkeleton';
import {accountApi, fmtAgo, fmtTime, useSocket, type AccountStatus, type OwnReel, type OwnReelCard, type OwnReelList} from './api';
import {useConfirm} from './confirm';
import {FilterSelect, RatioHelp, SortHead} from './Inspiration';
import {AnalysisSections, FramesSection, Section, StateBadge, TranscriptSection} from './ReelAnalysis';
import {projectKey, useStudio} from './studio';
import {useColumns} from './Columns';

// Mi cuenta (#/cuenta): the creator's own Instagram account. Until it's set, a screen that asks for it.
// Then its newest reels with their numbers (downloaded with the scraper of Ajustes → Extracción de datos,
// which says what it costs first), the best of those loaded on top (clicking one opens its card), and "Analizar con el agente", which
// opens a general conversation with one of its requests (REQUESTS; the agent only uses what's already downloaded
// unless he agrees to spend: server/account.ts). Each reel can
// also be analysed on its own, like Inspiración's (transcript, frames, the agent's analysis): from its row or
// its card, or all those not analysed yet at once; never by itself.

// "Analizar con el agente": what he can ask for (the server writes each request, analysisRequest).
type Request = 'reels' | 'ideas' | 'variants' | 'general';
const REQUESTS: {kind: Request; label: string; hint: string; icon: typeof Eye}[] = [
  {kind: 'reels', label: 'Analizar los videos cargados', hint: 'Qué funciona, qué no y qué cambiar en los próximos', icon: ListChecks},
  {kind: 'ideas', label: 'Proponer nuevas ideas', hint: 'Temas y ganchos para tus próximos reels, a partir de lo que mejor te va', icon: Lightbulb},
  {kind: 'variants', label: 'Crear variantes de contenido', hint: 'Otros ganchos, ángulos y formatos de tus reels que mejor van', icon: Copy},
  {kind: 'general', label: 'Hacer análisis general', hint: 'Dónde está tu cuenta, cómo evoluciona y hacia dónde ir', icon: ChartLine},
];

const FIRST = 10; // the first download, and how many more "Cargar más" brings
const PAGE = 10; // rows per page of the table

// The table's order and filters, like Inspiración's (the server applies them, on the studio's index); 'any' is no filter.
type SortKey = 'posted' | 'views' | 'ratio' | 'likes' | 'comments' | 'saves' | 'shares' | 'reach' | 'engagement' | 'retention' | 'skipRate' | 'duration' | 'wps';
type Filters = {minRatio: string; sinceDays: string; dur: string; state: string};
const NO_FILTERS: Filters = {minRatio: 'any', sinceDays: 'any', dur: 'any', state: 'any'};
const FILTERS: {
  key: keyof Filters;
  label: string;
  options: [string, string][];
}[] = [
  {
    key: 'minRatio',
    label: 'Multiplicador',
    options: [
      ['any', 'Cualquiera'],
      ['1', '≥ 1× tu mediana'],
      ['2', '≥ 2× tu mediana'],
      ['3', '≥ 3× tu mediana'],
      ['5', '≥ 5× tu mediana'],
    ],
  },
  {
    key: 'sinceDays',
    label: 'Fecha',
    options: [
      ['any', 'Cualquiera'],
      ['7', 'Última semana'],
      ['30', 'Último mes'],
      ['90', 'Últimos 3 meses'],
      ['180', 'Últimos 6 meses'],
      ['365', 'Último año'],
    ],
  },
  {
    key: 'dur',
    label: 'Duración',
    options: [
      ['any', 'Cualquiera'],
      ['short', 'Menos de 30 s'],
      ['mid', '30–60 s'],
      ['long', '60–90 s'],
      ['xl', '90 s o más'],
    ],
  },
  {
    key: 'state',
    label: 'Estado',
    options: [
      ['any', 'Cualquiera'],
      ['ready', 'Analizados'],
      ['unanalysed', 'Sin analizar'],
      ['error', 'Con error'],
    ],
  },
];
// The table's search, filters, order and page, per project, kept in this browser so they survive going to other pages
// (and reloads). What doesn't fit the options now falls back to the default.
const SAVED = () => projectKey('studio.account.table');
const SORT_KEYS: SortKey[] = ['posted', 'views', 'ratio', 'likes', 'comments', 'engagement', 'duration', 'wps'];
type Saved = {q: string; filters: Filters; sort: {key: SortKey; desc: boolean}; page: number};
function loadSaved(): Saved {
  const none: Saved = {q: '', filters: NO_FILTERS, sort: {key: 'posted', desc: true}, page: 0};
  try {
    const s = JSON.parse(localStorage.getItem(SAVED()) ?? 'null');
    if (!s || typeof s !== 'object') return none;
    const filters = {...NO_FILTERS};
    for (const f of FILTERS) if (f.options.some(([v]) => v === s.filters?.[f.key])) filters[f.key] = s.filters[f.key];
    return {
      q: typeof s.q === 'string' ? s.q.slice(0, 200) : '',
      filters,
      sort: SORT_KEYS.includes(s.sort?.key) ? {key: s.sort.key, desc: s.sort.desc !== false} : none.sort,
      page: Number.isInteger(s.page) && s.page > 0 ? s.page : 0,
    };
  } catch {
    return none;
  }
}
function save(v: Saved) {
  try {
    localStorage.setItem(SAVED(), JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

// Where Guardados, Compartidos… come from: Instagram, read with each download (or why not).
function InsightsNote({st}: {st: AccountStatus}) {
  const i = st.insights;
  if (!i?.account)
    return (
      <a href="#/ajustes/instagram" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        Conecta Instagram para ver guardados y retención
      </a>
    );
  if (i.error)
    return (
      <span className="max-w-80 truncate text-xs text-amber-400" title={i.error}>
        Números de Instagram: {i.error}
      </span>
    );
  return <span className="text-xs text-muted-foreground">{i.at ? `Números de Instagram de @${i.account}: ${fmtAgo(i.at)}` : `Llegan con la próxima actualización (@${i.account})`}</span>;
}

const num = (v: number | null | undefined) => (v == null ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.0', '')} M` : v >= 1e4 ? `${Math.round(v / 1e3)} k` : v.toLocaleString('es'));
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1).replace('.0', '')} %`);
// "26 oct", with the year only when it isn't this one.
const date = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== new Date().getFullYear() ? {year: '2-digit'} : {}),
  });
};
const title = (r: OwnReel) =>
  r.caption
    .split('\n')
    .find((l) => l.trim())
    ?.trim() || 'Sin caption';

export function Account() {
  const {uiRef, setOpen} = useStudio();
  const confirm = useConfirm();
  const [st, setSt] = useState<AccountStatus | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'fetch' | 'analyse' | null>(null);
  const [saved] = useState(loadSaved);
  const [page, setPage] = useState(saved.page);
  const [open, setOpenReel] = useState<string | null>(null); // the reel whose card is open
  const [sort, setSort] = useState(saved.sort);
  const [filters, setFilters] = useState(saved.filters);
  const [q, setQ] = useState(saved.q);
  // Pal/s, alcance and salto are off until he turns them on. Guardados to salto come from Instagram itself
  // (Ajustes → Instagram).
  const cols = useColumns(
    'account',
    [
      {key: 'ratio', label: 'Multiplicador'},
      {key: 'views', label: 'Vistas'},
      {key: 'likes', label: 'Likes'},
      {key: 'comments', label: 'Comentarios'},
      {key: 'saves', label: 'Guardados'},
      {key: 'shares', label: 'Compartidos'},
      {key: 'reach', label: 'Alcance'},
      {key: 'engagement', label: 'Interacción'},
      {key: 'retention', label: 'Retención'},
      {key: 'skipRate', label: 'Tasa de salto'},
      {key: 'duration', label: 'Duración'},
      {key: 'wps', label: 'Palabras por segundo'},
      {key: 'posted', label: 'Fecha'},
    ],
    ['wps', 'reach', 'skipRate'],
  );
  const fromIg = st?.insights?.account ? `De Instagram (@${st.insights.account})` : 'De Instagram: conecta la cuenta en Ajustes → Instagram';
  const [search, setSearch] = useState(saved.q.trim()); // q, once he stops typing
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  // A new order, filter or search goes back to the first page (not the saved ones, when the page opens).
  const criteria = JSON.stringify([sort, filters, search]);
  const lastCriteria = useRef(criteria);
  useEffect(() => {
    if (lastCriteria.current === criteria) return;
    lastCriteria.current = criteria;
    setPage(0);
  }, [criteria]);
  useEffect(() => save({q: search, filters, sort, page}), [search, filters, sort, page]);
  const [list, setList] = useState<OwnReelList | null>(null);
  // A saved page past the end (fewer reels now): the last one.
  useEffect(() => {
    if (list && page > 0 && page * PAGE >= list.total) setPage(Math.max(0, Math.ceil(list.total / PAGE) - 1));
  }, [list, page]);
  const active = !!q.trim() || Object.values(filters).some((v) => v !== 'any');
  const load = useCallback(() => accountApi.status().then(setSt, (e: Error) => setErr(e.message)), []);
  useEffect(() => void load(), [load]);
  // The table's page, again whenever the account's reels change (st).
  useEffect(() => {
    if (!st?.username) return;
    const f = (v: string) => (v === 'any' ? undefined : v);
    accountApi
      .list({q: search, minRatio: f(filters.minRatio), sinceDays: f(filters.sinceDays), dur: f(filters.dur), state: f(filters.state), sort: sort.key, desc: sort.desc, page, size: PAGE})
      .then(setList, (e: Error) => setErr(e.message));
  }, [st, search, filters, sort, page]);
  useSocket((m) => m.type === 'account' && void load(), load);
  uiRef.current = {page: 'account'};

  // Download the newest limit reels, after saying what it costs; then show page goTo of the table, if given.
  const download = async (limit: number, what: string, goTo?: number) => {
    setErr('');
    try {
      const e = await accountApi.estimate(limit);
      const ok = await confirm({
        title: `¿${what}?`,
        description: `Se descargan tus ${e.limit} reels más recientes con sus números, y tu perfil (foto, seguidores, bio). ${e.charge}.`,
        action: 'Descargar',
      });
      if (!ok) return;
      setBusy('fetch');
      setSt(await accountApi.fetch(e.limit));
      if (goTo != null) setPage(goTo);
    } catch (e) {
      setErr((e as Error).message);
      void load();
    } finally {
      setBusy(null);
    }
  };
  // Analyse reels on their own (one, or all those not analysed yet), after saying what it uses.
  const analyseReels = async (what: {codes: string[]} | {all: true}, n: number, again = false) => {
    setErr('');
    const ok = await confirm({
      title: again ? '¿Volver a analizar este reel?' : n === 1 ? '¿Analizar este reel?' : `¿Analizar ${n} reels?`,
      description: `${again ? 'El análisis nuevo reemplaza al de ahora. ' : ''}Se descarga ${n === 1 ? 'el video' : 'cada video'} para transcribirlo y sacar sus fotogramas (luego se borra) y el agente ${n === 1 ? 'lo analiza' : 'los analiza'} con tu suscripción: qué funcionó y qué cambiar, frente al resto de tus reels (sus vistas contra tu mediana, su interacción contra tu media). No gasta saldo del scraper.`,
      action: 'Analizar',
    });
    if (!ok) return;
    try {
      await accountApi.analyseReels(what);
      void load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const analyse = async (kind: Request) => {
    setErr('');
    setBusy('analyse');
    try {
      await accountApi.analyse(kind, uiRef.current);
      setOpen(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (err && !st) return <p className="p-6 text-destructive">{err}</p>;
  if (!st)
    return (
      <PageSkeleton maxWidth="max-w-6xl">
        <ListSkeleton variant="table" count={8} announce={false} />
      </PageSkeleton>
    );

  const dialog = (
    <SetupDialog
      open={editing}
      current={st.username}
      onOpenChange={setEditing}
      onSaved={(s) => {
        setSt(s);
        setEditing(false);
        if (!s.count) void download(FIRST, `Descargar tus últimos ${FIRST} reels`);
      }}
    />
  );

  if (!st.username)
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mi cuenta</h1>
        <Card className="items-center py-12 text-center">
          <CardContent className="flex max-w-md flex-col items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserRound className="size-6" />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-lg font-medium">Aún no has configurado tu cuenta</p>
              <p className="text-sm text-muted-foreground">Agrega tu perfil de Instagram para ver tus últimos reels con sus números, los que mejor te van y pedirle al agente que los analice.</p>
            </div>
            <Button onClick={() => setEditing(true)}>
              <AtSign /> Configurar
            </Button>
          </CardContent>
        </Card>
        {dialog}
      </main>
    );

  const count = st.count;
  const top = st.top;
  const rows = list?.rows ?? [];
  const total = list?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pg = Math.min(page, pages - 1);
  const working = !!st.job || busy === 'fetch';
  const p = st.profile;
  const unanalysed = (st.states.pending ?? 0) + (st.states.processed ?? 0) + (st.states.error ?? 0);
  const noTranscriber = !st.transcriber && (st.states.pending ?? 0) + (st.states.error ?? 0) > 0;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center gap-4">
        {st.avatar ? (
          <img src={`${accountApi.avatar}?v=${st.username}-${st.fetched ?? 0}`} alt="" className="size-14 flex-none rounded-full object-cover" />
        ) : (
          <div className="flex size-14 flex-none items-center justify-center rounded-full bg-muted">
            <UserRound className="size-6 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <span className="truncate">{st.fullName || `@${st.username}`}</span>
            {p?.verified && <BadgeCheck className="size-5 flex-none text-sky-400" />}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
            <a href={`https://www.instagram.com/${st.username}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              @{st.username} <ExternalLink className="size-3" />
            </a>
            {st.fetched && <span>Actualizado {fmtAgo(st.fetched)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={working || !st.scraper.ready} onClick={() => download(Math.max(FIRST, Math.min(count, 30)), 'Actualizar tus reels')}>
            {working ? <Loader2 className="animate-spin" /> : <RefreshCw />} {working ? 'Descargando…' : 'Actualizar'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={busy === 'analyse'}>
                {busy === 'analyse' ? <Loader2 className="animate-spin" /> : <Sparkles />} Analizar con el agente <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              {REQUESTS.map(({kind, label, hint, icon: I}) => (
                <DropdownMenuItem key={kind} onSelect={() => void analyse(kind)} className="items-start gap-2.5 py-2">
                  <I className="mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    <span>{label}</span>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Más">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <AtSign /> Cambiar cuenta
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!st.scraper.ready && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Falta la clave de {st.scraper.label}</AlertTitle>
          <AlertDescription>
            <p>
              Tus reels se descargan con el scraper de{' '}
              <a href="#/ajustes/datos" className="underline underline-offset-2">
                Ajustes → Extracción de datos
              </a>
              : pon allí su clave o elige el otro.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {err && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>No se pudo</AlertTitle>
          <AlertDescription>{err}</AlertDescription>
        </Alert>
      )}
      {!err && st.error && !working && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>La última descarga tuvo un problema</AlertTitle>
          <AlertDescription>{st.error}</AlertDescription>
        </Alert>
      )}
      {working && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Descargando {st.job ? `hasta ${st.job.limit} reels` : 'tus reels'} con {st.scraper.label}…
        </p>
      )}
      {st.analysis && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="tabular-nums">
            Analizando {st.analysis.total === 1 ? 'un reel' : `tus reels: ${st.analysis.done} de ${st.analysis.total}`}…
          </span>
          <Button variant="ghost" size="sm" onClick={() => accountApi.stopAnalysis().catch((e: Error) => setErr(e.message))} title="Lo que está en cola no empieza y lo que se está transcribiendo o analizando se detiene">
            <Square /> Detener
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Seguidores" value={num(p?.followers)} />
        <Stat label="Mediana de vistas" value={num(st.median)} hint={st.median == null ? 'con 5 reels o más' : `de ${count} reels`} />
        <Stat label="Interacción media" value={pct(st.engagement)} hint="(likes + comentarios) ÷ vistas" />
        <Stat label="Reels cargados" value={String(count)} hint={p?.posts != null ? `de ${num(p.posts)} publicaciones` : undefined} />
      </div>

      {!count ? (
        <Card className="items-center py-10 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">Aún no has descargado tus reels.</p>
            <Button disabled={working || !st.scraper.ready} onClick={() => download(FIRST, `Descargar tus últimos ${FIRST} reels`)}>
              {working ? <Loader2 className="animate-spin" /> : <RefreshCw />} Descargar los últimos {FIRST}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Trophy className="size-4 text-amber-400" /> Los que mejor van
              </h2>
              <p className="text-sm text-muted-foreground">Por vistas, entre los {count} reels cargados.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {top.map((r, i) => (
                <TopCard key={r.code} r={r} rank={i + 1} onOpen={() => setOpenReel(r.code)} />
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1">
                <h2 className="text-lg font-semibold">Reels cargados</h2>
                <p className="text-sm text-muted-foreground">El multiplicador compara las vistas de cada uno con la mediana de los cargados.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!unanalysed || noTranscriber}
                onClick={() => void analyseReels({all: true}, unanalysed)}
                title={
                  noTranscriber
                    ? 'Falta la transcripción: instálala en Ajustes → Requisitos → Transcripción'
                    : unanalysed
                      ? 'Transcribe cada reel que no esté analizado, saca sus fotogramas y el agente lo analiza'
                      : 'Todos tus reels están analizados'
                }
              >
                <Sparkles /> {unanalysed ? `Analizar los que faltan (${unanalysed})` : 'Todos analizados'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={working || !st.scraper.ready || count >= 200}
                onClick={() => download(count + FIRST, `Cargar ${FIRST} reels más`, Math.floor(count / PAGE))}
              >
                Cargar {FIRST} más
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-56 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en captions, transcripciones y análisis…" className="h-8 pl-8" aria-label="Buscar" spellCheck={false} />
              </div>
              {FILTERS.map((f) => (
                <FilterSelect key={f.key} value={filters[f.key]} onChange={(v) => setFilters((x) => ({...x, [f.key]: v}))} label={f.label} options={f.options} />
              ))}
              {active && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQ('');
                    setFilters(NO_FILTERS);
                  }}
                >
                  <X /> Limpiar
                </Button>
              )}
              <div className="ml-auto flex items-center gap-3">
                <InsightsNote st={st} />
                {cols.picker}
              </div>
            </div>
            {!list ? null : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ningún reel cumple esos filtros.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12" />
                      <TableHead>Reel</TableHead>
                      {cols.shown('ratio') && (
                        <SortHead k="ratio" sort={sort} setSort={setSort} hover={<RatioHelp mine />}>
                          Multiplicador
                        </SortHead>
                      )}
                      {cols.shown('views') && (
                        <SortHead k="views" sort={sort} setSort={setSort}>
                          Vistas
                        </SortHead>
                      )}
                      {cols.shown('likes') && (
                        <SortHead k="likes" sort={sort} setSort={setSort}>
                          Likes
                        </SortHead>
                      )}
                      {cols.shown('comments') && (
                        <SortHead k="comments" sort={sort} setSort={setSort}>
                          Coment.
                        </SortHead>
                      )}
                      {cols.shown('saves') && (
                        <SortHead k="saves" sort={sort} setSort={setSort} title={fromIg}>
                          Guard.
                        </SortHead>
                      )}
                      {cols.shown('shares') && (
                        <SortHead k="shares" sort={sort} setSort={setSort} title={fromIg}>
                          Compart.
                        </SortHead>
                      )}
                      {cols.shown('reach') && (
                        <SortHead k="reach" sort={sort} setSort={setSort} title={`${fromIg}: cuentas que lo vieron (estimado de Meta)`}>
                          Alcance
                        </SortHead>
                      )}
                      {cols.shown('engagement') && (
                        <SortHead k="engagement" sort={sort} setSort={setSort} title="(likes + comentarios) ÷ vistas">
                          Interacción
                        </SortHead>
                      )}
                      {cols.shown('retention') && (
                        <SortHead k="retention" sort={sort} setSort={setSort} title={`${fromIg}: tiempo promedio de reproducción ÷ duración`}>
                          Retención
                        </SortHead>
                      )}
                      {cols.shown('skipRate') && (
                        <SortHead k="skipRate" sort={sort} setSort={setSort} title={`${fromIg}: % de reproducciones que lo pasan en los primeros segundos`}>
                          Salto
                        </SortHead>
                      )}
                      {cols.shown('duration') && (
                        <SortHead k="duration" sort={sort} setSort={setSort}>
                          Dur.
                        </SortHead>
                      )}
                      {cols.shown('wps') && (
                        <SortHead k="wps" sort={sort} setSort={setSort} title="Palabras por segundo de la voz">
                          Pal/s
                        </SortHead>
                      )}
                      {cols.shown('posted') && (
                        <SortHead k="posted" sort={sort} setSort={setSort}>
                          Fecha
                        </SortHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.code} className="cursor-pointer" onClick={() => setOpenReel(r.code)}>
                        <TableCell className="w-12 min-w-12 py-1.5">
                          {r.thumb ? (
                            <img src={accountApi.thumb(r.code)} alt="" loading="lazy" className="h-14 w-8 max-w-none min-w-8 rounded-sm object-cover" />
                          ) : (
                            <div className="h-14 w-8 rounded-sm bg-muted" />
                          )}
                        </TableCell>
                        <TableCell className="max-w-0 min-w-56 whitespace-normal">
                          <StateBadge r={r} />
                          <p className="line-clamp-1 font-medium">
                            {r.video && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Film className="mr-1.5 inline size-3.5 align-[-2px] text-muted-foreground" aria-label={`Hecho aquí: ${r.video.title ?? r.video.slug}`} />
                                </TooltipTrigger>
                                <TooltipContent>Hecho aquí: salió del video «{r.video.title ?? r.video.slug}» de este proyecto</TooltipContent>
                              </Tooltip>
                            )}
                            {r.topic || title(r)}
                          </p>
                          {r.hook && <p className="line-clamp-1 text-xs text-muted-foreground">«{r.hook}»</p>}
                        </TableCell>
                        {cols.shown('ratio') && (
                          <TableCell
                            className={cn('tabular-nums', r.ratio == null ? 'text-muted-foreground' : r.ratio >= 2 ? 'font-medium text-emerald-400' : r.ratio < 0.5 ? 'text-muted-foreground' : '')}
                          >
                            {r.ratio != null ? `${r.ratio.toFixed(1)}×` : '—'}
                          </TableCell>
                        )}
                        {cols.shown('views') && (
                          <TableCell className="tabular-nums">
                            <Value icon={Eye}>{num(r.views)}</Value>
                          </TableCell>
                        )}
                        {cols.shown('likes') && (
                          <TableCell className="text-muted-foreground tabular-nums">
                            <Value icon={Heart}>{num(r.likes)}</Value>
                          </TableCell>
                        )}
                        {cols.shown('comments') && (
                          <TableCell className="text-muted-foreground tabular-nums">
                            <Value icon={MessageCircle}>{num(r.comments)}</Value>
                          </TableCell>
                        )}
                        {cols.shown('saves') && (
                          <TableCell className="tabular-nums">
                            <Value icon={Bookmark}>{num(r.saves)}</Value>
                          </TableCell>
                        )}
                        {cols.shown('shares') && (
                          <TableCell className="text-muted-foreground tabular-nums">
                            <Value icon={Send}>{num(r.shares)}</Value>
                          </TableCell>
                        )}
                        {cols.shown('reach') && <TableCell className="text-muted-foreground tabular-nums">{num(r.reach)}</TableCell>}
                        {cols.shown('engagement') && <TableCell className="text-muted-foreground tabular-nums">{pct(r.engagement)}</TableCell>}
                        {cols.shown('retention') && (
                          <TableCell className="text-muted-foreground tabular-nums" title={r.avgWatch != null ? `${r.avgWatch.toFixed(1)} s de promedio` : undefined}>
                            {pct(r.retention)}
                          </TableCell>
                        )}
                        {cols.shown('skipRate') && <TableCell className="text-muted-foreground tabular-nums">{r.skipRate != null ? `${r.skipRate.toFixed(0)} %` : '—'}</TableCell>}
                        {cols.shown('duration') && (
                          <TableCell className="text-muted-foreground tabular-nums">
                            <Value icon={Clock}>{r.duration != null ? fmtTime(r.duration) : '—'}</Value>
                          </TableCell>
                        )}
                        {cols.shown('wps') && <TableCell className="text-muted-foreground tabular-nums">{r.wps?.toFixed(1) ?? '—'}</TableCell>}
                        {cols.shown('posted') && <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{date(r.posted)}</TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {pages > 1 && (
                  <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
                    <span className="mr-auto tabular-nums">
                      {pg * PAGE + 1}–{pg * PAGE + rows.length} de {total}
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
                )}
              </div>
            )}
            {total > 0 && pages === 1 && active && (
              <p className="-mt-1 text-xs text-muted-foreground tabular-nums">
                {total === 1 ? '1 reel' : `${total} reels`} de {count}
              </p>
            )}
          </section>
        </>
      )}
      {dialog}
      <ReelDialog code={open} total={count} median={st.median} status={st} onAnalyse={(c, again) => analyseReels({codes: [c]}, 1, again)} onClose={() => setOpenReel(null)} />
    </main>
  );
}

function Stat({label, value, hint}: {label: string; value: string; hint?: string}) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="px-4 text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

function TopCard({r, rank, onOpen}: {r: OwnReel; rank: number; onOpen: () => void}) {
  return (
    <button type="button" onClick={onOpen} className="flex gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent">
      <div className="relative flex-none">
        {r.thumb ? <img src={accountApi.thumb(r.code)} alt="" className="h-28 w-16 rounded-md object-cover" /> : <div className="h-28 w-16 rounded-md bg-muted" />}
        <span className="absolute -top-1.5 -left-1.5 flex size-6 items-center justify-center rounded-full border bg-background text-xs font-semibold">{rank}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="line-clamp-2 text-sm font-medium">{title(r)}</p>
        <p className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums">{num(r.views)}</span>
          <span className="text-xs text-muted-foreground">vistas</span>
          {r.ratio != null && <span className={cn('text-sm font-medium tabular-nums', r.ratio >= 2 ? 'text-emerald-400' : 'text-muted-foreground')}>{r.ratio.toFixed(1)}×</span>}
        </p>
        <p className="mt-auto flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
          <Value icon={Heart}>{num(r.likes)}</Value>
          <Value icon={MessageCircle}>{num(r.comments)}</Value>
          <span>{pct(r.engagement)}</span>
          <span>{date(r.posted)}</span>
        </p>
      </div>
    </button>
  );
}

// A reel's card: its cover, numbers, caption and what the scraper returned, with a link to Instagram and to
// the video it was made from, if it's one of the project's; "Analizar" and, once analysed, the agent's analysis,
// the transcript and the frames. It reads the reel again whenever the account changes (status), so it follows
// the analysis while open.
function ReelDialog({
  code,
  total,
  median,
  status,
  onAnalyse,
  onClose,
}: {
  code: string | null;
  total: number;
  median: number | null;
  status: AccountStatus;
  onAnalyse: (code: string, again: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const {addRef, refs} = useStudio();
  const [card, setCard] = useState<OwnReelCard | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    setCard(null);
    setShowMeta(false);
    setErr('');
  }, [code]);
  useEffect(() => {
    if (code) accountApi.reel(code).then(setCard, onClose);
  }, [code, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async (c: string) => {
    setErr('');
    setRefreshing(true);
    try {
      const e = await accountApi.refreshCost();
      const ok = await confirm({
        title: '¿Actualizar las métricas?',
        description: `Se piden otra vez a ${e.source} las vistas, los likes, los comentarios, los metadatos y el enlace del video de este reel. ${e.charge}.`,
        action: 'Actualizar',
      });
      if (ok) setCard(await accountApi.refresh(c));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const r = card?.reel.code === code ? card.reel : undefined;
  const rank = card?.rank ?? 0;
  const meta = card?.meta ?? null;
  const metaKeys = meta ? Object.keys(meta).sort((x, y) => x.localeCompare(y)) : [];
  const a = card?.analysis ?? null;
  const working = !!r && (r.state === 'queued' || r.state === 'processing' || r.state === 'analyzing');
  const cantTranscribe = !!r && !status.transcriber && !card?.transcript;
  return (
    <Dialog open={!!code} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        {r && card && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{a?.topic || title(r)}</DialogTitle>
              <DialogDescription>
                {r.posted
                  ? new Date(r.posted).toLocaleDateString('es', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })
                  : 'sin fecha'}
                {r.music ? ` · ${r.music}` : ''}
                {rank > 0 ? ` · el ${rank}.º con más vistas de los ${total} cargados` : ''}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              {!a && (
                <Button
                  size="sm"
                  disabled={working || cantTranscribe}
                  onClick={() => void onAnalyse(r.code, false)}
                  title={cantTranscribe ? 'Falta la transcripción: instálala en Ajustes → Requisitos → Transcripción' : 'El agente analiza el gancho, la estructura, los recursos visuales y la llamada a la acción, con sus números'}
                >
                  {working ? <Loader2 className="animate-spin" /> : <Sparkles />}{' '}
                  {r.state === 'analyzing' ? 'Analizando…' : r.state === 'processing' ? 'Transcribiendo…' : r.state === 'queued' ? 'En cola…' : r.state === 'error' ? 'Volver a intentar' : 'Analizar'}
                </Button>
              )}
              <Button
                size="sm"
                variant={a ? 'default' : 'secondary'}
                disabled={refs.some((x) => x.own && x.code === r.code)}
                onClick={() => {
                  addRef({account: status.username ?? '', code: r.code, label: (a?.topic || title(r)).slice(0, 80), own: true});
                  onClose();
                }}
                title="Lo adjunta a tu próximo mensaje en la conversación, para preguntarle al agente lo que quieras de este reel: por qué funcionó o no, cómo mejorarlo, qué hacer después"
              >
                <MessageSquarePlus /> {refs.some((x) => x.own && x.code === r.code) ? 'En tu próximo mensaje' : 'Preguntar sobre este reel'}
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <a href={r.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Ver en Instagram
                </a>
              </Button>
              {r.video && (
                <Button size="sm" variant="outline" asChild title="El video del proyecto del que salió este reel">
                  <a href={`#/reel/${r.video.slug}`} onClick={onClose}>
                    <Film /> {r.video.title ?? r.video.slug}
                  </a>
                </Button>
              )}
              {working && (
                <Button size="sm" variant="secondary" onClick={() => accountApi.stopAnalysis().catch((e: Error) => setErr(e.message))} title="Detiene el análisis en marcha (y lo que esté en cola)">
                  <Square /> Detener
                </Button>
              )}
              {a && (
                <Button size="sm" variant="ghost" disabled={working} onClick={() => void onAnalyse(r.code, true)}>
                  {working ? <Loader2 className="animate-spin" /> : <RefreshCw />} {r.state === 'analyzing' ? 'Analizando…' : 'Volver a analizar'}
                </Button>
              )}
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
              <div className="flex flex-col gap-3">
                {r.thumb ? <img src={accountApi.thumb(r.code)} alt="" className="w-full rounded-md" /> : <div className="aspect-[9/16] w-full rounded-md bg-muted" />}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <Metric icon={Eye} label="Vistas" value={num(r.views)} />
                  <Metric
                    label="Multiplicador"
                    value={r.ratio != null ? `${r.ratio.toFixed(1)}×` : '—'}
                    title={median != null ? `Mediana de los cargados: ${num(median)} vistas` : 'Hace falta tener 5 reels cargados'}
                  />
                  <Metric icon={Heart} label="Likes" value={num(r.likes)} />
                  <Metric icon={MessageCircle} label="Comentarios" value={num(r.comments)} />
                  <Metric label="Interacción" value={pct(r.engagement)} title="(likes + comentarios) ÷ vistas" />
                  <Metric icon={Clock} label="Duración" value={r.duration != null ? fmtTime(r.duration) : '—'} />
                  {card.transcript && <Metric label="Palabras/s" value={card.transcript.wps?.toFixed(1) ?? '—'} />}
                </dl>
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-muted-foreground" title={`Leídas ${fmtAgo(r.metricsAt)}`}>
                    Métricas al{' '}
                    {new Date(r.metricsAt).toLocaleDateString('es', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                  <Button size="sm" variant="secondary" disabled={refreshing || !status.scraper.ready} onClick={() => void refresh(r.code)} title="Lee otra vez sus números y el enlace de su video (cuesta un reel)">
                    {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} {refreshing ? 'Actualizando…' : 'Actualizar métricas'}
                  </Button>
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-5 text-sm">
                {r.state === 'error' && <p className="text-destructive">{r.error}</p>}
                {r.state === 'queued' && <p className="text-muted-foreground">En cola: empieza cuando terminen los que van antes.</p>}
                {r.state === 'processing' && <p className="text-muted-foreground">Descargando el video, transcribiéndolo y sacando sus fotogramas…</p>}
                {r.state === 'analyzing' && <p className="text-muted-foreground">El agente lo está analizando…</p>}
                {a && <AnalysisSections a={a} takeaways="Qué repetir y qué cambiar" />}
                <Section title="Caption">
                  <p className={cn('whitespace-pre-wrap', !r.caption && 'text-muted-foreground', a && 'line-clamp-6 text-muted-foreground')}>{r.caption || 'Sin caption'}</p>
                </Section>
                {card.transcript && <TranscriptSection key={r.code} t={card.transcript} />}
                {metaKeys.length > 0 && (
                  <Section title="Metadatos">
                    {showMeta ? (
                      <dl className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-x-3 gap-y-1">
                        {metaKeys.map((k) => {
                          const v = meta![k];
                          return (
                            <div key={k} className="contents">
                              <dt className="truncate font-mono text-xs leading-5 text-muted-foreground" title={k}>
                                {k}
                              </dt>
                              <dd className="break-words">{Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'sí' : 'no') : typeof v === 'number' ? v.toLocaleString('es') : v}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    ) : (
                      <button type="button" className="self-start text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setShowMeta(true)}>
                        Ver los {metaKeys.length} metadatos guardados
                      </button>
                    )}
                  </Section>
                )}
                <FramesSection key={r.code} files={card.files} url={(f) => accountApi.file(r.code, f)} duration={r.duration} />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Metric({icon, label, value, title}: {icon?: typeof Eye; label: string; value: string; title?: string}) {
  return (
    <>
      <dt className="text-muted-foreground" title={title}>
        {label}
      </dt>
      <dd className="flex items-center justify-end gap-1.5 tabular-nums" title={title}>
        {icon ? <Value icon={icon}>{value}</Value> : value}
      </dd>
    </>
  );
}

function Value({icon: I, children}: {icon: typeof Eye; children: React.ReactNode}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <I className="size-3.5 flex-none text-muted-foreground" />
      {children}
    </span>
  );
}

// Asks for the Instagram account: "@user" or the profile's link.
function SetupDialog({open, current, onOpenChange, onSaved}: {open: boolean; current: string | null; onOpenChange: (o: boolean) => void; onSaved: (s: AccountStatus) => void}) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(current ? `@${current}` : '');
      setErr('');
    }
  }, [open, current]);
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      onSaved(await accountApi.setUsername(value));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tu cuenta de Instagram</DialogTitle>
          <DialogDescription>Escribe tu usuario o pega el enlace de tu perfil. Debe ser una cuenta pública.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input autoFocus placeholder="@usuario" value={value} onChange={(e) => setValue(e.target.value)} />
          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !value.trim()}>
              {busy && <Loader2 className="animate-spin" />} Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
