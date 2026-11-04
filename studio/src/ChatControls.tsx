// The message box's controls: the model and effort menu, the context ring and the slash-command list.
import {useEffect, useState} from 'react';
import {Check, ChevronDown} from 'lucide-react';
import {cn} from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {AgentLogo} from './AgentLogo';
import {chatApi, noteAgent, settingsApi, useAgentId, useAgentName, type AgentChoice, type AgentModel, type ChatCommand, type ChatContext, type ChatOptions} from './api';

export const EFFORT_LABELS: Record<string, string> = {none: 'Ninguno', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo', ultra: 'Ultra'};
const effortLabel = (e: string) => EFFORT_LABELS[e] ?? e;

// The agent's models and commands, asked again when the agent changes (Ajustes → Agente) or a turn ends
// (the CLI may have reported new commands). Shared by every open conversation.
let cache: ChatOptions | null = null;
const subs = new Set<(o: ChatOptions) => void>();
let inflight: Promise<void> | null = null;
export function refreshChatOptions() {
  inflight ??= chatApi
    .options()
    .then((o) => {
      cache = o;
      subs.forEach((fn) => fn(o));
    })
    .catch(() => {})
    .finally(() => (inflight = null));
  return inflight;
}
export function useChatOptions() {
  const agent = useAgentName();
  const [opts, setOpts] = useState(cache);
  useEffect(() => {
    subs.add(setOpts);
    void refreshChatOptions();
    return () => void subs.delete(setOpts);
  }, [agent]);
  return opts;
}

// "Opus 5.5 · Alto": the model and effort this conversation runs with. The menu lists the models; each opens its
// efforts beside it. Clicking a model itself picks it at medium effort (or its own default if it has no medium).
export function ModelPicker({
  options,
  model,
  effort,
  onChange,
  open,
  onOpenChange,
  side = 'top',
}: {
  options: ChatOptions | null;
  model: string;
  effort: string;
  onChange: (o: {model: string; effort: string}) => void;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  side?: 'top' | 'bottom';
}) {
  const models = options?.models ?? [];
  const m = models.find((x) => x.id === model) ?? models[0];
  if (!m) return null;
  const pick = (x: AgentModel, e?: string) => {
    onChange({model: x.id, effort: e ?? (x.efforts.includes('medium') ? 'medium' : '')});
    onOpenChange(false);
  };
  const Mark = ({on}: {on: boolean}) => <Check className={cn('size-3.5 flex-none', !on && 'invisible')} />;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          title="Modelo y esfuerzo (/model, /effort)"
          className="flex h-7 max-w-44 min-w-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
        >
          <span className="truncate">{m.label}</span>
          {effort && <span className="flex-none text-muted-foreground/70">· {effortLabel(effort)}</span>}
          <ChevronDown className="size-3 flex-none opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={side} className="max-h-[70vh] w-56 overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Modelo</DropdownMenuLabel>
        {models.map((x) =>
          x.efforts.length ? (
            <DropdownMenuSub key={x.id || 'default'}>
              <DropdownMenuSubTrigger onClick={() => pick(x)} className="gap-2 text-sm">
                <Mark on={x.id === m.id} />
                <span className="min-w-0 flex-1 truncate">{x.label}</span>
                {x.id === m.id && effort && <span className="flex-none text-xs text-muted-foreground">{effortLabel(effort)}</span>}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Esfuerzo · {x.label}</DropdownMenuLabel>
                {x.efforts.map((e) => (
                  <DropdownMenuItem key={e} onSelect={() => pick(x, e)} className="gap-2 text-sm">
                    <Mark on={x.id === m.id && e === effort} />
                    {effortLabel(e)}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => pick(x, '')} className="gap-2 text-sm text-muted-foreground">
                  <Mark on={x.id === m.id && !effort} />
                  El del modelo{x.defaultEffort ? ` (${effortLabel(x.defaultEffort)})` : ''}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem key={x.id || 'default'} onSelect={() => pick(x, '')} className="gap-2 text-sm">
              <Mark on={x.id === m.id} />
              {x.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// How this conversation asks for permission. It applies from the next message.
export function ModePicker({options, mode, onChange}: {options: ChatOptions | null; mode: string; onChange: (mode: string) => void}) {
  const modes = options?.modes ?? [];
  const m = modes.find((x) => x.id === mode) ?? modes[0];
  if (!m) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={`Permisos: ${m.description} Se aplica desde el siguiente mensaje.`}
          className="flex h-7 max-w-40 min-w-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
        >
          <span className="truncate">{m.label}</span>
          <ChevronDown className="size-3 flex-none opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Permisos · desde el siguiente mensaje</DropdownMenuLabel>
        {modes.map((x) => (
          <DropdownMenuItem key={x.id} onSelect={() => onChange(x.id)} className="items-start gap-2 text-sm">
            <Check className={cn('mt-0.5 size-3.5 flex-none', x.id !== m.id && 'invisible')} />
            <span className="flex min-w-0 flex-col">
              {x.label}
              <span className="text-xs text-muted-foreground">{x.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The agent in use, with its logo. There's one for the whole studio (Ajustes → Agente): changing it here changes it
// there too, and the conversations already open go on with it in their next message.
export function AgentPicker() {
  const id = useAgentId();
  const [choice, setChoice] = useState<AgentChoice | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => void settingsApi.agents().then(setChoice, () => {}), []);
  const pick = (agent: string) => {
    setErr('');
    settingsApi.setAgent(agent).then(
      (next) => {
        setChoice(next);
        noteAgent(next);
      },
      (e: Error) => setErr(e.message),
    );
  };
  const current = choice?.agents.find((a) => a.id === id);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            title="Agente"
            className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
          >
            <AgentLogo agent={id} className="size-3.5 flex-none" />
            <span className="truncate">{current?.label ?? id}</span>
            <ChevronDown className="size-3 flex-none opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Agente</DropdownMenuLabel>
          {choice?.agents.map((a) => {
            const ok = a.installed && a.loggedIn;
            return (
              <DropdownMenuItem key={a.id} disabled={!ok} onSelect={() => pick(a.id)} className="gap-2 text-sm">
                <Check className={cn('size-3.5 flex-none', a.id !== id && 'invisible')} />
                <AgentLogo agent={a.id} className="size-4 flex-none" />
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {!ok && <span className="flex-none text-xs text-muted-foreground">{a.installed ? 'Sin sesión' : 'No instalado'}</span>}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Es el mismo de Ajustes → Agente: las demás conversaciones siguen con él en su próximo mensaje.</p>
        </DropdownMenuContent>
      </DropdownMenu>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </>
  );
}

const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

// A ring that fills as the conversation's context does; amber past 70 %, red past 90 %. Spins while it works.
export function ContextRing({context, running}: {context: ChatContext | null; running: boolean}) {
  const used = context?.used ?? null;
  const window = context?.window ?? null;
  const pct = used != null && window ? Math.min(1, used / window) : null;
  const R = 7;
  const C = 2 * Math.PI * R;
  const tone = pct == null ? 'text-muted-foreground' : pct >= 0.9 ? 'text-red-400' : pct >= 0.7 ? 'text-amber-400' : 'text-foreground/80';
  const tip =
    used == null
      ? context
        ? 'Contexto compactado: se actualiza con la próxima respuesta'
        : 'Contexto: aún sin datos (se ve tras la primera respuesta)'
      : window
        ? `Contexto: ${fmtTokens(used)} de ${fmtTokens(window)} (${Math.round(pct! * 100)} %)`
        : `Contexto: ${fmtTokens(used)} tokens`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('relative flex size-7 flex-none items-center justify-center', tone)} aria-label={tip}>
          <svg viewBox="0 0 18 18" className={cn('size-[18px] -rotate-90', running && pct == null && 'animate-spin')}>
            <circle cx="9" cy="9" r={R} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth="2" />
            {pct != null ? (
              <circle cx="9" cy="9" r={R} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(pct, 0.02))} className="transition-[stroke-dashoffset] duration-500" />
            ) : (
              running && <circle cx="9" cy="9" r={R} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${C * 0.25} ${C}`} />
            )}
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  );
}

// The commands that match what's typed after "/" (by start of name first, then anywhere in it).
export function matchCommands(commands: ChatCommand[], text: string) {
  const m = text.match(/^\/(\S*)$/);
  if (!m) return [];
  const q = m[1].toLowerCase();
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q));
  const inside = commands.filter((c) => !starts.includes(c) && c.name.toLowerCase().includes(q));
  return [...starts, ...inside].slice(0, 50);
}

// The list above the message box while typing a command.
export function CommandMenu({items, index, onPick, onHover}: {items: ChatCommand[]; index: number; onPick: (c: ChatCommand) => void; onHover: (i: number) => void}) {
  useEffect(() => {
    document.getElementById(`cmd-${index}`)?.scrollIntoView({block: 'nearest'});
  }, [index]);
  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md" role="listbox">
      {items.map((c, i) => (
        <button
          key={c.name}
          id={`cmd-${i}`}
          role="option"
          aria-selected={i === index}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
          onMouseMove={() => onHover(i)}
          className={cn('flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm', i === index && 'bg-accent text-accent-foreground')}
        >
          <span className="flex-none font-mono text-[13px]">
            /{c.name}
            {c.args && <span className="text-muted-foreground"> {c.args}</span>}
          </span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{c.description}</span>
          {c.studio && <span className="ml-auto flex-none text-[10px] text-muted-foreground/60">studio</span>}
        </button>
      ))}
    </div>
  );
}
