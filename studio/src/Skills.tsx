import {useEffect, useMemo, useState} from 'react';
import {Marked} from 'marked';
import {StreamLanguage, type StreamParser} from '@codemirror/language';
import {css} from '@codemirror/legacy-modes/mode/css';
import {javascript, json, typescript} from '@codemirror/legacy-modes/mode/javascript';
import {python} from '@codemirror/legacy-modes/mode/python';
import {shell} from '@codemirror/legacy-modes/mode/shell';
import {toml} from '@codemirror/legacy-modes/mode/toml';
import {html as htmlMode, xml} from '@codemirror/legacy-modes/mode/xml';
import {yaml} from '@codemirror/legacy-modes/mode/yaml';
import {classHighlighter, highlightCode} from '@lezer/highlight';
import {BookOpen, ChevronRight, FileCode2, FileText, FolderOpen, Loader2, Puzzle, RefreshCw, Search} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {cn} from '@/lib/utils';
import ListSkeleton from '@/components/common/ListSkeleton';
import {fmtSize, skillsApi, type SkillCategory, type SkillDetail, type SkillDocument, type SkillSummary} from './api';

const CATEGORIES: {id: SkillCategory; label: string; description: string}[] = [
  {id: 'general', label: 'Generales', description: 'Proceso de creación, guion, ideas y recursos.'},
  {id: 'style', label: 'Estilos', description: 'Cómo se construye el aspecto visual de los videos.'},
  {id: 'format', label: 'Formatos', description: 'Cómo se hace y se monta cada tipo de video.'},
];
const categoryName = (id: SkillCategory) => CATEGORIES.find((c) => c.id === id)!.label;
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);
// Code in a skill gets CodeMirror's colours: a fence's language or a file's extension picks the mode.
const MODES: Record<string, StreamParser<unknown>> = {sh: shell, bash: shell, zsh: shell, shell, py: python, python, js: javascript, mjs: javascript, cjs: javascript, jsx: javascript, javascript, ts: typescript, tsx: typescript, typescript, json, yaml, yml: yaml, toml, css, xml, svg: xml, html: htmlMode} as Record<string, StreamParser<unknown>>;
const languages = new Map<string, StreamLanguage<unknown>>();
function colour(code: string, lang: string) {
  const mode = MODES[lang.toLowerCase()];
  if (!mode) return escape(code);
  if (!languages.has(lang)) languages.set(lang, StreamLanguage.define(mode));
  let out = '';
  highlightCode(code, languages.get(lang)!.parser.parse(code), classHighlighter, (text, cls) => { out += cls ? `<span class="${cls}">${escape(text)}</span>` : escape(text); }, () => { out += '\n'; });
  return out;
}
// Skills are local instructions, not HTML. Remote images stay as labels; only web links are opened.
const markdown = new Marked({gfm: true, renderer: {
  html: ({text}) => escape(text),
  code: ({text, lang}) => `<pre><code>${colour(text, (lang ?? '').split(/\s/)[0])}</code></pre>`,
  image: ({text}) => `<span class="text-muted-foreground">[Imagen: ${escape(text)}]</span>`,
  link({href, tokens}) {
    const text = this.parser.parseInline(tokens);
    return /^https?:\/\//i.test(href) ? `<a href="${escape(href)}" target="_blank" rel="noreferrer">${text}</a>` : text;
  },
}});

