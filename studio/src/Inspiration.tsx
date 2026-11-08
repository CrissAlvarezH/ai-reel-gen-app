import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, ArrowDown, ArrowUp, BadgeCheck, ChevronLeft, ChevronRight, Clock, ExternalLink, Eye, Film, Heart, MessageCircle, Loader2, MessageSquarePlus, MoreHorizontal, Plus, RefreshCw, ScanSearch, Search, Sparkles, Square, Trash2, Wand2, X} from 'lucide-react';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {HoverCard, HoverCardContent, HoverCardTrigger} from '@/components/ui/hover-card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';
import {Progress} from '@/components/ui/progress';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {cn} from '@/lib/utils';
import PageSkeleton from '@/components/common/PageSkeleton';
import ListSkeleton from '@/components/common/ListSkeleton';
import CardGridSkeleton from '@/components/common/CardGridSkeleton';
import {fmtAgo, fmtTime, inspirationApi, useSocket, type InspirationAccount, type InspirationJob, type InspirationList, type InspirationReel, type InspirationStatus} from './api';
import type {InspirationRow} from '../shared/types';
import {BEAT_TAGS, MAX_ACCOUNT_REELS, MAX_ANALYSIS_SECONDS} from '../shared/types';
import {md} from './Chat';
import {useConfirm} from './confirm';
import {useStudio} from './studio';
import {useColumns} from './Columns';
import {AnalysisSections, FramesSection, Section, StateBadge, TranscriptSection} from './ReelAnalysis';

// Inspiración: other accounts' reels, to learn what works. Two cards: Agregar video (reel links) and Escanear
// cuenta (@accounts). The studio downloads them with the scraper chosen in Ajustes, Apify or ScrapeCreators (it says what that costs first), transcribes them on
// this machine and deletes the video; the agent analyses a video when asked from its card ("Analizar video"),
// and every reel of a scanned account and the account on its own. A reel's metrics and
// metadata are kept as of their download; "Actualizar métricas" reads them again. "Usar como referencia" attaches a reel to the general conversation.
// Two views: Explorar (the chips and the table) and Destacados (a card per scanned account with its best reels by Multiplicador).
// Routes: #/inspiracion[/todos|/@account|/sueltos|/destacados][/<code>] (the code opens the reel's card).

const LOOSE = 'sueltos';
const ALL = 'todos'; // every reel of every account, from the index
const HIGHLIGHTS = 'destacados'; // the Destacados view
let lastExplore: string | null = null; // Explorar's tab, to go back to it from Destacados

function useInspirationHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [, , tab, code] = hash.replace(/^#/, '').split('/');
  return {tab: tab ? decodeURIComponent(tab) : null, code: code ?? null};
}
const go = (tab: string | null, code?: string | null) => {
  location.hash = `#/inspiracion${tab ? `/${tab}` : ''}${code ? `/${code}` : ''}`;
};

const num = (v: number | null) => (v == null ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.0', '')} M` : v >= 1e4 ? `${Math.round(v / 1e3)} k` : v.toLocaleString('es'));

export function Inspiration() {
  const {uiRef} = useStudio();
  const {tab, code} = useInspirationHash();
  const [st, setSt] = useState<InspirationStatus | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => inspirationApi.status().then(setSt, (e: Error) => setErr(e.message)), []);
  useEffect(() => void load(), [load]);
  useSocket((m) => m.type === 'inspiration' && void load(), load);

  const followed = st?.accounts.filter((a) => a.followed) ?? [];
  const loose = st?.accounts.filter((a) => !a.followed) ?? [];
  const looseCount = loose.reduce((n, a) => n + a.reels, 0);
  // The open tab: the one in the URL, else the first account.
  // A loose reel's link (#/inspiracion/@owner/<code>, from a reference in the chat) opens the loose tab.
  const highlights = tab === HIGHLIGHTS;
  if (!highlights) lastExplore = tab;
  const isLoose = tab === LOOSE || loose.some((a) => `@${a.username}` === tab);
  const total = followed.reduce((n, a) => n + a.reels, 0) + looseCount;
  const current = tab === ALL ? ALL : isLoose ? LOOSE : (followed.find((a) => `@${a.username}` === tab)?.username ?? (tab ? null : (followed[0]?.username ?? (looseCount ? LOOSE : null))));
  // The profiles scroll in one row; keep the open one in view.
  const profilesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    profilesRef.current?.querySelector('[data-active]')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }, [current]);
  uiRef.current = {page: 'inspiration', ...(!highlights && current && current !== LOOSE && current !== ALL ? {inspiration: `@${current}${code ? `/${code}` : ''}`} : {})};

  if (err) return <p className="p-6 text-destructive">{err}</p>;
  if (!st)
    return (
      <PageSkeleton>
        <ListSkeleton variant="table" count={8} announce={false} />
      </PageSkeleton>
    );
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Inspiración</h1>
          <p className="text-sm text-muted-foreground">Reels de otras cuentas: qué funciona, por qué, y qué puedes tomar para los tuyos.</p>
        </div>
        <div className="flex gap-3">
          <AddButton kind="video" disabled={!st.scraper.ready} source={st.scraper.label} />
          <AddButton kind="account" disabled={!st.scraper.ready} source={st.scraper.label} />
        </div>
      </div>

      {!st.scraper.ready && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Falta la clave de {st.scraper.label}</AlertTitle>
          <AlertDescription>
            <p>
              Los reels se descargan con {st.scraper.label}
              {st.scraper.id === 'scrapecreators' ? ', con créditos de prepago que no caducan' : ', que cobra por reel de tu saldo (el plan gratuito trae 5 US$ al mes)'}. Ponla, o elige el otro scraper, en{' '}
              <a href="#/ajustes/datos" className="underline underline-offset-2">
                Ajustes → Extracción de datos
              </a>
              .
            </p>
          </AlertDescription>
        </Alert>
      )}
      {!st.transcriber && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Falta la transcripción</AlertTitle>
          <AlertDescription>
            <p>
              Sin ella se descargan los reels pero no se transcriben ni se analizan. Instálala en{' '}
              <a href="#/ajustes/requisitos" className="underline underline-offset-2">
                Ajustes → Requisitos → Transcripción
              </a>{' '}
              (gratis, funciona sin conexión) y luego pulsa Procesar.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {followed.length > 0 && (
        <Tabs value={highlights ? HIGHLIGHTS : 'explore'} onValueChange={(v) => go(v === HIGHLIGHTS ? HIGHLIGHTS : lastExplore)} className="-mt-2">
          <TabsList>
            <TabsTrigger value="explore">Explorar</TabsTrigger>
            <TabsTrigger value={HIGHLIGHTS}>Destacados</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {highlights ? (
        <Highlights accounts={followed} code={code} transcriber={st.transcriber} />
      ) : (
        <>
      {(followed.length > 0 || looseCount > 0 || st.loose.job || st.loose.error) && (
        <nav className="flex min-w-0 items-start gap-2">
          {total > 0 && (
            <TabChip active={current === ALL} onClick={() => go(ALL)} job={null} error={false}>
              Todos <span className="text-muted-foreground tabular-nums">{total}</span>
            </TabChip>
          )}
          {(looseCount > 0 || st.loose.job || st.loose.error) && (
            <TabChip active={current === LOOSE} onClick={() => go(LOOSE)} job={st.loose.job} error={!!st.loose.error}>
              Reels sueltos <span className="text-muted-foreground tabular-nums">{looseCount}</span>
            </TabChip>
          )}
          {followed.length > 0 && (
            <div ref={profilesRef} className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1.5 [scrollbar-width:thin]">
              {followed.map((a) => (
                <TabChip key={a.username} active={current === a.username} onClick={() => go(`@${a.username}`)} job={a.job} error={!!a.error} className="pl-1">
                  <Avatar account={a} small />
                  @{a.username} <span className="text-muted-foreground tabular-nums">{a.reels}</span>
                </TabChip>
              ))}
            </div>
          )}
        </nav>
      )}

      {current === ALL ? (
        <ReelsView key={ALL} scope={ALL} account={null} code={code} transcriber={st.transcriber} />
      ) : current === LOOSE ? (
        <ReelsView key={LOOSE} scope={LOOSE} account={null} looseAccounts={loose} looseState={st.loose} code={code} transcriber={st.transcriber} />
      ) : current ? (
        <ReelsView key={current} scope={current} account={followed.find((a) => a.username === current)!} code={code} transcriber={st.transcriber} />
      ) : followed.length || looseCount ? (
        <p className="text-sm text-muted-foreground">Esa cuenta ya no está en Inspiración.</p>
      ) : (
        <div className="grid place-items-center gap-2 rounded-xl border border-dashed p-16 text-center text-muted-foreground">
          <Sparkles className="size-6" />
          <p className="text-sm">Añade una cuenta que admires o el enlace de un reel que te haya funcionado como espectador.</p>
        </div>
      )}
        </>
      )}
    </main>
  );
}

function TabChip({active, onClick, job, error, className, children}: {active: boolean; onClick: () => void; job: InspirationJob | null; error: boolean; className?: string; children: React.ReactNode}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      className={cn('flex flex-none items-center gap-1.5 rounded-full border px-3 py-1 text-sm whitespace-nowrap', active ? 'border-foreground bg-accent' : 'text-muted-foreground hover:text-foreground', className)}
    >
      {job ? <Loader2 className="size-3.5 animate-spin" /> : error ? <AlertTriangle className="size-3.5 text-amber-500" /> : null}
      {children}
    </button>
  );
}

