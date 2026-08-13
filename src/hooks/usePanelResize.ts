import { useCallback, useEffect, useRef, useState } from 'react';

const STEP_PX = 80;
const MIN_ROW = 1;
const MAX_ROW = 4;
const MIN_COL = 1;
const MAX_COL = 3;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function loadSpan(panelId: string, key: 'row' | 'col', defaultVal: number): number {
  try {
    const raw = localStorage.getItem(`wm-panel-span-${panelId}-${key}`);
    const parsed = raw ? parseInt(raw, 10) : defaultVal;
    return Number.isFinite(parsed) ? parsed : defaultVal;
  } catch {
    return defaultVal;
  }
}

function saveSpan(panelId: string, key: 'row' | 'col', val: number): void {
  try {
    localStorage.setItem(`wm-panel-span-${panelId}-${key}`, String(val));
  } catch { /* storage unavailable */ }
}

interface UsePanelResizeResult {
  rowSpan: number;
  colSpan: number;
  isResizing: boolean;
  rowHandleProps: React.HTMLAttributes<HTMLElement>;
  colHandleProps: React.HTMLAttributes<HTMLElement>;
}

export function usePanelResize(
  panelId: string,
  defaultRowSpan = 2,
  defaultColSpan = 1,
): UsePanelResizeResult {
  const [rowSpan, setRowSpan] = useState(() => loadSpan(panelId, 'row', defaultRowSpan));
  const [colSpan, setColSpan] = useState(() => loadSpan(panelId, 'col', defaultColSpan));
  const [isResizing, setIsResizing] = useState(false);

  const dragState = useRef<{
    axis: 'row' | 'col';
    startY: number;
    startX: number;
    startSpan: number;
  } | null>(null);

  const onRowMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientY = 'touches' in e ? e.touches[0]!.clientY : e.clientY;
    dragState.current = { axis: 'row', startY: clientY, startX: 0, startSpan: rowSpan };
    setIsResizing(true);
    document.body.classList.add('panel-resize-active');
  }, [rowSpan]);

  const onColMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0]!.clientX : e.clientX;
    dragState.current = { axis: 'col', startY: 0, startX: clientX, startSpan: colSpan };
    setIsResizing(true);
    document.body.classList.add('panel-resize-active');
  }, [colSpan]);

  useEffect(() => {
    function handleMove(e: MouseEvent | TouchEvent): void {
      if (!dragState.current) return;
      const { axis, startY, startX, startSpan } = dragState.current;
      if (axis === 'row') {
        const clientY = 'touches' in e ? (e as TouchEvent).touches[0]!.clientY : (e as MouseEvent).clientY;
        const delta = Math.round((clientY - startY) / STEP_PX);
        setRowSpan(clamp(startSpan + delta, MIN_ROW, MAX_ROW));
      } else {
        const clientX = 'touches' in e ? (e as TouchEvent).touches[0]!.clientX : (e as MouseEvent).clientX;
        const delta = Math.round((clientX - startX) / STEP_PX);
        setColSpan(clamp(startSpan + delta, MIN_COL, MAX_COL));
      }
    }

    function handleUp(): void {
      if (!dragState.current) return;
      const { axis } = dragState.current;
      dragState.current = null;
      setIsResizing(false);
      document.body.classList.remove('panel-resize-active');
      if (axis === 'row') {
        setRowSpan(prev => { saveSpan(panelId, 'row', prev); return prev; });
      } else {
        setColSpan(prev => { saveSpan(panelId, 'col', prev); return prev; });
      }
    }

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleUp);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
  }, [panelId]);

  const rowHandleProps: React.HTMLAttributes<HTMLElement> = {
    onMouseDown: onRowMouseDown as React.MouseEventHandler,
    onTouchStart: onRowMouseDown as React.TouchEventHandler,
    onDoubleClick: () => {
      setRowSpan(defaultRowSpan);
      saveSpan(panelId, 'row', defaultRowSpan);
    },
  };

  const colHandleProps: React.HTMLAttributes<HTMLElement> = {
    onMouseDown: onColMouseDown as React.MouseEventHandler,
    onTouchStart: onColMouseDown as React.TouchEventHandler,
  };

  return { rowSpan, colSpan, isResizing, rowHandleProps, colHandleProps };
}
