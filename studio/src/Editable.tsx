import {useEffect, useState} from 'react';
import {AlertTriangle} from 'lucide-react';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';

// Local edit buffer over a file on disk. Follows the disk while there are no unsaved changes;
// with unsaved changes it keeps the buffer and flags that the disk moved underneath.
export function useEditable(diskText: string, save: (text: string) => Promise<unknown>) {
  const [base, setBase] = useState(diskText);
  const [text, setText] = useState(diskText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = text !== base;

  useEffect(() => {
    if (diskText === base) return;
    if (!dirty) {
      setBase(diskText);
      setText(diskText);
    }
  }, [diskText]); // eslint-disable-line react-hooks/exhaustive-deps

  const conflict = dirty && diskText !== base;
  const doSave = async () => {
    setSaving(true);
    setError('');
    try {
      await save(text);
      setBase(text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return {
    text,
    setText,
    dirty,
    conflict,
    saving,
    error,
    save: doSave,
    revert: () => {
      setBase(diskText);
      setText(diskText);
    },
  };
}

type Ed = ReturnType<typeof useEditable>;

export function SaveBar({ed, children}: {ed: Ed; children?: React.ReactNode}) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">{children}</div>
      {ed.error && <span className="text-sm text-destructive">{ed.error}</span>}
      {ed.dirty && (
        <Button variant="ghost" size="sm" onClick={ed.revert} title="Descartar cambios y cargar lo que hay en disco">
          Descartar
        </Button>
      )}
      <Button size="sm" onClick={ed.save} disabled={!ed.dirty || ed.saving} title="⌘S">
        {ed.saving ? 'Guardando…' : ed.dirty ? 'Guardar' : 'Guardado'}
      </Button>
    </div>
  );
}

export function ConflictNote({ed}: {ed: Ed}) {
  if (!ed.conflict) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertDescription>
        El archivo cambió en disco mientras editabas (¿el agente?). Guardar sobrescribe esa versión; Descartar carga la del disco.
      </AlertDescription>
    </Alert>
  );
}

export const saveOnCmdS = (ed: Ed) => (e: React.KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (ed.dirty) ed.save();
  }
};
