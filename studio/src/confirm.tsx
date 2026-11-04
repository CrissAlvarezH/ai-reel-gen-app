import {createContext, useCallback, useContext, useRef, useState} from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// confirm() as a shadcn AlertDialog: `if (await confirm({title, description})) …`
type Opts = {title: string; description?: string; action?: string; destructive?: boolean};
const Ctx = createContext<(o: Opts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({children}: {children: React.ReactNode}) {
  const [opts, setOpts] = useState<Opts | null>(null);
  const resolver = useRef<(v: boolean) => void>(() => {});
  const confirm = useCallback(
    (o: Opts) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );
  const close = (v: boolean) => {
    resolver.current(v);
    setOpts(null);
  };
  return (
    <Ctx.Provider value={confirm}>
      {children}
      <AlertDialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
            {opts?.description && <AlertDialogDescription className="whitespace-pre-line">{opts.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant={opts?.destructive ? 'destructive' : 'default'} onClick={() => close(true)}>
              {opts?.action ?? 'Continuar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
