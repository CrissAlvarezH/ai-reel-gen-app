import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {projectsApi, type Comment, type IdeaRef, type InspirationRef, type UiContext} from './api';

export type AuditKind = 'audience' | 'hook';

export type {UiContext};

// App-wide state shared by the pages and the always-present Claude panel: whether the panel is open,
// timeline comments waiting to be sent, how to seek the reel's player from a comment's timestamp, and
// where Cristian is in the UI right now (sent with every message so the agent knows what he's looking at).

type Studio = {
  open: boolean;
  setOpen: (o: boolean) => void;
  // The left sidebar: full, or contracted to a column of icons (lg+).
  sideOpen: boolean;
  setSideOpen: (o: boolean) => void;
  // The panel's width when he dragged its edge (px); null: the default for the screen.
  chatWidth: number | null;
  setChatWidth: (w: number | null, keep?: boolean) => void;
  comments: Record<string, Comment[]>;
  addComment: (slug: string, c: Comment) => void;
  removeComment: (slug: string, id: string) => void;
  clearComments: (slug: string) => void;
  seekRef: React.MutableRefObject<(t: number) => void>;
  // Written by the pages as you move (no re-render); read when a message is sent.
  uiRef: React.MutableRefObject<UiContext>;
  // Reels from Inspiración waiting to go with the next message of the general conversation.
  refs: InspirationRef[];
  addRef: (r: InspirationRef) => void;
  removeRef: (r: InspirationRef) => void;
  clearRefs: () => void;
  // Ideas waiting to go with the next message of the general conversation.
  ideaRefs: IdeaRef[];
  addIdeaRef: (r: IdeaRef) => void;
  removeIdeaRef: (id: string) => void;
  clearIdeaRefs: () => void;
  // Script reviews that go with the next message of their reel's conversation, as "<kind>/<slug>": Alineación con tu
  // audiencia (audience) and Fuerza del gancho (hook).
  audits: string[];
  addAudit: (slug: string, kind: AuditKind) => void;
  removeAudit: (slug: string, kind?: AuditKind) => void; // no kind: both
  // Name of the open reel, shown in the header (title.txt, or its slug).
  reelTitle: string | null;
  setReelTitle: (t: string | null) => void;
};

const Ctx = createContext<Studio | null>(null);

export const read = (k: string, fallback: string) => {
  try {
    return localStorage.getItem(k) ?? fallback;
  } catch {
    return fallback;
  }
};
export const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

// The project open, known before the first render (main.tsx) and the same until the page reloads, which it does when
// it changes. Preferences of a project are kept under projectKey; those of this window (panels) aren't.
let openProject: string | null = null;
export const loadOpenProject = () =>
  projectsApi.list().then(
    (all) => void (openProject = all.find((p) => p.current)?.id ?? null),
    () => {},
  );
export const projectKey = (k: string) => (openProject ? `${k}.${openProject}` : k);

export function StudioProvider({children}: {children: React.ReactNode}) {
  const [open, setOpenState] = useState(() => read('studio.agent.open', '1') === '1');
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const seekRef = useRef<(t: number) => void>(() => {});
  const uiRef = useRef<UiContext>({page: 'library'});
  const [reelTitle, setReelTitle] = useState<string | null>(null);
  const [refs, setRefs] = useState<InspirationRef[]>([]);
  const [ideaRefs, setIdeaRefs] = useState<IdeaRef[]>([]);
  const [audits, setAudits] = useState<string[]>([]);
  const [sideOpen, setSideOpenState] = useState(() => read('studio.sidebar.open', '1') === '1');
  const setSideOpen = useCallback((o: boolean) => {
    setSideOpenState(o);
    write('studio.sidebar.open', o ? '1' : '0');
  }, []);
  const [chatWidth, setChatWidthState] = useState(() => Number(read('studio.agent.width', '')) || null);
  // keep: remember it (at the end of a drag, not on every move).
  const setChatWidth = useCallback((w: number | null, keep = true) => {
    setChatWidthState(w);
    if (keep) write('studio.agent.width', w ? String(Math.round(w)) : '');
  }, []);

  const setOpen = useCallback((o: boolean) => {
    setOpenState(o);
    write('studio.agent.open', o ? '1' : '0');
  }, []);

  // ⌘J / Ctrl+J opens or collapses the panel from anywhere; ⌘B / Ctrl+B, the left sidebar.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === 'j') {
        e.preventDefault();
        setOpenState((o) => {
          write('studio.agent.open', o ? '0' : '1');
          return !o;
        });
      }
      if (k === 'b') {
        e.preventDefault();
        setSideOpenState((o) => {
          write('studio.sidebar.open', o ? '0' : '1');
          return !o;
        });
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const value = useMemo<Studio>(
    () => ({
      open,
      setOpen,
      sideOpen,
      setSideOpen,
      chatWidth,
      setChatWidth,
      comments,
      // A new timeline comment goes to the reel's conversation: show it.
      addComment: (slug, c) => {
        setComments((all) => ({...all, [slug]: [...(all[slug] ?? []), c]}));
        setOpen(true);
      },
      removeComment: (slug, id) => setComments((all) => ({...all, [slug]: (all[slug] ?? []).filter((c) => c.id !== id)})),
      clearComments: (slug) => setComments((all) => ({...all, [slug]: []})),
      seekRef,
      uiRef,
      // "Usar como referencia": attach it to the general conversation and show the panel.
      refs,
      addRef: (r) => {
        setRefs((all) => (all.some((x) => x.account === r.account && x.code === r.code) ? all : [...all, r]));
        setOpen(true);
      },
      removeRef: (r) => setRefs((all) => all.filter((x) => !(x.account === r.account && x.code === r.code))),
      clearRefs: () => setRefs([]),
      // "Adjuntar al chat": the same, for an idea.
      ideaRefs,
      addIdeaRef: (r) => {
        setIdeaRefs((all) => (all.some((x) => x.id === r.id) ? all : [...all, r]));
        setOpen(true);
      },
      removeIdeaRef: (id) => setIdeaRefs((all) => all.filter((x) => x.id !== id)),
      clearIdeaRefs: () => setIdeaRefs([]),
      // "Agregar al chat" on the reel page: the same, for its audience check.
      audits,
      addAudit: (slug, kind) => {
        setAudits((all) => (all.includes(`${kind}/${slug}`) ? all : [...all, `${kind}/${slug}`]));
        setOpen(true);
      },
      removeAudit: (slug, kind) => setAudits((all) => all.filter((x) => (kind ? x !== `${kind}/${slug}` : !x.endsWith(`/${slug}`)))),
      reelTitle,
      setReelTitle,
    }),
    [open, setOpen, sideOpen, setSideOpen, chatWidth, setChatWidth, comments, refs, ideaRefs, audits, reelTitle],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStudio() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStudio fuera de StudioProvider');
  return s;
}