/* ───── Destacados ───── */

const TOP = 5; // destacados per account
const OPEN_KEY = 'inspiration-highlights-closed'; // the cards he collapsed, per browser

const readClosed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

// A card per scanned account, best Multiplicador first, with its TOP reels above its median. A reel's click opens its card.
function Highlights({accounts, code, transcriber}: {accounts: InspirationAccount[]; code: string | null; transcriber: boolean}) {
  const [tops, setTops] = useState<Record<string, InspirationRow[]>>({});
  const [closed, setClosed] = useState<string[]>(readClosed);
  const names = accounts.map((a) => a.username).join(' ');
  const load = useCallback(
    () =>
      void Promise.all(
        names
          .split(' ')
          .filter(Boolean)
          .map((u) => inspirationApi.list(u, {sort: 'ratio', desc: true, page: 0, size: TOP, minRatio: '1'}).then((l): [string, InspirationRow[]] => [u, l.rows], (): [string, InspirationRow[]] => [u, []])),
      ).then((e) => setTops(Object.fromEntries(e))),
    [names],
  );
  useEffect(() => load(), [load]);
  useSocket((m) => m.type === 'inspiration' && load(), load);

  const [open, setOpen] = useState<InspirationReel | null>(null);
  const loadOpen = useCallback(() => {
    if (!code) return setOpen(null);
    inspirationApi.reel(code, null).then(setOpen, () => setOpen(null));
  }, [code]);
  useEffect(() => void loadOpen(), [loadOpen]);
  useSocket((m) => m.type === 'inspiration' && void loadOpen(), loadOpen);
  const {uiRef} = useStudio();
  if (open) uiRef.current = {page: 'inspiration', inspiration: `@${open.account}/${open.code}`};

  const toggle = (u: string, isOpen: boolean) => {
    const next = isOpen ? closed.filter((x) => x !== u) : [...new Set([...closed, u])];
    setClosed(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      /* private window: it just won't be remembered */
    }
  };
  const best = (u: string) => tops[u]?.[0]?.ratio ?? 0;
  const sorted = [...accounts].sort((a, b) => best(b.username) - best(a.username));

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Los {TOP} reels de cada cuenta que más superan su mediana de vistas (Multiplicador ≥ 1×). «Analizar» analiza los que falten y rehace el análisis general de la cuenta con ellos.
      </p>
      {sorted.map((a) => (
        <HighlightCard key={a.username} account={a} rows={tops[a.username] ?? null} open={!closed.includes(a.username)} onOpenChange={(o) => toggle(a.username, o)} transcriber={transcriber} />
      ))}
      <ReelDialog r={open ?? undefined} onClose={() => go(HIGHLIGHTS)} />
    </section>
  );
}

