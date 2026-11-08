import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import ResizeHandle from '@/components/common/ResizeHandle';
import {marked} from 'marked';
import {ArrowUp, Check, History, ImagePlus, Lightbulb, Loader2, PanelRightClose, PanelRightOpen, Plus, Square, Target, Wrench, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import ListSkeleton from '@/components/common/ListSkeleton';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {accountApi, chatApi, fmtAgo, fmtTime, inspirationApi, useAgentId, useAgentName, useSocket, type ChatItem, type ChatList, type ChatMeta, type ChatState, type IdeaRef, type InspirationRef} from './api';
import {AgentLogo} from './AgentLogo';
import {useStudio} from './studio';
import {CommandMenu, ContextRing, ModePicker, ModelPicker, matchCommands, refreshChatOptions, useChatOptions} from './ChatControls';

// Claude's markdown, with raw HTML shown as text rather than rendered.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);
marked.use({renderer: {html: ({text}) => esc(text)}, gfm: true, breaks: true});
// A wide table scrolls sideways on its own instead of the whole chat (raw HTML is escaped, so every <table> is marked's).
export const md = (s: string) =>
  (marked.parse(s, {async: false}) as string).replace(/<table>/g, '<div class="max-w-full overflow-x-auto"><table>').replace(/<\/table>/g, '</table></div>');

const GENERAL = '_general';

function Elapsed({since}: {since: number}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{fmtTime((Date.now() - since) / 1000)}</>;
}

const Unread = () => <span className="size-2 flex-none rounded-full bg-red-500" />;

// The agent asking before it acts. The turn waits here until it's answered.
function PermissionCard({item, onAnswer}: {item: Extract<ChatItem, {role: 'permission'}>; onAnswer: (allow: boolean) => Promise<unknown>}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const answer = async (allow: boolean) => {
    setBusy(true);
    setErr('');
    try {
      await onAnswer(allow);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const pending = item.state === 'pending';
  const plan = item.name === 'ExitPlanMode';
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border p-3 text-xs', pending ? 'border-amber-400/60' : 'text-muted-foreground')}>
      <p>
        <span className="font-medium text-foreground">{plan ? 'Plan para aprobar' : item.name}</span>
        {!plan && item.summary && <span className="break-words text-muted-foreground"> · {item.summary}</span>}
      </p>
      {pending && item.detail && <pre className="max-h-60 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{item.detail}</pre>}
      {pending ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => answer(true)}>
            {plan ? 'Aprobar' : 'Permitir'}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => answer(false)}>
            Rechazar
          </Button>
        </div>
      ) : (
        <p>{item.state === 'allowed' ? 'Permitido' : item.state === 'denied' ? 'Rechazado' : 'Ya no está activa'}</p>
      )}
      {err && <p className="text-destructive">{err}</p>}
    </div>
  );
}

