import {StrictMode, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Clapperboard, PanelLeftClose, PanelLeftOpen} from 'lucide-react';
import {TooltipProvider} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';
import {Library} from './Library';
import {Ideas} from './Ideas';
import {AudiencePage} from './Audience';
import {Automations} from './Automations';
import {Inspiration} from './Inspiration';
import {Sources} from './Sources';
import {Account} from './Account';
import {Styles} from './Styles';
import {Formats} from './Formats';
import {Settings} from './Settings';
import {NewReel} from './NewReel';
import {ReelView} from './ReelView';
import {AgentPanel} from './Chat';
import {Sidebar} from './Sidebar';
import {StudioProvider, loadOpenProject, useStudio} from './studio';
import {Welcome} from './Welcome';
import {useSocket, workspaceApi, type WorkspaceStatus} from './api';
import {ConfirmProvider} from './confirm';
import './index.css';

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

// Hash routes: #/ (library), #/ideas (Ideas de contenido), #/audiencia (Perfil de audiencia), #/automatizaciones, #/fuentes[/<id>] (Fuentes de información), #/cuenta (Mi cuenta), #/inspiracion, #/estilos[/<id>], #/formatos[/<id>], #/ajustes[/<section>], #/nuevo (new reel, chat first), #/reel/<slug>
// and #/bienvenida (welcome page, also shown whenever there's no workspace yet).
function useRoute() {
  const hash = useHash();
  const m = hash.match(/^#\/reel\/([a-z0-9-]+)/);
  if (m) return {page: 'reel' as const, slug: m[1]};
  const page = hash.startsWith('#/ideas') ? 'ideas' : hash.startsWith('#/audiencia') ? 'audience' : hash.startsWith('#/automatizaciones') ? 'automations' : hash.startsWith('#/fuentes') ? 'sources' : hash.startsWith('#/cuenta') ? 'account' : hash.startsWith('#/inspiracion') ? 'inspiration' : hash.startsWith('#/estilos') ? 'styles' : hash.startsWith('#/formatos') ? 'formats' : hash.startsWith('#/ajustes') ? 'settings' : hash.startsWith('#/nuevo') ? 'new' : 'library';
  return {page: page as 'account' | 'library' | 'ideas' | 'audience' | 'automations' | 'sources' | 'inspiration' | 'styles' | 'formats' | 'settings' | 'new', slug: null};
}

function App() {
  const {page, slug} = useRoute();
  const settingsSection = useHash().match(/^#\/ajustes\/([a-z]+)/)?.[1] ?? null;
  const {open: panelOpen, reelTitle, chatWidth, sideOpen, setSideOpen} = useStudio();
  // On #/nuevo the page itself is the chat: no side panel until the reel exists.
  const panel = page !== 'new';
  const open = panel && panelOpen;
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
        <button
          onClick={() => setSideOpen(!sideOpen)}
          title={sideOpen ? 'Contraer el panel lateral (⌘B)' : 'Expandir el panel lateral (⌘B)'}
          aria-label={sideOpen ? 'Contraer el panel lateral' : 'Expandir el panel lateral'}
          className="-ml-1.5 hidden rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground lg:block"
        >
          {sideOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </button>
        <a href="#/" className="flex items-center gap-2 font-semibold">
          <Clapperboard className="size-5" />
          Reel Studio
        </a>
        {page !== 'library' && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="text-muted-foreground">{slug ? (reelTitle ?? slug) : ({account: 'Mi cuenta', ideas: 'Ideas de contenido', audience: 'Perfil de audiencia', automations: 'Automatizaciones', sources: 'Fuentes de información', inspiration: 'Inspiración', styles: 'Estilos y formatos', formats: 'Estilos y formatos', settings: 'Ajustes', new: 'Nuevo reel'} as Record<string, string>)[page]}</span>
          </>
        )}
      </header>
      {/* agents sidebar (lg+) · page · Claude panel */}
      <div
        className={cn(
          'grid items-start',
          !panel
            ? 'lg:grid-cols-[var(--side-lg)_minmax(0,1fr)] 2xl:grid-cols-[var(--side-2xl)_minmax(0,1fr)]'
            : open
              ? 'md:grid-cols-[minmax(0,1fr)_var(--chat-w,400px)] lg:grid-cols-[var(--side-lg)_minmax(0,1fr)_var(--chat-w,420px)] 2xl:grid-cols-[var(--side-2xl)_minmax(0,1fr)_var(--chat-w,480px)]'
              : 'md:grid-cols-[minmax(0,1fr)_44px] lg:grid-cols-[var(--side-lg)_minmax(0,1fr)_44px] 2xl:grid-cols-[var(--side-2xl)_minmax(0,1fr)_44px]',
        )}
        // The sidebar, full or contracted to its icons (Sidebar.tsx); the panel, at the width he dragged it to
        // (Chat.tsx), never more than 60 % of the window, even if it shrinks.
        style={
          {
            '--side-lg': sideOpen ? '240px' : '56px',
            '--side-2xl': sideOpen ? '260px' : '56px',
            ...(open && chatWidth ? {'--chat-w': `min(${chatWidth}px, 60vw)`} : {}),
          } as React.CSSProperties
        }
      >
        <Sidebar slug={slug} page={page} />
        {/* each column scrolls on its own (md+), so scrolling the chat never moves the page */}
        <div className="min-w-0 md:h-[calc(100vh-3.5rem)] md:overflow-y-auto md:overscroll-contain">{slug ? <ReelView key={slug} slug={slug} /> : page === 'account' ? <Account /> : page === 'ideas' ? <Ideas /> : page === 'audience' ? <AudiencePage /> : page === 'automations' ? <Automations /> : page === 'sources' ? <Sources /> : page === 'inspiration' ? <Inspiration /> : page === 'styles' ? <Styles /> : page === 'formats' ? <Formats /> : page === 'settings' ? <Settings section={settingsSection} /> : page === 'new' ? <NewReel /> : <Library />}</div>
        {panel && <AgentPanel slug={slug} />}
      </div>
    </>
  );
}

// Inside the desktop app on a Mac the header is also the window's title bar (see .desktop in index.css);
// on Windows and Linux the window keeps its own frame.
if (navigator.userAgent.includes('Electron') && navigator.userAgent.includes('Mac')) document.documentElement.classList.add('desktop');

// The studio needs a workspace: until there is one, only the welcome page shows. If the workspace changes
// (here or in another window), the studio's pages reload; the welcome page just refreshes its status.
function Root() {
  const hash = useHash();
  const [ws, setWs] = useState<WorkspaceStatus | null>(null);
  const [err, setErr] = useState('');
  // First run: stay on the welcome page through all its steps, not just until the folder is set.
  const [firstRun, setFirstRun] = useState(false);
  const load = () =>
    workspaceApi.status().then(
      (s) => {
        setWs(s);
        if (!s.configured) setFirstRun(true);
      },
      (e: Error) => setErr(e.message),
    );
  useEffect(() => void load(), []);
  const welcome = !!ws && (!ws.configured || firstRun || hash.startsWith('#/bienvenida'));
  useSocket(
    (msg) => {
      if (msg.type !== 'workspace') return;
      if (welcome) load();
      else location.reload();
    },
    () => void load(),
  );
  if (!ws) return <p className="p-6 text-sm text-muted-foreground">{err || 'Cargando…'}</p>;
  if (welcome)
    return (
      <Welcome
        status={ws}
        onDone={() => {
          location.hash = '#/';
          location.reload();
        }}
      />
    );
  return (
    <StudioProvider>
      <App />
    </StudioProvider>
  );
}

void loadOpenProject().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <ConfirmProvider>
        <Root />
      </ConfirmProvider>
    </TooltipProvider>
  </StrictMode>,
));
