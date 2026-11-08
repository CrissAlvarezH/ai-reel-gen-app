export interface ResizeHandleProps {
  /** Which edge of its (positioned) parent it sits on: the sidebar's right edge, the panel's left one. */
  edge: 'left' | 'right';
  /** The column's width now (px); null: whatever it measures. */
  width: number | null;
  min: number;
  /** Largest width, as a function so it can follow the window. */
  max: () => number;
  /** keep: false while dragging (don't save every move), true at the end. */
  onResize: (width: number, keep: boolean) => void;
  /** Double click: back to the default width. */
  onReset: () => void;
  /** Contracted to its mini width (icons / rail). Dragging below the halfway point between mini and min contracts it;
   *  dragging a contracted one past that point opens it again. */
  collapsed: boolean;
  collapsedWidth: number;
  onCollapse: (collapsed: boolean) => void;
  label: string;
}
