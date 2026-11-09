import {useCallback, useEffect, useState} from 'react';
import {Settings as SettingsIcon, UserRound} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {cloudApi, useSocket} from './api';

const ITEM = 'mt-0.5 flex items-center rounded-md text-sm transition-colors duration-150';
const IDLE = 'text-foreground/80 hover:bg-muted hover:text-foreground';
const ON = 'bg-primary/10 font-medium text-primary';
// Soft tints for the initial, picked by the letter so each person keeps theirs.
const TINTS = [
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
];

// The foot of the sidebar: the account, by first name, and the gear for the rest of Ajustes. The session answers
// without the network, so "Sin cuenta" never flashes for someone signed in; the name comes after it, and an account
// without one (the login only asks for an email) shows the email, cut with an ellipsis when it doesn't fit.
export function SidebarAccount({onSettings, compact}: {onSettings: boolean; compact: boolean}) {
  const [label, setLabel] = useState('');
  const [initial, setInitial] = useState('');
  const load = useCallback(async () => {
    const session = await cloudApi.session().catch(() => null);
    if (!session?.signedIn) {
      setInitial('');
      setLabel(session ? 'Sin cuenta' : '');
      return;
    }
    const first = await cloudApi.status().then((s) => s.user?.name?.trim().split(/\s+/)[0] ?? '', () => '');
    const shown = first || session.email || 'Cuenta';
    setInitial(shown.charAt(0).toUpperCase());
    setLabel(shown);
  }, []);
  useEffect(() => void load(), [load]);
  useSocket((msg) => msg.type === 'cloud' && void load(), load);

  const onAccount = onSettings && location.hash.startsWith('#/ajustes/cuenta');
  return (
    <div className={cn('flex', compact ? 'flex-col' : 'items-center gap-1 px-2')}>
      <a
        href="#/ajustes/cuenta"
        title={compact ? label : undefined}
        aria-current={onAccount ? 'page' : undefined}
        className={cn(ITEM, 'min-w-0 gap-2 py-1.5', compact ? 'mx-2 justify-center' : 'flex-1 px-2', onAccount ? ON : IDLE)}
      >
        {initial ? (
          <span aria-hidden className={cn('grid size-5 flex-none place-items-center rounded-full text-[11px] font-medium', TINTS[initial.charCodeAt(0) % TINTS.length])}>
            {initial}
          </span>
        ) : (
          <UserRound className="size-4 flex-none" />
        )}
        {!compact && <span className="animate-fade-in min-h-5 flex-1 truncate">{label}</span>}
      </a>
      <Button asChild variant="ghost" size="icon-sm" className={cn('flex-none', compact && 'mt-0.5 self-center', onSettings && !onAccount && 'text-primary')}>
        <a href="#/ajustes" title="Ajustes" aria-label="Ajustes" aria-current={onSettings && !onAccount ? 'page' : undefined}>
          <SettingsIcon />
        </a>
      </Button>
    </div>
  );
}