export function SkillsSection() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SkillSummary | null>(null);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    skillsApi.list().then(
      (all) => { if (current) { setSkills(all); setLoading(false); } },
      (e: Error) => { if (current) { setError(e.message); setLoading(false); } },
    );
    return () => { current = false; };
  }, [revision]);
  const q = query.trim().toLocaleLowerCase();
  const shown = skills?.filter((s) => `${s.name} ${s.description} ${s.path} ${categoryName(s.category)}`.toLocaleLowerCase().includes(q));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar skills…" aria-label="Buscar skills" className="pl-9" />
        </div>
        <Button variant="outline" disabled={loading} onClick={() => setRevision((r) => r + 1)}><RefreshCw className={loading ? 'animate-spin' : ''} /> Actualizar</Button>
      </div>
      <p className="text-xs text-muted-foreground">Consulta sus instrucciones y archivos aquí. Para editarlos, abre su carpeta con tu editor preferido. Se comparten entre los proyectos de esta carpeta de trabajo.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!skills && loading && <div className="flex flex-col gap-3">{[0, 1, 2].map((n) => <Skeleton key={n} className="h-28 w-full rounded-xl" />)}</div>}
      {shown?.length === 0 && <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center"><Puzzle className="size-7 text-muted-foreground" /><p className="font-medium">{skills?.length ? 'No hay skills que coincidan' : 'No hay skills en esta carpeta de trabajo'}</p><p className="text-sm text-muted-foreground">{skills?.length ? 'Prueba con otro nombre o descripción.' : 'Las skills de la app aparecerán aquí cuando estén en tu carpeta de trabajo.'}</p></div>}
      {CATEGORIES.map((category) => {
        const group = shown?.filter((s) => s.category === category.id);
        if (!group?.length) return null;
        return (
          <section key={category.id} className="flex flex-col gap-2" aria-label={category.label}>
            <div className="flex items-center gap-2"><h3 className="text-sm font-medium">{category.label}</h3><Badge variant="secondary">{group.length}</Badge></div>
            <p className="text-xs text-muted-foreground">{category.description}</p>
            <div className="overflow-hidden rounded-xl border bg-card">
              {group.map((skill) => (
                <button key={skill.id} onClick={() => setSelected(skill)} className="group flex w-full items-start gap-3 border-b p-4 text-left transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border bg-muted/40"><BookOpen className="size-4 text-muted-foreground" /></span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="font-medium break-words">{skill.name}</span>
                    {skill.description && <span className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{skill.description}</span>}
                    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="break-all font-mono">{skill.path}</span><span>{skill.fileCount} {skill.fileCount === 1 ? 'archivo' : 'archivos'}</span></span>
                  </span>
                  <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                </button>
              ))}
            </div>
          </section>
        );
      })}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="flex h-[86dvh] max-h-[900px] flex-col overflow-hidden sm:max-w-5xl">
          {selected && <SkillReader key={selected.id} skill={selected} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SkillReader({skill}: {skill: SkillSummary}) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [selected, setSelected] = useState('');
  const [document, setDocument] = useState<SkillDocument | null>(null);
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');
  const [folderError, setFolderError] = useState('');
  const [opening, setOpening] = useState(false);
  const [fileQuery, setFileQuery] = useState('');
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    let current = true;
    skillsApi.detail(skill.id).then(
      (d) => { if (current) { setDetail(d); setSelected(d.entry); } },
      (e: Error) => { if (current) setError(e.message); },
    );
    return () => { current = false; };
  }, [skill.id]);
  useEffect(() => {
    if (!selected) return;
    let current = true;
    setDocument(null);
    setFileError('');
    skillsApi.file(skill.id, selected).then(
      (d) => { if (current) setDocument(d); },
      (e: Error) => { if (current) setFileError(e.message); },
    );
    return () => { current = false; };
  }, [skill.id, selected]);
  const openFolder = async () => {
    setOpening(true);
    setFolderError('');
    try { await skillsApi.reveal(skill.id); }
    catch (e) { setFolderError((e as Error).message); }
    finally { setOpening(false); }
  };
  const isMarkdown = /\.mdx?$/i.test(selected);
  const body = document?.content?.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '') ?? '';
  const html = useMemo(() => document?.content != null && isMarkdown && !raw ? markdown.parse(body, {async: false}) as string : '', [body, isMarkdown, raw, document?.content]);
  return (
    <>
      <DialogHeader className="shrink-0 pr-8">
        <div className="flex flex-wrap items-center gap-2"><DialogTitle className="break-words">{skill.name}</DialogTitle><Badge variant="secondary">{categoryName(skill.category)}</Badge></div>
        <DialogDescription className="break-all font-mono text-xs">{skill.path}</DialogDescription>
      </DialogHeader>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={opening} onClick={() => void openFolder()}>{opening ? <Loader2 className="animate-spin" /> : <FolderOpen />} Abrir carpeta</Button>
        <span className="text-xs text-muted-foreground">Ábrela en el explorador de archivos y edítala con VS Code o tu editor preferido.</span>
      </div>
      {folderError && <p role="alert" className="text-sm text-destructive">{folderError}</p>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !detail ? <ListSkeleton count={4} /> : (
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border sm:grid-cols-[220px_minmax(0,1fr)] sm:grid-rows-1">
          <aside className="flex min-h-0 flex-col border-b bg-muted/20 sm:border-r sm:border-b-0">
            <div className="flex flex-col gap-2 border-b p-3"><p className="text-xs font-medium">Archivos · {detail.files.length}</p><Input value={fileQuery} onChange={(e) => setFileQuery(e.target.value)} aria-label="Buscar archivos de la skill" placeholder="Buscar archivo…" className="h-7 text-xs" /></div>
            <nav aria-label="Archivos de la skill" className="visible-scroll flex max-h-28 flex-col gap-0.5 overflow-auto p-2 sm:max-h-none">
              {detail.files.filter((f) => f.path.toLocaleLowerCase().includes(fileQuery.toLocaleLowerCase())).map((f) => (
                <button key={f.path} onClick={() => { setSelected(f.path); setRaw(false); }} aria-current={selected === f.path ? 'true' : undefined} title={`${f.path} · ${fmtSize(f.size)}`} className={cn('flex shrink-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted', selected === f.path ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground')}>
                  {/\.md$/i.test(f.path) ? <FileText className="mt-0.5 size-3.5 shrink-0" /> : <FileCode2 className="mt-0.5 size-3.5 shrink-0" />}<span className="break-all">{f.path}</span>
                </button>
              ))}
              {!detail.files.some((f) => f.path.toLocaleLowerCase().includes(fileQuery.toLocaleLowerCase())) && <p className="p-2 text-xs text-muted-foreground">Sin archivos que coincidan.</p>}
            </nav>
          </aside>
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex min-h-11 shrink-0 items-center gap-2 border-b px-4 py-2"><span className="min-w-0 flex-1 truncate font-mono text-xs" title={selected}>{selected}</span>{isMarkdown && <Button variant="ghost" size="sm" onClick={() => setRaw((r) => !r)} aria-pressed={raw}>{raw ? 'Vista de lectura' : 'Ver Markdown'}</Button>}</div>
            <div key={selected} className="visible-scroll min-h-0 flex-1 overflow-auto p-5">
              {fileError ? <p role="alert" className="text-sm text-destructive">{fileError}</p> : !document ? <ListSkeleton variant="lines" count={12} /> : document.content === null ? <p className="text-sm text-muted-foreground">{document.note}</p> : isMarkdown && !raw ? <article className="prose prose-sm max-w-none break-words dark:prose-invert prose-headings:scroll-mt-4 prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:whitespace-pre prose-pre:bg-muted prose-pre:text-foreground prose-code:break-words" dangerouslySetInnerHTML={{__html: html}} /> : <pre className="overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre">{document.content ? <code dangerouslySetInnerHTML={{__html: colour(document.content, raw ? '' : selected.split('.').pop() ?? '')}} /> : 'Archivo vacío.'}</pre>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