function Item({item, slug, onSeek, onPermission}: {item: ChatItem; slug: string | null; onSeek: (t: number) => void; onPermission: (item: string, allow: boolean) => Promise<unknown>}) {
  const [open, setOpen] = useState(false);
  switch (item.role) {
    case 'user':
      return (
        <div className="ml-auto flex max-w-[88%] flex-col gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          {item.comments.length > 0 && (
            <ul className="flex flex-col gap-2">
              {item.comments.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  <button className="rounded bg-primary-foreground/15 px-1.5 text-xs tabular-nums" onClick={() => onSeek(c.t)}>
                    {fmtTime(c.t)}
                  </button>
                  {c.frame && slug && <img src={`/files/${slug}/${c.frame}`} alt="" className="h-16 w-auto rounded" />}
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          )}
          {item.refs && item.refs.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {item.refs.map((r) => (
                <li key={`${r.account}/${r.code}`}>
                  <RefChip r={r} className="bg-primary-foreground/15" />
                </li>
              ))}
            </ul>
          )}
          {item.ideas && item.ideas.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {item.ideas.map((i) => (
                <li key={i.id}>
                  <IdeaChip idea={i} className="bg-primary-foreground/15" />
                </li>
              ))}
            </ul>
          )}
          {item.images && item.images.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {item.images.map((n) => (
                <li key={n}>
                  <a href={chatApi.imageUrl(n)} target="_blank" rel="noreferrer" title="Abrir la imagen">
                    <img src={chatApi.imageUrl(n)} alt="" className="h-24 max-w-40 rounded-md object-cover" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {item.text && <p className="whitespace-pre-wrap">{item.text}</p>}
        </div>
      );
    case 'assistant':
      return (
        <div
          className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:bg-muted prose-code:before:content-none prose-code:after:content-none prose-img:my-2 prose-img:inline-block prose-img:max-h-72 prose-img:max-w-full prose-img:cursor-zoom-in prose-img:rounded-md"
          dangerouslySetInnerHTML={{__html: md(item.text)}}
          // An image the agent showed opens in full in a new tab.
          onClick={(e) => {
            const img = e.target instanceof HTMLImageElement ? e.target : null;
            if (img) window.open(img.src, '_blank', 'noreferrer');
          }}
        />
      );
    case 'tool':
      return (
        <div className={cn('border-l-2 pl-2 text-xs', item.isError ? 'border-destructive' : item.done ? 'border-border' : 'border-amber-400')}>
          <button className="flex w-full min-w-0 items-center gap-1.5 text-left text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground" onClick={() => setOpen(!open)} disabled={!item.result}>
            <Wrench className="size-3 flex-none" />
            <span className="font-medium text-foreground">{item.name}</span>
            <span className="truncate">{item.summary}</span>
          </button>
          {open && item.result && <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{item.result}</pre>}
        </div>
      );
    case 'permission':
      return <PermissionCard item={item} onAnswer={(allow) => onPermission(item.id, allow)} />;
    case 'status':
      // Older transcripts saved a "Listo · 0:04" line after every reply; don't show it.
      if (!item.error && item.text.startsWith('Listo')) return null;
      return <div className={cn('text-xs whitespace-pre-wrap', item.error ? 'text-destructive' : 'text-center text-muted-foreground')}>{item.text}</div>;
  }
}

// A reel from Inspiración attached to a message: its cover and account; opens its card on that page.
function RefChip({r, className}: {r: InspirationRef; className?: string}) {
  return (
    <a href={r.own ? '#/cuenta' : `#/inspiracion/@${r.account}/${r.code}`} title={r.label} className={cn('flex max-w-56 items-center gap-1.5 rounded-md py-0.5 pr-2 pl-0.5 text-xs', className)}>
      <img src={r.own ? accountApi.thumb(r.code) : inspirationApi.file(r, 'thumb.jpg')} alt="" className="h-7 w-5 flex-none rounded-sm bg-muted object-cover" />
      <span className="truncate">
        {r.own ? 'Tu reel' : `@${r.account}`} · {r.label}
      </span>
    </a>
  );
}

// An idea from Ideas de contenido attached to a message; goes to that page.
function IdeaChip({idea, className}: {idea: IdeaRef; className?: string}) {
  return (
    <a href="#/ideas" title={idea.title} className={cn('flex max-w-56 items-center gap-1.5 rounded-md py-1 pr-2 pl-1.5 text-xs', className)}>
      <Lightbulb className="size-3.5 flex-none" />
      <span className="truncate">{idea.title}</span>
    </a>
  );
}

// What you were typing in each conversation, kept while you switch tabs.
const drafts = new Map<string, string>();

// An image pasted or dropped into the message box: shown at once (url, the local file), uploaded meanwhile
// (name, once saved; error if it failed).
type Pending = {key: string; url: string; name?: string; error?: string};
const MAX_IMAGES = 10;
const isImage = (f: File) => /^image\/(png|jpeg|webp|gif)$/.test(f.type);

// One conversation (a tab of a reel's, or of the library's general ones). Stays mounted while the panel
// is collapsed, so it keeps streaming.
function Conversation({chatKey, chatId, slug, visible, onNew}: {chatKey: string; chatId: string; slug: string | null; visible: boolean; onNew: () => void}) {
  const studio = useStudio();
  const comments = slug ? (studio.comments[slug] ?? []) : [];
  const refs = slug ? [] : studio.refs;
  const ideaRefs = slug ? [] : studio.ideaRefs;
  // The reel's script reviews attached with "Agregar al chat" (its conversation only): audience and/or hook.
  const auditKinds = slug ? (['audience', 'hook'] as const).filter((k) => studio.audits.includes(`${k}/${slug}`)) : [];
  const audit = auditKinds.length > 0;
  const [st, setSt] = useState<ChatState | null>(null);
  // Only asked for while they'd show: writing them spends a little of his plan.
  const [examples, setExamples] = useState<string[]>([]);
  const empty = !slug && st?.items.length === 0;
  useEffect(() => {
    if (!empty) return;
    let current = true;
    chatApi.examples().then(
      (list) => current && setExamples(list),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [empty]);
  const draftKey = `${chatKey}/${chatId}`;
  const [text, setTextState] = useState(() => drafts.get(draftKey) ?? '');
  const setText = (t: string) => {
    drafts.set(draftKey, t);
    setTextState(t);
  };
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const [images, setImages] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const uploading = images.some((i) => !i.name && !i.error);
  const ready = images.filter((i) => i.name).map((i) => i.name!);
  // Paste or drop: each image is uploaded right away; anything else is left out, saying so.
  const addImages = (files: File[]) => {
    const ok = files.filter(isImage).slice(0, Math.max(0, MAX_IMAGES - images.length));
    if (files.length > ok.length) setErr(files.some((f) => !isImage(f)) ? 'Solo imágenes PNG, JPG, WebP o GIF' : `Como mucho ${MAX_IMAGES} imágenes por mensaje`);
    for (const f of ok) {
      const key = Math.random().toString(36).slice(2);
      setImages((xs) => [...xs, {key, url: URL.createObjectURL(f)}]);
      chatApi.uploadImage(f).then(
        ({name}) => setImages((xs) => xs.map((x) => (x.key === key ? {...x, name} : x))),
        (e: Error) => setImages((xs) => xs.map((x) => (x.key === key ? {...x, error: e.message} : x))),
      );
    }
    input.current?.focus();
  };
  const removeImage = (key: string) =>
    setImages((xs) => {
      const x = xs.find((i) => i.key === key);
      if (x) URL.revokeObjectURL(x.url);
      return xs.filter((i) => i.key !== key);
    });
  const agent = useAgentName();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  // An example of the empty conversation goes into the box, not to the agent, with the cursor after it.
  const pickExample = (t: string) => {
    setText(t);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(t.length, t.length);
    });
  };
  const picker = useRef<HTMLInputElement>(null);
  const options = useChatOptions();
  const [pickerOpen, setPickerOpen] = useState(false);
  // The slash-command list: open while the text is "/…" with no space, until Esc.
  const [cmdIndex, setCmdIndex] = useState(0);
  const [cmdDismissed, setCmdDismissed] = useState(false);
  const cmdItems = cmdDismissed || !options ? [] : matchCommands(options.commands, text);
  useEffect(() => setCmdIndex(0), [text]);
  useEffect(() => {
    if (!text.startsWith('/')) setCmdDismissed(false);
  }, [text]);

  const load = useCallback(() => chatApi.state(chatKey, chatId).then(setSt, (e) => setErr(e.message)), [chatKey, chatId]);
  useEffect(() => void load(), [load]);

  useSocket((msg) => {
    if (msg.type !== 'chat' || msg.slug !== chatKey || msg.chat !== chatId) return;
    setSt((s) => {
      if (!s) return s;
      switch (msg.op) {
        case 'append':
          return {...s, items: [...s.items, msg.item], live: msg.item.role === 'assistant' ? '' : s.live};
        case 'patch':
          return {...s, items: s.items.map((i) => (i.id === msg.item.id ? msg.item : i))};
        case 'delta':
          return {...s, live: s.live + msg.text};
        case 'tool':
          return {...s, tool: msg.tool};
        case 'state':
          if (!msg.running) void refreshChatOptions(); // the CLI may have listed new commands
          return {...s, running: msg.running, started: msg.started ?? s.started, live: msg.running ? s.live : '', tool: msg.running ? s.tool : null};
        case 'session':
          return {...s, sessionId: msg.sessionId, resume: msg.resume};
        case 'context':
          return {...s, context: msg.context};
        case 'options':
          return {...s, model: msg.model, effort: msg.effort};
        case 'mode':
          return {...s, mode: msg.mode};
      }
      return s;
    });
  }, load);

  useEffect(() => {
    if (visible) input.current?.focus({preventScroll: true});
  }, [visible]);
  // Tell the server Cristian has seen this conversation (drives "para revisar" in the sidebar).
  const lastTs = st?.items.at(-1)?.ts ?? 0;
  useEffect(() => {
    if (!visible || !lastTs) return;
    const t = setTimeout(() => chatApi.seen(chatKey, chatId).catch(() => {}), 600);
    return () => clearTimeout(t);
  }, [visible, lastTs, chatKey, chatId]);

  // Follow the bottom while the user hasn't scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [st, visible]);
  const onScroll = () => {
    const el = scroller.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const setMode = (mode: string) =>
    chatApi.setMode(chatKey, chatId, mode).then(
      (r) => setSt((s) => s && {...s, ...r}),
      (e) => setErr((e as Error).message),
    );
  const setOptions = (o: {model?: string; effort?: string}) =>
    chatApi.setOptions(chatKey, chatId, o).then(
      (r) => setSt((s) => s && {...s, ...r}),
      (e) => setErr((e as Error).message),
    );

  // The studio's own commands: /clear, /model, /effort. True when msg was one of them.
  const studioCommand = (msg: string) => {
    const m = msg.trim().match(/^\/(clear|nueva|new|model|effort)(?:\s+(.*))?$/i);
    if (!m) return false;
    const [cmd, arg] = [m[1].toLowerCase(), m[2]?.trim()];
    setErr('');
    setText('');
    if (cmd === 'model' || cmd === 'effort') {
      if (arg) void setOptions(cmd === 'model' ? {model: arg} : {effort: arg});
      else setPickerOpen(true);
    } else onNew();
    return true;
  };

  const send = async (msg: string) => {
    if (!comments.length && !refs.length && !ideaRefs.length && !images.length && !audit && studioCommand(msg)) return;
    if ((!msg.trim() && !comments.length && !refs.length && !ideaRefs.length && !ready.length && !audit) || st?.running || uploading) return;
    setSending(true);
    setErr('');
    stick.current = true;
    try {
      await chatApi.send(chatKey, chatId, audit && !msg.trim() ? (auditKinds.length > 1 ? 'Aplica estos análisis al guion.' : auditKinds[0] === 'hook' ? 'Aplica este análisis del gancho al guion.' : 'Aplica este análisis de audiencia al guion.') : msg, comments, {...studio.uiRef.current}, refs.length ? refs : undefined, ready.length ? ready : undefined, ideaRefs.length ? ideaRefs : undefined, audit ? [...auditKinds] : undefined);
      setText('');
      for (const i of images) URL.revokeObjectURL(i.url);
      setImages([]);
      if (slug) {
        studio.clearComments(slug);
        studio.removeAudit(slug);
      } else {
        studio.clearRefs();
        studio.clearIdeaRefs();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  return (
    <div
      className={cn('relative flex min-h-0 flex-1 flex-col', !visible && 'hidden')}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        addImages([...e.dataTransfer.files]);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-foreground/40 bg-background/80 text-sm text-muted-foreground backdrop-blur-sm">
          <ImagePlus className="size-6" />
          Suelta las imágenes para enviárselas a {agent}
        </div>
      )}
      <div ref={scroller} onScroll={onScroll} className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
        {!st && <ListSkeleton count={3} />}
        {st && st.items.length === 0 && (
          <div className="flex flex-col gap-3 text-sm">
            <p className="font-medium">{slug ? 'Pídeme lo que quieras sobre este video.' : 'Conversación general: ideas, guiones o un video nuevo.'}</p>
            <ul className="flex flex-col gap-2">
              {(slug
                ? [
                    {text: 'Revisa el guion y dime qué cortarías para que dure 45 s'},
                    {text: 'Regenera la voz con el guion nuevo y re-timea'},
                    {text: '¿Qué cambiarías en este momento?', note: 'Sabe la versión y el segundo que estás viendo'},
                  ]
                : [
                    {text: examples[0] ?? 'Dame 10 ideas de reels para mi público'},
                    {text: examples[1] ?? '¿Qué gancho le pondrías a mi próximo reel?'},
                    {text: 'Escribe el guion de la idea 3 y crea el video'},
                  ]
              ).map((e: {text: string; note?: string}) => (
                <li key={e.text}>
                  {/* Into the message box, to edit and send it himself. */}
                  <button
                    type="button"
                    onClick={() => pickExample(e.text)}
                    title="Ponerlo en el mensaje"
                    className="flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border bg-background/40 px-3 py-2.5 text-left transition-colors outline-none hover:border-foreground/30 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span>{e.text}</span>
                    {e.note && <span className="text-xs text-muted-foreground">{e.note}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {st?.items.map((it) => <Item key={it.id} item={it} slug={slug} onSeek={(t) => studio.seekRef.current(t)} onPermission={(item, allow) => chatApi.answerPermission(chatKey, chatId, item, allow)} />)}
        {st?.running && st.live && (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-img:my-2 prose-img:inline-block prose-img:max-h-72 prose-img:max-w-full prose-img:rounded-md after:ml-0.5 after:animate-pulse after:content-['▍']" dangerouslySetInnerHTML={{__html: md(st.live)}} />
        )}
        {st?.running && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Trabajando · {st.started && <Elapsed since={st.started} />}
            {st.tool && <span className="truncate">· {st.tool}</span>}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 px-3 pt-1 pb-3">
        {comments.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {comments.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1">
                <button className="rounded bg-amber-400/20 px-1.5 text-xs text-amber-300 tabular-nums" onClick={() => studio.seekRef.current(c.t)}>
                  {fmtTime(c.t)}
                </button>
                <span className="min-w-0 flex-1 truncate">{c.text}</span>
                <Button variant="ghost" size="icon-xs" onClick={() => studio.removeComment(slug!, c.id)} title="Quitar">
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {refs.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {refs.map((r) => (
              <li key={`${r.account}/${r.code}`} className="flex items-center rounded-md bg-muted">
                <RefChip r={r} />
                <Button variant="ghost" size="icon-xs" onClick={() => studio.removeRef(r)} title="Quitar">
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {auditKinds.map((k) => (
          <div key={k} className="flex items-center gap-2 self-start rounded-md bg-muted py-0.5 pr-0.5 pl-2 text-xs">
            <Target className="size-3.5 text-muted-foreground" /> {k === 'hook' ? 'Análisis del gancho' : 'Análisis de audiencia del guion'}
            <Button variant="ghost" size="icon-xs" onClick={() => studio.removeAudit(slug!, k)} title="Quitar">
              <X />
            </Button>
          </div>
        ))}
        {ideaRefs.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {ideaRefs.map((i) => (
              <li key={i.id} className="flex items-center rounded-md bg-muted">
                <IdeaChip idea={i} />
                <Button variant="ghost" size="icon-xs" onClick={() => studio.removeIdeaRef(i.id)} title="Quitar">
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {cmdItems.length > 0 && (
          <CommandMenu
            items={cmdItems}
            index={Math.min(cmdIndex, cmdItems.length - 1)}
            onHover={setCmdIndex}
            onPick={(c) => {
              if (c.args) setText(`/${c.name} `);
              else send(`/${c.name}`);
              input.current?.focus();
            }}
          />
        )}
        {/* The message box: grows with the text; send (or stop) is the round button inside it. */}
        <div className="flex flex-col rounded-2xl border bg-muted/30 transition-colors focus-within:border-ring/60 focus-within:bg-muted/50">
          {images.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-3 pt-3">
              {images.map((i) => (
                <li key={i.key} className="group/img relative" title={i.error ?? undefined}>
                  <img src={i.url} alt="" className={cn('size-16 rounded-md border object-cover', (!i.name || i.error) && 'opacity-50', i.error && 'border-destructive')} />
                  {!i.name && !i.error && <Loader2 className="absolute inset-0 m-auto size-4 animate-spin" />}
                  <button
                    type="button"
                    onClick={() => removeImage(i.key)}
                    title="Quitar"
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 group-hover/img:opacity-100 hover:text-foreground focus:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (!files.length) return;
              // An image copied alone: it goes as an image; with text too, the text is pasted as well.
              if (!e.clipboardData.getData('text/plain')) e.preventDefault();
              addImages(files);
            }}
            onKeyDown={(e) => {
              if (cmdItems.length && !e.nativeEvent.isComposing) {
                const c = cmdItems[Math.min(cmdIndex, cmdItems.length - 1)];
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const n = cmdItems.length;
                  setCmdIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setCmdDismissed(true);
                  return;
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                  e.preventDefault();
                  // Enter runs a command that takes nothing; Tab (or one that takes an argument) completes it.
                  if (e.key === 'Enter' && !c.args) send(`/${c.name}`);
                  else setText(`/${c.name} `);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder={comments.length ? 'Añade algo a los comentarios (opcional)…' : audit ? 'Qué hacer con el análisis (opcional: si no, lo aplica al guion)…' : ideaRefs.length ? `¿Qué quieres hacer con ${ideaRefs.length > 1 ? 'estas ideas' : 'esta idea'}? (opcional)` : refs.length ? (refs.every((r) => r.own) ? `¿Qué quieres saber de ${refs.length > 1 ? 'estos reels' : 'este reel'}?` : '¿Qué quieres sacar de esta referencia? (opcional)') : `Escribe a ${agent}… (/ para comandos)`}
            rows={2}
            className="field-sizing-content max-h-48 min-h-14 w-full resize-none bg-transparent px-3.5 pt-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                addImages([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <Button variant="ghost" size="icon-sm" className="flex-none rounded-full text-muted-foreground" onClick={() => picker.current?.click()} title="Adjuntar imágenes (también puedes pegarlas o arrastrarlas)">
              <ImagePlus />
            </Button>
            {st && <ModelPicker options={options} model={st.model} effort={st.effort} onChange={setOptions} open={pickerOpen} onOpenChange={setPickerOpen} />}
            {st && <ModePicker options={options} mode={st.mode} onChange={setMode} />}
            <span className="min-w-0 flex-1 truncate pl-1 text-xs">
              {err ? (
                <span className="text-destructive">{err}</span>
              ) : comments.length ? (
                <span className="text-amber-300">
                  {comments.length} comentario{comments.length > 1 ? 's' : ''} para enviar
                </span>
              ) : ideaRefs.length ? (
                <span className="text-amber-300">
                  {ideaRefs.length} idea{ideaRefs.length > 1 ? 's' : ''} para enviar
                </span>
              ) : refs.length ? (
                <span className="text-amber-300">
                  {refs.length} {refs.every((r) => r.own) ? 'reel' : 'referencia'}
                  {refs.length > 1 ? 's' : ''} para enviar
                </span>
              ) : null}
            </span>
            {st && <ContextRing context={st.context} running={st.running} />}
            {st?.running ? (
              <Button size="icon-sm" className="flex-none rounded-full" onClick={() => chatApi.stop(chatKey, chatId)} title="Detener">
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                className="flex-none rounded-full"
                onClick={() => send(text)}
                disabled={sending || uploading || (!text.trim() && !comments.length && !refs.length && !ideaRefs.length && !ready.length && !audit)}
                title={uploading ? 'Subiendo las imágenes…' : comments.length ? `Enviar ${comments.length} comentario${comments.length > 1 ? 's' : ''}` : 'Enviar'}
              >
                {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// The conversations of a key (a reel's, or the library's general ones), refreshed as they change.
function useChats(key: string) {
  const [list, setList] = useState<ChatList | null>(null);
  // A reload of the key he just left, still waiting or on its way, must not land on this one.
  const current = useRef(key);
  current.current = key;
  const load = useCallback(() => chatApi.list(key).then((l) => void (current.current === key && setList(l)), () => {}), [key]);
  useEffect(() => {
    setList(null);
    void load();
  }, [load]);
  const timer = useRef<number | undefined>(undefined);
  useSocket((msg) => {
    if (msg.type !== 'chat' || msg.slug !== key || (msg.op !== 'chats' && msg.op !== 'append')) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(load, 200);
  }, load);
  return [list, setList] as const;
}

const chatTitle = (c: ChatMeta) => c.title ?? 'Nueva conversación';

// The always-present Claude panel: open beside any page, or collapsed to a rail on the right edge
// that still shows when Claude is working or has replied. It follows you: inside a video it shows
// that video's conversations; in the library, the general ones. Each conversation is a tab, like an
// editor's; closed tabs stay in the history.
export function AgentPanel({slug}: {slug: string | null}) {
  const {open, setOpen} = useStudio();
  const key = slug ?? GENERAL;
  const [list, setList] = useChats(key);
  const agent = useAgentName();
  const inUse = useAgentId();
  const active = list?.active ?? null;
  const tabs = (list?.chats ?? []).filter((c) => !c.closed || c.id === active).sort((a, b) => b.created - a.created);
  const history = [...(list?.chats ?? [])].filter((c) => c.title).sort((a, b) => (b.lastTs ?? b.created) - (a.lastTs ?? a.created));
  const running = !!list?.chats.some((c) => c.running);
  const unread = !!list?.chats.some((c) => c.unread);

  const show = (id: string) => {
    setList((l) => l && {...l, active: id, chats: l.chats.map((c) => (c.id === id ? {...c, closed: false} : c))});
    chatApi.open(key, id).catch(() => {});
  };
  // The open general conversation created a video and went on in it: follow it there.
  useSocket((msg) => {
    if (msg.type === 'chat' && msg.op === 'moved' && msg.slug === key && msg.chat === active) location.hash = `#/reel/${msg.to}`;
  });
  const create = () => chatApi.create(key).then(({id}) => show(id), () => {});
  const close = (id: string) => chatApi.close(key, id).catch(() => {});

  const activeTab = useRef<HTMLDivElement>(null);
  // (in braces: newer Chromium returns a Promise from scrollIntoView, and an effect may only return a cleanup)
  useEffect(() => {
    activeTab.current?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }, [active, open]);

  return (
    <aside
      className={cn(
        // A column on the right from md up; below that it floats over the content.
        'fixed right-0 bottom-0 z-20 flex flex-col border-l bg-card md:sticky md:top-14 md:h-[calc(100vh-3.5rem)]',
        open ? 'top-14 w-full sm:w-[460px] md:w-auto' : 'bottom-4 h-40 w-11 rounded-l-lg border-y md:bottom-auto md:w-auto md:rounded-none md:border-y-0',
      )}
    >
      {!open && (
        <button onClick={() => setOpen(true)} title={`Abrir ${agent} (⌘J)`} className="animate-fade-in flex h-full w-full flex-col items-center gap-3 py-3 text-muted-foreground hover:bg-muted hover:text-foreground">
          <PanelRightOpen className="size-4" />
          <span className="rotate-180 text-xs font-medium [writing-mode:vertical-rl]">{agent}</span>
          {running ? <Loader2 className="size-4 animate-spin text-foreground" /> : unread ? <Unread /> : null}
        </button>
      )}
      <ResizeEdge />
      <div className={cn('animate-fade-in flex min-h-0 flex-1 flex-col', !open && 'hidden')}>
        <div className="flex h-12 flex-none items-center gap-1 border-b pr-1.5 pl-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {tabs.map((c) => {
              const isActive = c.id === active;
              return (
                <div
                  key={c.id}
                  ref={isActive ? activeTab : undefined}
                  className={cn(
                    'group flex max-w-44 min-w-20 flex-[0_1_auto] items-center rounded-md text-xs',
                    isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  <button onClick={() => show(c.id)} title={chatTitle(c)} className="flex min-w-0 items-center gap-1.5 py-1.5 pl-2.5">
                    {c.running ? <Loader2 className="size-3 flex-none animate-spin" /> : c.unread && !isActive ? <Unread /> : null}
                    <AgentLogo agent={c.agent ?? inUse} />
                    <span className="truncate">{chatTitle(c)}</span>
                  </button>
                  {(tabs.length > 1 || c.title) ? (
                    <button
                      onClick={() => close(c.id)}
                      title="Cerrar (sigue en el historial)"
                      className={cn('mx-1 flex-none rounded p-0.5 hover:bg-background/60', isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70')}
                    >
                      <X className="size-3" />
                    </button>
                  ) : (
                    <span className="w-2.5" />
                  )}
                </div>
              );
            })}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={create} title="Nueva conversación">
            <Plus />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" title="Historial de conversaciones" disabled={!history.length}>
                <History />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-96 w-80 overflow-y-auto">
              <DropdownMenuLabel className="text-xs text-muted-foreground">{slug ? 'Conversaciones de este video' : 'Conversaciones generales'}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {history.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => show(c.id)} className="flex items-center gap-2">
                  <span className="flex size-3.5 flex-none items-center justify-center">
                    {c.running ? <Loader2 className="size-3.5 animate-spin" /> : c.id === active ? <Check className="size-3.5" /> : c.unread ? <Unread /> : null}
                  </span>
                  <AgentLogo agent={c.agent ?? inUse} />
                  <span className="min-w-0 flex-1 truncate">{chatTitle(c)}</span>
                  <span className="flex-none text-[11px] text-muted-foreground">{fmtAgo(c.lastTs ?? c.created)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} title="Recoger (⌘J)">
            <PanelRightClose />
          </Button>
        </div>
        {active && <Conversation key={`${key}/${active}`} chatKey={key} chatId={active} slug={slug} visible={open} onNew={create} />}
      </div>
    </aside>
  );
}

// The panel's left edge (md+, where it's a column): drag it to make the panel wider or narrower, in past the halfway
// point to contract it to its rail, and out from the rail to open it again; a double click goes back to the default width. The width is kept in this browser (store/useStudioStore.ts).
const MIN_WIDTH = 320;
function ResizeEdge() {
  const {chatWidth, setChatWidth, open, setOpen} = useStudio();
  return (
    <ResizeHandle
      edge="left"
      width={chatWidth}
      min={MIN_WIDTH}
      max={() => window.innerWidth * 0.6}
      onResize={setChatWidth}
      onReset={() => {
        setChatWidth(null);
        setOpen(true);
      }}
      collapsed={!open}
      collapsedWidth={44}
      onCollapse={(c) => setOpen(!c)}
      label="Cambiar el ancho del panel"
    />
  );
}
