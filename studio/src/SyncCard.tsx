// Ajustes → Cuenta: which of this project's data goes to the account. Interface only for now: nothing is
// synced yet and the switches aren't saved. The groups follow the allow-list in the cloud's docs/studio-cloud.md.
import {useState} from 'react';
import {CalendarClock, Clapperboard, Film, KeyRound, Lightbulb, MessagesSquare, Newspaper, Palette, RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles, Video, type LucideIcon} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {Switch} from '@/components/ui/switch';

type Group = {id: string; icon: LucideIcon; title: string; text: string};

const SYNCED: Group[] = [
  {id: 'videos', icon: Clapperboard, title: 'Insumos de videos', text: 'Guion, código, voz e imágenes de cada uno.'},
  {id: 'ideas', icon: Lightbulb, title: 'Ideas', text: 'Tu tablero de ideas de contenido.'},
  {id: 'settings', icon: SlidersHorizontal, title: 'Perfil y ajustes', text: 'Voz, perfil de audiencia y salida de los videos.'},
  {id: 'sources', icon: Newspaper, title: 'Fuentes', text: 'Tus fuentes y lo que se extrajo de ellas.'},
  {id: 'reels', icon: Sparkles, title: 'Reels analizados', text: 'Mi cuenta e Inspiración: traerlos otra vez gasta saldo.'},
  {id: 'automations', icon: CalendarClock, title: 'Automatizaciones', text: 'Qué corre y cuándo; no su historial.'},
  {id: 'audit', icon: ShieldCheck, title: 'Auditoría', text: 'Lo que se verificó de cada video.'},
  {id: 'styles', icon: Palette, title: 'Estilos y formatos', text: 'Los tuyos, compartidos entre proyectos.'},
];

const LOCAL_ONLY: Group[] = [
  {id: 'chats', icon: MessagesSquare, title: 'Conversaciones', text: 'Tus chats con los agentes.'},
  {id: 'renders', icon: Film, title: 'Videos renderizados', text: 'Los MP4 finales de cada video.'},
  {id: 'footage', icon: Video, title: 'Grabaciones', text: 'El material que grabaste para tus videos.'},
];

// Not part of the sync cycle: keys are moved by hand from their own screen, and .env never syncs.
const SECRETS: Group = {id: 'secrets', icon: KeyRound, title: 'Secretos', text: 'Las API keys de tus servicios, cifradas en tu cuenta.'};

const NEVER = 'Nunca';

// While loading, each text keeps its real size under the skeleton, so it wraps like the card that replaces it.
function Text({loading, children}: {loading?: boolean; children: React.ReactNode}) {
  return loading ? <Skeleton className="w-fit max-w-full text-transparent">{children}</Skeleton> : <>{children}</>;
}

function Row({group, last, loading, children}: {group: Group; last?: string; loading?: boolean; children?: React.ReactNode}) {
  const Icon = group.icon;
  return (
    <li className="flex items-center gap-3 py-2.5">
      {loading ? <Skeleton className="size-4 shrink-0" /> : <Icon className="size-4 shrink-0 text-muted-foreground" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">
            <Text loading={loading}>{group.title}</Text>
          </span>
          {last && (
            <span className="shrink-0 text-xs text-muted-foreground">
              <Text loading={loading}>{last}</Text>
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          <Text loading={loading}>{group.text}</Text>
        </span>
      </span>
      {children}
    </li>
  );
}

export function SyncCard({loading}: {loading?: boolean}) {
  const [active, setActive] = useState(() => new Set(SYNCED.map((g) => g.id)));
  const toggle = (id: string, on: boolean) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Text loading={loading}>Sincronización</Text> {loading ? <Skeleton className="h-5 w-24 rounded-full" /> : <Badge variant="outline">Próximamente</Badge>}
        </CardTitle>
        <CardDescription>
          <Text loading={loading}>Lo que se guarda de este proyecto en tu cuenta, para tenerlo en otro equipo.</Text>
        </CardDescription>
        <CardAction>
          {loading ? (
            <Skeleton className="h-7 w-36" />
          ) : (
            <Button variant="outline" size="sm" disabled>
              <RefreshCw /> Sincronizar ahora
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3">
          <div>
            <dt className="text-xs text-muted-foreground">
              <Text loading={loading}>Última sincronización</Text>
            </dt>
            <dd className="text-sm font-medium">
              <Text loading={loading}>{NEVER}</Text>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              <Text loading={loading}>Activos</Text>
            </dt>
            <dd className="text-sm font-medium">
              <Text loading={loading}>
                {active.size} de {SYNCED.length}
              </Text>
            </dd>
          </div>
        </dl>
        <ul className="flex flex-col divide-y">
          {SYNCED.map((g) => (
            <Row key={g.id} group={g} last={NEVER} loading={loading}>
              {loading ? <Skeleton className="h-[18px] w-8 rounded-full" /> : <Switch checked={active.has(g.id)} aria-label={`Sincronizar ${g.title}`} onCheckedChange={(on) => toggle(g.id, on)} />}
            </Row>
          ))}
          <Row group={SECRETS} loading={loading}>
            {loading ? (
              <Skeleton className="h-4 w-16" />
            ) : (
              <a href="#/ajustes/modo" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                Gestionar
              </a>
            )}
          </Row>
        </ul>
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">
            <Text loading={loading}>Se quedan solo en este equipo</Text>
          </h4>
          <ul className="flex flex-col divide-y">
            {LOCAL_ONLY.map((g) => (
              <Row key={g.id} group={g} loading={loading} />
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
