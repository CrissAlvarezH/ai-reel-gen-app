// The sidebar's + : a menu with each kind of publication it can start (Nuevo video, Nuevo carrusel), each with its icon.
// Radix's menu gives it the keyboard (arrows, Enter, Esc) and gives focus back to the + when it closes.
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {KIND, NEW_KINDS} from './PublicationKind';

export function NewPublicationMenu({children, side = 'bottom', align = 'end'}: {children: React.ReactElement; side?: 'bottom' | 'right'; align?: 'start' | 'end'}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      {/* Its own width: the trigger is an icon, narrower than the names. */}
      <DropdownMenuContent side={side} align={align} className="w-auto min-w-44">
        {NEW_KINDS.map((k) => {
          const I = KIND[k].icon;
          return (
            <DropdownMenuItem key={k} asChild>
              <a href={KIND[k].href}>
                <I aria-hidden /> {KIND[k].new}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