function HighlightCard({account: a, rows, open, onOpenChange, transcriber}: {account: InspirationAccount; rows: InspirationRow[] | null; open: boolean; onOpenChange: (o: boolean) => void; transcriber: boolean}) {
  const confirm = useConfirm();
  const [err, setErr] = useState('');
  const {busy, run, loadMore, rescan} = useAccountActions(setErr);
  const job = a.job;
  const inSummary = new Set(a.analysis?.codes ?? []);
  // Missing: not analysed yet, or analysed after the general analysis (older analyses don't list their reels: only the first case).
  const missing = (rows ?? []).filter((r) => r.state !== 'ready' || (a.analysis?.codes && !inSummary.has(r.code)));
  const analysed = (rows ?? []).length - (rows ?? []).filter((r) => r.state !== 'ready').length;
  const analyse = () =>
    run(async () => {
      const toAnalyse = missing.filter((r) => r.state !== 'ready').length;
      const ok = await confirm({
        title: `¿Analizar ${missing.length === 1 ? 'el destacado' : `${missing.length} destacados`} de @${a.username}?`,
        description: `${toAnalyse ? `El agente analiza ${toAnalyse === 1 ? 'el que falta' : `los ${toAnalyse} que faltan`} con tu suscripción` : 'Ya están analizados'}; luego se rehace el análisis general de la cuenta para que entren. No se descarga nada ni se gasta saldo del scraper.`,
        action: 'Analizar',
      });
      if (ok) await inspirationApi.process(a.username, {codes: missing.map((r) => r.code)});
    });
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <Card className="group/hl gap-0 py-0">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <ChevronRight className="size-4 flex-none text-muted-foreground transition-transform group-data-[state=open]/hl:rotate-90" />
            <Avatar account={a} />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-semibold">
                @{a.username}
                {a.profile?.verified && <BadgeCheck className="size-4 text-sky-400" aria-label="Verificada" />}
                {job && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                {a.error && !job && <AlertTriangle className="size-3.5 text-amber-500" />}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {[
                  a.profile?.followers != null ? `${num(a.profile.followers)} seguidores` : null,
                  a.median != null ? `mediana ${num(Math.round(a.median))} vistas` : null,
                  rows?.[0]?.ratio != null ? `mejor ${rows[0].ratio.toFixed(1)}×` : null,
                  rows?.length ? `${analysed} de ${rows.length} analizados` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </CollapsibleTrigger>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={busy || !!job} onClick={() => void rescan(a)} title="Vuelve a escanear la cuenta para actualizar vistas, likes y comentarios">
              <RefreshCw /> Actualizar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" disabled={busy || !!job}>
                  <Plus /> Cargar más
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Reels anteriores a los que tienes</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {[10, 30, 50].map((n) => (
                  <DropdownMenuItem key={n} onSelect={() => void loadMore(a, n)}>
                    {n} más
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !!job || !transcriber || !missing.length}
              onClick={() => void analyse()}
              title={!transcriber ? 'Instala la transcripción en Ajustes → Requisitos' : missing.length ? 'Analiza los destacados que faltan y los suma al análisis general' : 'Todos los destacados ya están en el análisis general'}
            >
              <Sparkles /> {missing.length ? `Analizar ${missing.length}` : 'Analizados'}
            </Button>
          </div>
        </div>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 border-t px-4 py-4">
            {job && <JobLine job={job} onStop={() => inspirationApi.stop(a.username)} />}
            {a.error && !job && <p className="text-sm text-destructive">{a.error}</p>}
            {err && <p className="text-sm text-destructive">{err}</p>}
            {!rows ? (
              <CardGridSkeleton count={5} className="grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" mediaClassName="aspect-[9/16]" progress={false} />
            ) : !rows.length ? (
              <p className="text-sm text-muted-foreground">{a.median == null ? 'Aún no hay mediana: faltan reels para comparar.' : 'Ningún reel supera su mediana todavía.'}</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {rows.map((r, i) => (
                  <button key={r.code} type="button" onClick={() => go(HIGHLIGHTS, r.code)} className="group/reel animate-fade-in flex min-w-0 flex-col gap-1.5 text-left" style={{animationDelay: `${Math.min(i, 12) * 30}ms`, animationFillMode: 'both'}}>
                    <div className="hover-lift relative aspect-[9/16] overflow-hidden rounded-lg bg-muted ring-primary/40 group-hover/reel:ring-2">
                      {r.thumb && <img src={inspirationApi.file(r, 'thumb.jpg')} alt="" loading="lazy" className="size-full object-cover" />}
                      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/85 to-transparent px-2 pt-8 pb-2">
                        <span className="text-lg font-semibold text-emerald-400 tabular-nums">{r.ratio != null ? `${r.ratio.toFixed(1)}×` : '—'}</span>
                        <span className="flex items-center gap-1 text-xs text-white tabular-nums">
                          <Eye className="size-3.5" /> {num(r.views)}
                        </span>
                      </div>
                      <div className="absolute top-2 left-2">
                        <StateBadge r={r} />
                        {r.state === 'ready' && a.analysis?.codes && !inSummary.has(r.code) && (
                          <Badge variant="secondary" title="Analizado después del análisis general">
                            Fuera del análisis
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="line-clamp-2 text-sm font-medium">{r.title}</p>
                    {r.hook && <p className="line-clamp-2 text-xs text-muted-foreground">«{r.hook}»</p>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/* ───── Adding accounts and reels ───── */

const ADD = {
  video: {
    icon: Film,
    title: 'Agregar video',
    description: 'El enlace de un reel de Instagram (o varios, separados por espacios). Se descarga, se transcribe en este equipo y se borra el video; quedan los fotogramas y sus métricas a la fecha. Desde su ficha le pides al agente que lo analice y actualizas las métricas.',
    placeholder: 'https://www.instagram.com/reel/…',
    label: 'Enlaces de reels',
    action: 'Agregar',
  },
  account: {
    icon: ScanSearch,
    title: 'Escanear cuenta',
    description: 'Una cuenta (@usuario o el enlace a su perfil): sus últimos reels, cada uno analizado, y un análisis de la cuenta entera. Luego, desde la cuenta, actualizas sus métricas o cargas reels más antiguos.',
    placeholder: '@cuenta',
    label: 'Cuentas',
    action: 'Escanear',
  },
} as const;

// A tile in the page's header; it opens a dialog that asks for the link (or the account).
function AddButton({kind, disabled, source}: {kind: 'video' | 'account'; disabled: boolean; source: string}) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [limit, setLimit] = useState('30');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const t = ADD[kind];
  const lim = kind === 'account' ? Number(limit) : 1;
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const e = await inspirationApi.estimate(input, lim, kind);
      const what =
        kind === 'account'
          ? `${e.accounts.map((a) => `@${a}`).join(', ')}: hasta ${limit} reels${e.accounts.length > 1 ? ' de cada una' : ''}.`
          : e.urls.length > 1
            ? `${e.urls.length} videos.`
            : '';
      const ok = await confirm({
        title: kind === 'video' ? (e.urls.length === 1 ? '¿Agregar este video?' : `¿Agregar ${e.urls.length} videos?`) : `¿Escanear ${e.accounts.length === 1 ? `@${e.accounts[0]}` : `${e.accounts.length} cuentas`}?`,
        description: `${what ? `${what}\n\n` : ''}${kind === 'account' ? 'También se lee su perfil: foto, seguidores y bio. ' : ''}${e.charge}. ${kind === 'video' ? 'Luego se transcribe en este equipo; el agente lo analiza cuando se lo pidas desde su ficha.' : 'Luego se transcriben en este equipo y el agente analiza cada uno con tu suscripción.'}`,
        action: t.action,
      });
      if (!ok) return;
      const r = await inspirationApi.add(input, lim, kind);
      setInput('');
      setOpen(false);
      if (r.accounts.length) go(`@${r.accounts[0]}`);
      else go(LOOSE);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setErr('');
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? `Falta la clave de ${source} (Ajustes → Extracción de datos)` : undefined}
          className="flex w-36 flex-col items-start gap-2 rounded-xl border bg-card px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          <t.icon className="size-5 text-muted-foreground" />
          {t.title}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <t.icon className="size-4 text-muted-foreground" /> {t.title}
          </DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex gap-2">
            <Input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder={t.placeholder} className="flex-1" aria-label={t.label} spellCheck={false} />
            {kind === 'account' && (
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger className="w-32" aria-label="Reels por cuenta">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['10', '30', '50'].map((n) => (
                    <SelectItem key={n} value={n}>
                      {n} reels
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="submit" disabled={disabled || busy || !input.trim()}>
              {busy && <Loader2 className="animate-spin" />} {t.action}…
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ───── An account (or the loose reels) ───── */

// An account's "Analizar…": its newest reels up to a duration, what's missing, then the account; its data read again
// first only if asked (charged, what an automation's "Actualizar cuenta externa" does), and optionally those already analysed again.
function AnalyzeDialog({account, onClose}: {account: InspirationAccount; onClose: () => void}) {
  const confirm = useConfirm();
  const [limit, setLimit] = useState(Math.min(10, account.reels || 10));
  const [maxSeconds, setMaxSeconds] = useState(MAX_ANALYSIS_SECONDS);
  const [scrape, setScrape] = useState(false);
  const [reanalyse, setReanalyse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const okLimit = Number.isInteger(limit) && limit >= 1 && limit <= MAX_ACCOUNT_REELS;
  const okSeconds = Number.isInteger(maxSeconds) && maxSeconds >= 1 && maxSeconds <= MAX_ANALYSIS_SECONDS;
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      if (scrape) {
        const e = await inspirationApi.estimate(`@${account.username}`, limit, 'account');
        if (!(await confirm({title: `¿Traer los ${limit} reels más recientes de @${account.username}?`, description: `Antes de analizar se leen otra vez del scraper con sus números de hoy, y su perfil. ${e.charge}.`, action: 'Analizar'}))) return;
      }
      await inspirationApi.process(account.username, {limit, maxSeconds, fetch: scrape, reanalyse});
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" /> Analizar @{account.username}
          </DialogTitle>
          <DialogDescription>De sus reels más recientes, los que no pasen de la duración se transcriben y los analiza el agente con tu suscripción. Luego se rehace el análisis general.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-center gap-2">
            <Label htmlFor="analyze-limit" className="flex-1">Reels más recientes</Label>
            <Input id="analyze-limit" type="number" min={1} max={MAX_ACCOUNT_REELS} value={Number.isNaN(limit) ? '' : limit} onChange={(e) => setLimit(e.target.valueAsNumber)} className="w-24" />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="analyze-seconds" className="flex-1">Duración máxima (segundos)</Label>
            <Input id="analyze-seconds" type="number" min={1} max={MAX_ANALYSIS_SECONDS} value={Number.isNaN(maxSeconds) ? '' : maxSeconds} onChange={(e) => setMaxSeconds(e.target.valueAsNumber)} className="w-24" />
          </div>
          {!okSeconds && <p className="-mt-2 text-xs text-destructive">De 1 a {MAX_ANALYSIS_SECONDS} segundos (3 minutos).</p>}
          <div className="flex items-start gap-3">
            <Switch id="analyze-fetch" checked={scrape} onCheckedChange={setScrape} />
            <Label htmlFor="analyze-fetch" className="flex flex-col items-start gap-0.5">
              Actualizar datos primero
              <span className="text-xs font-normal text-muted-foreground">Vistas, likes y perfil de hoy, y reels nuevos si los hay. Gasta saldo. Apagado: solo los que ya tienes aquí.</span>
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <Switch id="analyze-again" checked={reanalyse} onCheckedChange={setReanalyse} />
            <Label htmlFor="analyze-again" className="flex flex-col items-start gap-0.5">
              Volver a analizar los ya analizados
              <span className="text-xs font-normal text-muted-foreground">Apagado: solo los que falten.</span>
            </Label>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy || !okLimit || !okSeconds}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Analizar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STAGE: Record<InspirationJob['stage'], string> = {
  fetching: 'Descargando los reels (suele tardar 1–3 minutos)',
  processing: 'Transcribiendo y sacando fotogramas',
  analyzing: 'El agente analiza cada reel',
  summary: 'El agente analiza la cuenta',
};

// onStop: "Detener" (not while downloading: that is already paid and capped).
function JobLine({job, onStop}: {job: InspirationJob; onStop?: () => Promise<unknown>}) {
  const [stopping, setStopping] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {STAGE[job.stage]}
          {job.total > 1 && ` · ${job.done} de ${job.total}`} · desde {fmtAgo(job.started)}
        </p>
        {onStop && job.stage !== 'fetching' && (
          <Button
            size="sm"
            variant="ghost"
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              setErr('');
              await onStop().catch((e: Error) => setErr(e.message));
              setStopping(false);
            }}
          >
            {stopping ? <Loader2 className="animate-spin" /> : <Square />} Detener
          </Button>
        )}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {job.total > 1 && <Progress value={(job.done / job.total) * 100} className="h-1" />}
    </div>
  );
}

const PAGE = 10; // reels per page of the table

type SortKey = 'posted' | 'views' | 'ratio' | 'likes' | 'comments' | 'duration' | 'wps';

// The table's filters (inspiration-index.ts list); 'any' is no filter (Radix's Select takes no empty value).
type Filters = {q: string; account: string; minRatio: string; sinceDays: string; dur: string; beat: string; cta: string; state: string};
const NO_FILTERS: Filters = {q: '', account: 'any', minRatio: 'any', sinceDays: 'any', dur: 'any', beat: 'any', cta: 'any', state: 'any'};
const FILTERS: {key: Exclude<keyof Filters, 'q' | 'account'>; label: string; options: [string, string][]; ratio?: boolean}[] = [
  {key: 'minRatio', label: 'Multiplicador', ratio: true, options: [['any', 'Cualquiera'], ['1', '≥ 1× su mediana'], ['2', '≥ 2× su mediana'], ['3', '≥ 3× su mediana'], ['5', '≥ 5× su mediana']]},
  {key: 'sinceDays', label: 'Fecha', options: [['any', 'Cualquiera'], ['30', 'Último mes'], ['90', 'Últimos 3 meses'], ['180', 'Últimos 6 meses'], ['365', 'Último año']]},
  {key: 'dur', label: 'Duración', options: [['any', 'Cualquiera'], ['short', 'Menos de 30 s'], ['mid', '30–60 s'], ['long', '60–90 s'], ['xl', '90 s o más']]},
  {key: 'beat', label: 'Estructura', options: [['any', 'Cualquiera'], ...BEAT_TAGS.map((t): [string, string] => [t, `Con ${t}`])]},
  {key: 'cta', label: 'CTA', options: [['any', 'Con o sin CTA'], ['yes', 'Con CTA'], ['no', 'Sin CTA']]},
  {key: 'state', label: 'Estado', options: [['any', 'Cualquiera'], ['ready', 'Analizados'], ['unanalysed', 'Sin analizar'], ['error', 'Con error']]},
];

// An account's Actualizar and Cargar más (and run, for other actions): in its Explorar view and its Destacados card.
function useAccountActions(setErr: (e: string) => void) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // "Cargar más": the scraper brings an account's reels newest first and can't skip any, so this asks for the ones
  // already here plus n; those come back too (and their metrics are refreshed), and they're charged for.
  const loadMore = (a: InspirationAccount, n: number) =>
    run(async () => {
      const limit = a.reels + n;
      const e = await inspirationApi.estimate(`@${a.username}`, limit, 'account');
      const ok = await confirm({
        title: `¿Cargar ${n} reels más de @${a.username}?`,
        description: `${e.source} trae los reels de una cuenta del más nuevo al más viejo y no deja saltarse los primeros: pide los ${a.reels} que ya tienes (de paso se actualizan sus métricas) y hasta ${n} anteriores, ${limit} en total. ${e.charge}. Luego el agente analiza los nuevos y otra vez la cuenta, con tu suscripción.`,
        action: 'Cargar',
      });
      if (ok) await inspirationApi.add(`@${a.username}`, limit, 'account');
    });

  // "Actualizar": scan the account again for as many reels as it has, which refreshes their views, likes and
  // comments (and the metadata and profile), without transcribing or analysing anything. The scraper brings the
  // newest first: reels posted since come in (pending), and that many of the oldest keep their old metrics.
  const rescan = (a: InspirationAccount) =>
    run(async () => {
      const limit = a.reels || 30;
      const e = await inspirationApi.estimate(`@${a.username}`, limit, 'account');
      const ok = await confirm({
        title: `¿Actualizar @${a.username}?`,
        description: `Se vuelve a escanear la cuenta: sus ${limit} reels más recientes, con sus vistas, likes, comentarios y metadatos de hoy, y su perfil (foto, seguidores y bio). No se transcribe ni se analiza nada: los análisis se conservan y, si publicó reels nuevos, quedan pendientes (Procesar, en el menú). ${e.charge}.`,
        action: 'Actualizar',
      });
      if (ok) await inspirationApi.add(`@${a.username}`, limit, 'account', true);
    });

  return {busy, run, loadMore, rescan};
}

// The reels of one account, the loose videos, or every reel ("Todos", scope ALL), from the index: the server
// filters, orders and pages; the card asks for the whole reel.
function ReelsView({
  scope,
  account,
  looseAccounts,
  looseState,
  code,
  transcriber,
}: {
  scope: string; // ALL, LOOSE or the account's username
  account: InspirationAccount | null;
  looseAccounts?: InspirationAccount[];
  looseState?: InspirationStatus['loose'];
  code: string | null;
  transcriber: boolean;
}) {
  const confirm = useConfirm();
  const [data, setData] = useState<InspirationList | null>(null);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState<{key: SortKey; desc: boolean}>({key: account?.median ? 'ratio' : 'posted', desc: true});
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [q, setQ] = useState(''); // the search box; filters.q follows it after a pause
  // Pal/s is off until he turns it on. Multiplicador only exists where there's a median to compare with.
  const cols = useColumns('inspiration', [{key: 'ratio', label: 'Multiplicador'}, {key: 'views', label: 'Vistas'}, {key: 'likes', label: 'Likes'}, {key: 'comments', label: 'Comentarios'}, {key: 'duration', label: 'Duración'}, {key: 'wps', label: 'Palabras por segundo'}, {key: 'posted', label: 'Fecha'}], ['wps']);
  const [page, setPage] = useState(0);
  const user = account?.username ?? null;
  const tab = scope === ALL ? ALL : user ? `@${user}` : LOOSE;
  const apiScope = scope === ALL ? 'all' : scope === LOOSE ? 'loose' : scope;

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === q ? f : {...f, q})), 300);
    return () => clearTimeout(t);
  }, [q]);
  // A new order or filter goes back to the first page.
  useEffect(() => setPage(0), [sort, filters]);

  const query = useMemo(
    () => ({
      ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, v === 'any' ? undefined : v])),
      sort: sort.key,
      desc: sort.desc,
      page,
      size: PAGE,
    }),
    [filters, sort, page],
  );
  const load = useCallback(() => inspirationApi.list(apiScope, query).then(setData, (e: Error) => setErr(e.message)), [apiScope, query]);
  useEffect(() => void load(), [load]);
  useSocket((m) => m.type === 'inspiration' && void load(), load);

  // The open card: the whole reel, asked by its code (and account, when this is an account's tab).
  const [open, setOpen] = useState<InspirationReel | null>(null);
  const loadOpen = useCallback(() => {
    if (!code) return setOpen(null);
    inspirationApi.reel(code, user).then(setOpen, () => setOpen(null));
  }, [code, user]);
  useEffect(() => void loadOpen(), [loadOpen]);
  useSocket((m) => m.type === 'inspiration' && void loadOpen(), loadOpen);
  const {uiRef} = useStudio();
  if (open) uiRef.current = {page: 'inspiration', inspiration: `@${open.account}/${open.code}`};

  const rows = data?.rows ?? null;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pg = Math.min(page, pages - 1);
  useEffect(() => {
    if (page > pg) setPage(pg); // the last page emptied (reels removed)
  }, [page, pg]);
  const active = Object.entries(filters).some(([k, v]) => (k === 'q' ? !!v : v !== 'any'));

  const job = account ? account.job : scope === LOOSE ? (looseState?.job ?? looseAccounts?.find((a) => a.job)?.job ?? null) : null;
  const error = account ? account.error : scope === LOOSE ? (looseState?.error ?? null) : null;
  // "Procesar": what's left to transcribe (and, in a followed account, to analyse; loose videos are analysed
  // one by one, from their card). Counted over the whole tab, not only what the filters show.
  const c = data?.counts ?? {};
  const todo = (c.pending ?? 0) + (c.error ?? 0) + (account ? (c.processed ?? 0) : 0);

  const [analyzing, setAnalyzing] = useState(false);
  const {busy, run, loadMore, rescan} = useAccountActions(setErr);

  // The loose videos belong to several accounts: each one processes what it has pending.
  const processAll = () =>
    run(async () => {
      const owners = user ? [user] : (looseAccounts ?? []).map((a) => a.username);
      // One busy account (409) mustn't keep the others from starting.
      const results = await Promise.allSettled(owners.map((o) => inspirationApi.process(o)));
      const failed = owners.flatMap((o, i) => {
        const r = results[i];
        return r.status === 'rejected' ? [`@${o}: ${(r.reason as Error).message}`] : [];
      });
      if (failed.length) throw new Error(failed.join(' · '));
    });

  const showRatio = scope !== LOOSE;
  return (
    <section className="flex flex-col gap-4">
      {account && (
        <div className="flex flex-wrap items-start gap-3">
          <Avatar account={account} />
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              @{account.username}
              {account.profile?.verified && <BadgeCheck className="size-4 text-sky-400" aria-label="Verificada" />}
              <a href={`https://www.instagram.com/${account.username}/`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Abrir en Instagram">
                <ExternalLink className="size-4" />
              </a>
            </h2>
            <p className="text-sm text-muted-foreground">
              {[account.fullName, account.profile?.followers != null ? `${num(account.profile.followers)} seguidores` : null, `${account.reels} reels`, account.median != null ? `mediana ${num(account.median)} vistas` : null, account.fetched ? `descargada ${fmtAgo(account.fetched)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={busy || !!job} onClick={() => void rescan(account)} title="Vuelve a escanear la cuenta para actualizar vistas, likes y comentarios">
              <RefreshCw /> Actualizar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" disabled={busy || !!job}>
                  <Plus /> Cargar más
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Reels anteriores a los que tienes</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {[10, 30, 50].map((n) => (
                  <DropdownMenuItem key={n} onSelect={() => void loadMore(account, n)}>
                    {n} más
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Más acciones" title="Más acciones">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem disabled={busy || !!job || !transcriber} onSelect={() => setAnalyzing(true)} title={transcriber ? '' : 'Instala la transcripción en Ajustes → Requisitos'}>
                  <Sparkles /> Analizar…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={busy || !!job}
                  onSelect={async () => {
                    if (await confirm({title: `¿Quitar @${account.username}?`, description: 'Se borran sus reels descargados, transcripciones y análisis de inspiration/.', action: 'Quitar', destructive: true}))
                      void run(async () => {
                        await inspirationApi.removeAccount(account.username);
                        go(null);
                      });
                  }}
                >
                  <Trash2 /> Quitar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      {account && analyzing && <AnalyzeDialog account={account} onClose={() => setAnalyzing(false)} />}
      {scope === LOOSE && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-sm text-muted-foreground">Reels que añadiste por su enlace, de cuentas que no sigues aquí. El Multiplicador sale solo en las cuentas añadidas.</p>
          {todo > 0 && (
            <Button variant="secondary" size="sm" disabled={busy || !!job || !transcriber} onClick={processAll}>
              <Wand2 /> Procesar {todo}
            </Button>
          )}
        </div>
      )}
      {scope === ALL && (
        <p className="text-sm text-muted-foreground">
          Todos los reels de Inspiración, de todas las cuentas y los videos sueltos. El «Multiplicador» compara cada uno con lo normal de su cuenta. Para análisis más complejos, pregúntale al agente en la conversación
          general: consulta todos los reels con SQL.
        </p>
      )}

      {job && (
        <JobLine
          job={job}
          onStop={() =>
            account
              ? inspirationApi.stop(account.username)
              : Promise.all((looseAccounts ?? []).filter((x) => x.job && x.job.stage !== 'fetching').map((x) => inspirationApi.stop(x.username)))
          }
        />
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}

      {account?.analysis && (
        <Collapsible key={account.username} asChild>
          <Card className="group/account">
            <CardHeader>
              <CardTitle>
                <CollapsibleTrigger className="flex items-center gap-1.5 hover:text-muted-foreground">
                  <ChevronRight className="size-4 transition-transform group-data-[state=open]/account:rotate-90" />
                  Análisis general
                </CollapsibleTrigger>
              </CardTitle>
              <CardDescription>
                Análisis del agente del {new Date(account.analysis.at).toLocaleString('es', {dateStyle: 'long', timeStyle: 'short'})} ({fmtAgo(account.analysis.at)}), con los {account.analysis.reels} reels analizados entonces. Los que llegaron o se analizaron después no entran.
              </CardDescription>
              {account.analysis.codes && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {account.analysis.codes.map((c) => (
                    <a key={c} href={`#/inspiracion/@${account.username}/${c}`} title={c} className="h-14 w-8 overflow-hidden rounded-sm bg-muted ring-foreground/40 hover:ring-2">
                      <img src={inspirationApi.file({account: account.username, code: c}, 'thumb.jpg')} alt={c} loading="lazy" className="size-full object-cover" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    </a>
                  ))}
                </div>
              )}
            </CardHeader>
            <CollapsibleContent>
              <CardContent>
                <div
                  className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-4 prose-headings:mb-1 prose-headings:text-base prose-p:my-1.5 prose-ul:my-1.5"
                  dangerouslySetInnerHTML={{__html: md(account.analysis.text.replace(/\[([A-Za-z0-9_-]{5,40})\](?!\()/g, (_, c) => `[${c}](#/inspiracion/@${account.username}/${c})`))}}
                />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en captions, transcripciones y análisis…" className="h-8 pl-8" aria-label="Buscar" spellCheck={false} />
        </div>
        {scope === ALL && (data?.accounts.length ?? 0) > 1 && (
          <FilterSelect value={filters.account} onChange={(v) => setFilters((f) => ({...f, account: v}))} label="Cuenta" options={[['any', 'Todas'], ...(data?.accounts ?? []).map((a): [string, string] => [a, `@${a}`])]} />
        )}
        {FILTERS.filter((f) => showRatio || !f.ratio).map((f) => (
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
        <div className="ml-auto">{cols.picker}</div>
      </div>

      {!rows && !err && <ListSkeleton variant="table" count={8} />}
      {rows && total === 0 && !job && <p className="text-sm text-muted-foreground">{active ? 'Ningún reel cumple esos filtros.' : 'Todavía no hay reels.'}</p>}
      {rows && total > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>Reel</TableHead>
                {showRatio && cols.shown('ratio') && (
                  <SortHead k="ratio" sort={sort} setSort={setSort} hover={<RatioHelp />}>
                    Multiplicador
                  </SortHead>
                )}
                {cols.shown('views') && <SortHead k="views" sort={sort} setSort={setSort}>Vistas</SortHead>}
                {cols.shown('likes') && <SortHead k="likes" sort={sort} setSort={setSort}>Likes</SortHead>}
                {cols.shown('comments') && <SortHead k="comments" sort={sort} setSort={setSort}>Coment.</SortHead>}
                {cols.shown('duration') && <SortHead k="duration" sort={sort} setSort={setSort}>Dur.</SortHead>}
                {cols.shown('wps') && <SortHead k="wps" sort={sort} setSort={setSort} title="Palabras por segundo de la voz">Pal/s</SortHead>}
                {cols.shown('posted') && <SortHead k="posted" sort={sort} setSort={setSort}>Fecha</SortHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.account}/${r.code}`} className="cursor-pointer" onClick={() => go(tab, r.code)}>
                  <TableCell className="w-12 min-w-12 py-1.5">
                    {r.thumb ? <img src={inspirationApi.file(r, 'thumb.jpg')} alt="" loading="lazy" className="h-14 w-8 max-w-none min-w-8 rounded-sm object-cover" /> : <div className="h-14 w-8 rounded-sm bg-muted" />}
                  </TableCell>
                  <TableCell className="max-w-0 min-w-56 whitespace-normal">
                    <div className="flex items-center gap-1.5">
                      {!account && <span className="text-xs text-muted-foreground">@{r.account}</span>}
                      <StateBadge r={r} />
                    </div>
                    <p className="line-clamp-1 font-medium">{r.title}</p>
                    {r.hook && <p className="line-clamp-1 text-xs text-muted-foreground">«{r.hook}»</p>}
                  </TableCell>
                  {showRatio && cols.shown('ratio') && (
                    <TableCell className={cn('tabular-nums', r.ratio == null ? 'text-muted-foreground' : r.ratio >= 2 ? 'font-medium text-emerald-400' : r.ratio < 0.5 ? 'text-muted-foreground' : '')}>
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
                  {cols.shown('duration') && (
                    <TableCell className="text-muted-foreground tabular-nums">
                      <Value icon={Clock}>{r.duration != null ? fmtTime(r.duration) : '—'}</Value>
                    </TableCell>
                  )}
                  {cols.shown('wps') && <TableCell className="text-muted-foreground tabular-nums">{r.wps?.toFixed(1) ?? '—'}</TableCell>}
                  {cols.shown('posted') && <TableCell className="text-muted-foreground tabular-nums">{r.posted ? new Date(r.posted).toLocaleDateString('es', {day: 'numeric', month: 'short', year: '2-digit'}) : '—'}</TableCell>}
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
      {rows && total > 0 && pages === 1 && <p className="-mt-2 text-xs text-muted-foreground tabular-nums">{total === 1 ? '1 reel' : `${total} reels`}</p>}

      <ReelDialog r={open ?? undefined} onClose={() => go(tab)} />
    </section>
  );
}

// The account's profile picture (avatar.jpg, read when it's scanned or updated), or its initial. small: in
// its tab.
export function Avatar({account, small}: {account: Pick<InspirationAccount, 'username' | 'avatar' | 'profile'>; small?: boolean}) {
  const [broken, setBroken] = useState(false);
  const size = small ? 'size-5' : 'size-12 border';
  if (account.avatar && !broken)
    return <img src={`/inspiration-files/${account.username}/avatar.jpg?v=${account.profile?.at ?? 0}`} alt="" onError={() => setBroken(true)} className={cn(size, 'flex-none rounded-full object-cover')} />;
  return <div className={cn(size, 'grid flex-none place-items-center rounded-full bg-muted font-medium text-muted-foreground uppercase', small ? 'text-[10px]' : 'text-lg')}>{account.username[0]}</div>;
}

export function FilterSelect({value, onChange, label, options}: {value: string; onChange: (v: string) => void; label: string; options: [string, string][]}) {
  return (
    // Off: the trigger shows the filter's name (the placeholder); on: the chosen value, highlighted.
    <Select value={value === 'any' ? '' : value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={label} className={cn('w-auto', value !== 'any' && 'border-foreground/60 bg-accent text-foreground')}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// What the Multiplicador column means, on hover over its header.
// mine: in Mi cuenta, where the median is that of the loaded reels of his own account.
export function RatioHelp({mine}: {mine?: boolean}) {
  return (
    <div className="space-y-2 font-normal">
      <p className="font-medium">Rendimiento del video</p>
      <p className="text-muted-foreground">
        {mine
          ? 'Cuántas veces sus vistas superan lo normal en tu cuenta: las vistas del video divididas entre la mediana de vistas de tus reels cargados.'
          : 'Cuántas veces sus vistas superan lo normal de su cuenta: las vistas del video divididas entre la mediana de vistas de esa cuenta.'}
      </p>
      <p className="text-muted-foreground">1× es un video normal para la cuenta; 3× le fue tres veces mejor de lo habitual; 0,5× le fue a la mitad.</p>
    </div>
  );
}

export function SortHead<K extends string = SortKey>({k, sort, setSort, className, title, hover, children}: {k: K; sort: {key: K; desc: boolean}; setSort: (s: {key: K; desc: boolean}) => void; className?: string; title?: string; hover?: React.ReactNode; children: React.ReactNode}) {
  const on = sort.key === k;
  const button = (
    <button type="button" className={cn('flex items-center gap-1 hover:text-foreground', on && 'text-foreground')} onClick={() => setSort({key: k, desc: on ? !sort.desc : true})}>
      {children}
      {on && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
    </button>
  );
  return (
    <TableHead className={className} title={title}>
      {hover ? (
        <HoverCard>
          <HoverCardTrigger asChild>{button}</HoverCardTrigger>
          <HoverCardContent align="start" className="w-72">
            {hover}
          </HoverCardContent>
        </HoverCard>
      ) : (
        button
      )}
    </TableHead>
  );
}

/* ───── A reel's card ───── */

function ReelDialog({r, onClose}: {r: InspirationReel | undefined; onClose: () => void}) {
  const {addRef, refs} = useStudio();
  const confirm = useConfirm();
  const [err, setErr] = useState('');
  const [showMeta, setShowMeta] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    setErr('');
    setShowMeta(false);
  }, [r?.code]);
  const refresh = async (x: InspirationReel) => {
    setErr('');
    setRefreshing(true);
    try {
      const e = await inspirationApi.estimate(x.url, 1, 'video');
      const ok = await confirm({
        title: '¿Actualizar las métricas?',
        description: `Se piden otra vez a ${e.source} las vistas, los likes, los comentarios y el resto de metadatos de este reel. ${e.charge}. No se vuelve a descargar ni a analizar el video.`,
        action: 'Actualizar',
      });
      if (ok) await inspirationApi.refresh(x);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const [starting, setStarting] = useState(false);
  const analyse = async (x: InspirationReel) => {
    if (x.analysis && !(await confirm({title: '¿Volver a analizar este reel?', description: 'El agente lo analiza otra vez con tu suscripción y el análisis nuevo reemplaza al de ahora. No se descarga nada ni se gasta saldo del scraper.', action: 'Analizar'})))
      return;
    setErr('');
    setStarting(true);
    try {
      await inspirationApi.analyse(x);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStarting(false);
    }
  };
  const working = !!r && (r.state === 'processing' || r.state === 'analyzing');
  const metaKeys = r?.meta ? Object.keys(r.meta).sort((x, y) => x.localeCompare(y)) : [];
  const attached = !!r && refs.some((x) => x.account === r.account && x.code === r.code);
  const a = r?.analysis;
  return (
    <Dialog open={!!r} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        {r && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{a?.topic || r.caption.split('\n')[0] || r.code}</DialogTitle>
              <DialogDescription>
                @{r.account} · {r.posted ? new Date(r.posted).toLocaleDateString('es', {day: 'numeric', month: 'long', year: 'numeric'}) : 'sin fecha'}
                {r.music ? ` · ${r.music}` : ''}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap gap-2">
              {!a && (
                <Button size="sm" disabled={starting || working} onClick={() => void analyse(r)} title="El agente analiza el gancho, la estructura, los recursos visuales y la llamada a la acción">
                  {starting || working ? <Loader2 className="animate-spin" /> : <Sparkles />} {r.state === 'analyzing' ? 'Analizando…' : r.state === 'processing' ? 'Transcribiendo…' : 'Analizar video'}
                </Button>
              )}
              <Button
                size="sm"
                variant={a ? 'default' : 'secondary'}
                disabled={attached}
                onClick={() => {
                  addRef({account: r.account, code: r.code, label: (a?.topic || r.caption.split('\n')[0] || r.code).slice(0, 80)});
                  onClose();
                }}
                title="Añádelo a tu próximo mensaje de la conversación general"
              >
                <MessageSquarePlus /> {attached ? 'En tu próximo mensaje' : 'Usar como referencia'}
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <a href={r.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Ver en Instagram
                </a>
              </Button>
              {working && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => inspirationApi.stop(r.account).catch((e: Error) => setErr(e.message))}
                  title={r.state === 'processing' ? 'Deja de transcribir; se borra lo que había descargado del video' : 'El agente deja de analizarlo'}
                >
                  <Square /> Detener
                </Button>
              )}
              {a && (
                <Button size="sm" variant="ghost" disabled={starting || working} onClick={() => void analyse(r)}>
                  {starting || working ? <Loader2 className="animate-spin" /> : <RefreshCw />} {r.state === 'analyzing' ? 'Analizando…' : 'Volver a analizar'}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={async () => {
                  if (!(await confirm({title: '¿Quitar este reel?', description: 'Se borran su portada, fotogramas, transcripción y análisis.', action: 'Quitar', destructive: true}))) return;
                  try {
                    await inspirationApi.removeReel(r.account, r.code);
                    onClose();
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
              >
                <Trash2 /> Quitar
              </Button>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}

            <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
              <div className="flex flex-col gap-3">
                {r.files.thumb && <img src={inspirationApi.file(r, 'thumb.jpg')} alt="" className="w-full rounded-md" />}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <Stat icon={Eye} label="Vistas" value={num(r.views)} />
                  {r.ratio != null && <Stat label="Multiplicador" value={`${r.ratio.toFixed(1)}×`} />}
                  <Stat icon={Heart} label="Likes" value={num(r.likes)} />
                  <Stat icon={MessageCircle} label="Comentarios" value={num(r.comments)} />
                  <Stat icon={Clock} label="Duración" value={r.duration != null ? fmtTime(r.duration) : '—'} />
                  <Stat label="Palabras/s" value={r.transcript?.wps?.toFixed(1) ?? '—'} />
                </dl>
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-muted-foreground" title={`Leídas ${fmtAgo(r.metricsAt)}`}>
                    Métricas al {new Date(r.metricsAt).toLocaleDateString('es', {day: 'numeric', month: 'short', year: 'numeric'})}
                  </p>
                  <Button size="sm" variant="secondary" disabled={refreshing || r.refreshing} onClick={() => void refresh(r)}>
                    {refreshing || r.refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} {r.refreshing ? 'Actualizando…' : 'Actualizar métricas'}
                  </Button>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-5 text-sm">
                {r.state === 'error' && <p className="text-destructive">{r.error}</p>}
                {(r.state === 'pending' || r.state === 'processing') && <p className="text-muted-foreground">{r.state === 'pending' ? 'Pendiente de transcribir (Procesar, o Analizar video, que lo transcribe primero).' : 'Transcribiendo y sacando fotogramas…'}</p>}
                {r.state === 'processed' && <p className="text-muted-foreground">Transcrito y con sus fotogramas. Pulsa Analizar video para que el agente lo analice.</p>}
                {r.state === 'analyzing' && <p className="text-muted-foreground">El agente lo está analizando…</p>}
                {a && <AnalysisSections a={a} takeaways="Qué tomar" />}
                {r.caption && (
                  <Section title="Caption">
                    <p className="line-clamp-6 whitespace-pre-wrap text-muted-foreground">{r.caption}</p>
                  </Section>
                )}
                {r.transcript && <TranscriptSection key={r.code} t={r.transcript} />}
                {metaKeys.length > 0 && (
                  <Section title="Metadatos">
                    {showMeta ? (
                      <dl className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-x-3 gap-y-1">
                        {metaKeys.map((k) => {
                          const v = r.meta![k];
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
                <FramesSection key={r.code} files={r.files} url={(f) => inspirationApi.file(r, f)} duration={r.duration} />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Icon = React.ComponentType<{className?: string}>;

function Stat({icon, label, value}: {icon?: Icon; label: string; value: string}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center justify-end gap-1.5 tabular-nums">{icon ? <Value icon={icon}>{value}</Value> : value}</dd>
    </>
  );
}

// A metric with its icon to the left (views, likes, comments, duration).
function Value({icon: I, children}: {icon: Icon; children: React.ReactNode}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <I className="size-3.5 flex-none text-muted-foreground" />
      {children}
    </span>
  );
}
