// Which columns a table of reels shows (Mi cuenta, Inspiración): a "Columnas" menu, kept per project.
import {useState} from 'react';
import {Columns3} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {projectKey, read, write} from './studio';

export type Column<K extends string> = {key: K; label: string};

// hidden: off until he turns them on. What he picked is stored as the hidden ones, so a column added later shows.
export function useColumns<K extends string>(table: string, all: Column<K>[], hidden: K[] = []) {
  const storeKey = projectKey(`studio.columns.${table}`);
  const [off, setOff] = useState<Set<K>>(() => {
    try {
      const saved = JSON.parse(read(storeKey, 'null')) as K[] | null;
      return new Set(Array.isArray(saved) ? saved : hidden);
    } catch {
      return new Set(hidden);
    }
  });
  const toggle = (k: K, on: boolean) =>
    setOff((s) => {
      const next = new Set(s);
      if (on) next.delete(k);
      else next.add(k);
      write(storeKey, JSON.stringify([...next]));
      return next;
    });
  const shown = (k: K) => !off.has(k);
  const picker = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Columns3 /> Columnas
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Columnas visibles</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {all.map((c) => (
          <DropdownMenuCheckboxItem key={c.key} checked={shown(c.key)} onCheckedChange={(on) => toggle(c.key, on)} onSelect={(e) => e.preventDefault()}>
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return {shown, picker};
}
