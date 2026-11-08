import type {Comment, IdeaRef, InspirationRef, UiContext} from '../api';

export type AuditKind = 'audience' | 'hook';

/** A mutable box read and written without re-rendering (like a React ref, but shared app-wide). */
export type Box<T> = {current: T};

// App-wide state shared by the pages and the always-present Claude panel: whether the panel is open,
// timeline comments waiting to be sent, how to seek the reel's player from a comment's timestamp, and
// where the creator is in the UI right now (sent with every message so the agent knows what he's looking at).
export type StudioState = {
  open: boolean;
  setOpen: (o: boolean) => void;
  toggleOpen: () => void;
  // The left sidebar: full, or contracted to a column of icons (lg+).
  sideOpen: boolean;
  setSideOpen: (o: boolean) => void;
  toggleSideOpen: () => void;
  // The sidebar's width when he dragged its edge (px); null: the default.
  sideWidth: number | null;
  setSideWidth: (w: number | null, keep?: boolean) => void;
  /** The sidebar's video list height (px), dragged from its top edge; null: whatever is left under the pages. */
  videosHeight: number | null;
  setVideosHeight: (h: number | null, keep?: boolean) => void;
  // The panel's width when he dragged its edge (px); null: the default for the screen.
  chatWidth: number | null;
  setChatWidth: (w: number | null, keep?: boolean) => void;
  comments: Record<string, Comment[]>;
  addComment: (slug: string, c: Comment) => void;
  removeComment: (slug: string, id: string) => void;
  clearComments: (slug: string) => void;
  seekRef: Box<(t: number) => void>;
  // Written by the pages as you move (no re-render); read when a message is sent.
  uiRef: Box<UiContext>;
  // Reels from Inspiración waiting to go with the next message of the general conversation.
  refs: InspirationRef[];
  addRef: (r: InspirationRef) => void;
  removeRef: (r: InspirationRef) => void;
  clearRefs: () => void;
  // Ideas waiting to go with the next message of the general conversation.
  ideaRefs: IdeaRef[];
  addIdeaRef: (r: IdeaRef) => void;
  removeIdeaRef: (id: string) => void;
  clearIdeaRefs: () => void;
  // Script reviews that go with the next message of their reel's conversation, as "<kind>/<slug>": Alineación con tu
  // audiencia (audience) and Fuerza del gancho (hook).
  audits: string[];
  addAudit: (slug: string, kind: AuditKind) => void;
  removeAudit: (slug: string, kind?: AuditKind) => void; // no kind: both
  // Name of the open reel, shown in the header (title.txt, or its slug).
  reelTitle: string | null;
  setReelTitle: (t: string | null) => void;
};
