import {create} from 'zustand';
import {read, write} from './storage';
import type {StudioState} from './studio.types';

export const useStudioStore = create<StudioState>()((set, get) => ({
  open: read('studio.agent.open', '1') === '1',
  setOpen: (o) => {
    set({open: o});
    write('studio.agent.open', o ? '1' : '0');
  },
  toggleOpen: () => get().setOpen(!get().open),

  sideOpen: read('studio.sidebar.open', '1') === '1',
  setSideOpen: (o) => {
    set({sideOpen: o});
    write('studio.sidebar.open', o ? '1' : '0');
  },
  toggleSideOpen: () => get().setSideOpen(!get().sideOpen),

  sideWidth: Number(read('studio.sidebar.width', '')) || null,
  setSideWidth: (w, keep = true) => {
    set({sideWidth: w});
    if (keep) write('studio.sidebar.width', w ? String(Math.round(w)) : '');
  },

  chatWidth: Number(read('studio.agent.width', '')) || null,
  // keep: remember it (at the end of a drag, not on every move).
  setChatWidth: (w, keep = true) => {
    set({chatWidth: w});
    if (keep) write('studio.agent.width', w ? String(Math.round(w)) : '');
  },

  comments: {},
  // A new timeline comment goes to the reel's conversation: show it.
  addComment: (slug, c) => {
    set((s) => ({comments: {...s.comments, [slug]: [...(s.comments[slug] ?? []), c]}}));
    get().setOpen(true);
  },
  removeComment: (slug, id) => set((s) => ({comments: {...s.comments, [slug]: (s.comments[slug] ?? []).filter((c) => c.id !== id)}})),
  clearComments: (slug) => set((s) => ({comments: {...s.comments, [slug]: []}})),

  seekRef: {current: () => {}},
  uiRef: {current: {page: 'library'}},

  // "Usar como referencia": attach it to the general conversation and show the panel.
  refs: [],
  addRef: (r) => {
    set((s) => ({refs: s.refs.some((x) => x.account === r.account && x.code === r.code) ? s.refs : [...s.refs, r]}));
    get().setOpen(true);
  },
  removeRef: (r) => set((s) => ({refs: s.refs.filter((x) => !(x.account === r.account && x.code === r.code))})),
  clearRefs: () => set({refs: []}),

  // "Adjuntar al chat": the same, for an idea.
  ideaRefs: [],
  addIdeaRef: (r) => {
    set((s) => ({ideaRefs: s.ideaRefs.some((x) => x.id === r.id) ? s.ideaRefs : [...s.ideaRefs, r]}));
    get().setOpen(true);
  },
  removeIdeaRef: (id) => set((s) => ({ideaRefs: s.ideaRefs.filter((x) => x.id !== id)})),
  clearIdeaRefs: () => set({ideaRefs: []}),

  // "Agregar al chat" on the reel page: the same, for its audience check.
  audits: [],
  addAudit: (slug, kind) => {
    set((s) => ({audits: s.audits.includes(`${kind}/${slug}`) ? s.audits : [...s.audits, `${kind}/${slug}`]}));
    get().setOpen(true);
  },
  removeAudit: (slug, kind) => set((s) => ({audits: s.audits.filter((x) => (kind ? x !== `${kind}/${slug}` : !x.endsWith(`/${slug}`)))})),

  reelTitle: null,
  setReelTitle: (t) => set({reelTitle: t}),
}));
