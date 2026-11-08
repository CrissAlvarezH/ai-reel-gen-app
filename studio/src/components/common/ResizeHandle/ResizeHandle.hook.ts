import {useRef, type PointerEvent} from 'react';
import type {ResizeHandleProps} from './ResizeHandle.types';
import {snapPoint} from './ResizeHandle.utils';

// Drag the edge to resize the column; drag it far enough in and it contracts to its mini width, and from there drag it
// out to open it again. While dragging, <html> gets .resizing (index.css): the cursor stays col-resize everywhere and
// the grid follows the pointer without animating, except when it snaps open or closed (.snapping lets that one animate).
export function useResizeHandle({edge, width, min, max, onResize, collapsed, collapsedWidth, onCollapse}: ResizeHandleProps) {
  const drag = useRef<{x: number; start: number; last: number; collapsed: boolean} | null>(null);
  const clamp = (w: number) => Math.round(Math.max(min, Math.min(max(), w)));

  const snap = (c: boolean) => {
    const root = document.documentElement;
    root.classList.add('snapping');
    window.setTimeout(() => root.classList.remove('snapping'), 340);
    onCollapse(c);
  };

  const end = () => {
    if (!drag.current) return;
    if (!drag.current.collapsed) onResize(drag.current.last, true);
    drag.current = null;
    document.documentElement.classList.remove('resizing');
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const open = width ?? e.currentTarget.parentElement!.getBoundingClientRect().width;
    const start = collapsed ? collapsedWidth : open;
    drag.current = {x: e.clientX, start, last: collapsed ? (width ?? min) : open, collapsed};
    document.documentElement.classList.add('resizing');
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const raw = d.start + (edge === 'right' ? dx : -dx);
    const shouldCollapse = raw < snapPoint(collapsedWidth, min);
    if (shouldCollapse !== d.collapsed) {
      d.collapsed = shouldCollapse;
      snap(shouldCollapse);
    }
    if (!shouldCollapse) {
      d.last = clamp(raw);
      onResize(d.last, false);
    }
  };

  return {onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end};
}
