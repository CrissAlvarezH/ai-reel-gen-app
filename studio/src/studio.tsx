import {useEffect} from 'react';
import {projectsApi, type UiContext} from './api';
import {useStudioStore} from './store/useStudioStore';
import {read, write} from './store/storage';

// App-wide state now lives in a zustand store (store/useStudioStore.ts). This module keeps the names the
// pages already import (useStudio, StudioProvider, read/write, projectKey), so they don't need to change.

export type {AuditKind} from './store/studio.types';
export type {UiContext};
export {read, write};

// The project open, known before the first render (main.tsx) and the same until the page reloads, which it does when
// it changes. Preferences of a project are kept under projectKey; those of this window (panels) aren't.
let openProject: string | null = null;
export const loadOpenProject = () =>
  projectsApi.list().then(
    (all) => void (openProject = all.find((p) => p.current)?.id ?? null),
    () => {},
  );
export const projectKey = (k: string) => (openProject ? `${k}.${openProject}` : k);

/** The whole studio state (re-renders on any change, like the context it replaced). */
export const useStudio = () => useStudioStore();

// ⌘J / Ctrl+J opens or collapses the panel from anywhere; ⌘B / Ctrl+B, the left sidebar.
export function StudioProvider({children}: {children: React.ReactNode}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === 'j') {
        e.preventDefault();
        useStudioStore.getState().toggleOpen();
      }
      if (k === 'b') {
        e.preventDefault();
        useStudioStore.getState().toggleSideOpen();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  return <>{children}</>;
}
