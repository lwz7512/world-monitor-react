/**
 * Wire drag-and-drop reordering for a panel element.
 *
 * @param el              - The panel's root DOM element.
 * @param key             - The panel's ID (also written as el.dataset.panel).
 * @param bottomSetMemory - Mutable set tracking which panels are in the bottom grid.
 * @param savePanelOrder  - Called after a successful drop to persist the new order.
 * @param registerCleanup - Called with the cleanup handler so the caller can remove
 *                          listeners on teardown.
 */
export function makeDraggable(
  el: HTMLElement,
  key: string,
  bottomSetMemory: Set<string>,
  savePanelOrder: () => void,
  registerCleanup: (cleanup: () => void) => void,
): void {
  type DropPosition = {
    grid: HTMLElement;
    panel: HTMLElement | null;
    insertBefore: boolean;
  };

  el.dataset.panel = key;
  let isDragging = false;
  let dragStarted = false;
  let startX = 0;
  let startY = 0;
  let rafId = 0;
  let ghostEl: HTMLElement | null = null;
  let dropIndicator: HTMLElement | null = null;
  let originalParent: HTMLElement | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let originalIndex = -1;
  let originalRect: DOMRect | null = null;
  let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  const DRAG_THRESHOLD = 8;

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (el.dataset.resizing === 'true') return;
    if (
      target.classList?.contains('panel-resize-handle') ||
      target.closest?.('.panel-resize-handle') ||
      target.classList?.contains('panel-col-resize-handle') ||
      target.closest?.('.panel-col-resize-handle')
    ) return;
    if (target.closest('button, a, input, select, textarea')) return;

    isDragging = true;
    dragStarted = false;
    startX = e.clientX;
    startY = e.clientY;

    // Calculate offset within the element for smooth dragging
    const rect = el.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;

    e.preventDefault();
  };

  const createGhostElement = (): HTMLElement => {
    const ghost = el.cloneNode(true) as HTMLElement;
    // Strip iframes to prevent duplicate network requests and postMessage handlers
    ghost.querySelectorAll('iframe').forEach(ifr => ifr.remove());
    ghost.classList.add('panel-drag-ghost');
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10000';
    ghost.style.opacity = '0.8';
    ghost.style.boxShadow = '0 10px 40px rgba(0, 0, 0, 0.3)';
    ghost.style.transform = 'scale(1.02)';

    // Copy dimensions from original
    const rect = el.getBoundingClientRect();
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';

    document.body.appendChild(ghost);
    return ghost;
  };

  const createDropIndicator = (): HTMLElement => {
    const indicator = document.createElement('div');
    indicator.classList.add('panel-drop-indicator');
    // overlay on body so it doesn't shift grid children
    indicator.style.position = 'fixed';
    indicator.style.pointerEvents = 'none';
    indicator.style.zIndex = '9999';
    document.body.appendChild(indicator);
    return indicator;
  };

  const isWithinOriginalRect = (clientX: number, clientY: number) =>
    !!originalRect &&
    clientX >= originalRect.left &&
    clientX <= originalRect.right &&
    clientY >= originalRect.top &&
    clientY <= originalRect.bottom;

  const getAppendReference = (grid: HTMLElement): ChildNode | null => {
    if (grid.id !== 'panelsGrid') return null;
    return grid.querySelector('.add-panel-block');
  };

  const canAppendToGrid = (grid: HTMLElement, clientY: number): boolean => {
    if (grid !== originalParent) return true;
    const panelBottoms = Array.from(grid.children)
      .filter((child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child !== el &&
        child.classList.contains('panel') &&
        !child.classList.contains('hidden'),
      )
      .map((panel) => panel.getBoundingClientRect().bottom);
    if (panelBottoms.length === 0) return false;
    return clientY > Math.max(...panelBottoms);
  };

  const commitDrop = (dropPos: DropPosition, clientX: number, clientY: number): boolean => {
    const { grid, panel, insertBefore } = dropPos;

    if (panel) {
      if (panel === el || panel.parentElement !== grid) return false;

      if (insertBefore) {
        if (el.nextSibling === panel) return false;
      } else {
        if (panel.nextSibling === el) return false;
      }

      const referenceNode = insertBefore ? panel : panel.nextSibling;
      if (referenceNode && referenceNode.parentNode !== grid) return false;

      grid.insertBefore(el, referenceNode);
      return true;
    }

    if (grid === originalParent && isWithinOriginalRect(clientX, clientY)) {
      return false;
    }
    if (!canAppendToGrid(grid, clientY)) return false;

    const referenceNode = getAppendReference(grid);
    if (referenceNode && referenceNode.parentNode !== grid) return false;
    if (referenceNode === el) return false;
    if (el.parentElement === grid && el.nextSibling === referenceNode) return false;

    grid.insertBefore(el, referenceNode);
    return true;
  };

  const updateGhostPosition = (clientX: number, clientY: number) => {
    if (!ghostEl) return;
    ghostEl.style.left = (clientX - dragOffsetX) + 'px';
    ghostEl.style.top = (clientY - dragOffsetY) + 'px';
  };

  const findDropPosition = (clientX: number, clientY: number): DropPosition | null => {
    const grid = document.getElementById('panelsGrid');
    const bottomGrid = document.getElementById('mapBottomGrid');
    if (!grid || !bottomGrid) return null;

    // Temporarily hide the ghost to get accurate hit detection
    const prevPointerEvents = ghostEl?.style.pointerEvents;
    if (ghostEl) ghostEl.style.pointerEvents = 'none';
    const target = document.elementFromPoint(clientX, clientY);
    if (ghostEl && typeof prevPointerEvents === 'string') ghostEl.style.pointerEvents = prevPointerEvents;

    if (!target) return null;

    const targetGrid = (target.closest('.panels-grid') || target.closest('.map-bottom-grid')) as HTMLElement | null;
    const targetPanel = target.closest('.panel') as HTMLElement | null;

    if (!targetGrid && !targetPanel) return null;

    const currentTargetGrid = targetGrid || (targetPanel ? targetPanel.parentElement as HTMLElement : null);
    if (!currentTargetGrid || (currentTargetGrid !== grid && currentTargetGrid !== bottomGrid)) return null;
    const panel = targetPanel && targetPanel !== el ? targetPanel : null;
    let insertBefore = false;
    if (panel) {
      const panelRect = panel.getBoundingClientRect();
      insertBefore = clientY < panelRect.top + panelRect.height / 2;
    }

    return {
      grid: currentTargetGrid,
      panel,
      insertBefore,
    };
  };

  let lastTargetPanel: HTMLElement | null = null;

  const updateDropIndicator = (clientX: number, clientY: number) => {
    const dropPos = findDropPosition(clientX, clientY);
    if (!dropPos) {
      if (dropIndicator) dropIndicator.style.opacity = '0';
      if (lastTargetPanel) {
        lastTargetPanel.classList.remove('panel-drop-target');
        lastTargetPanel = null;
      }
      return;
    }

    const { grid, panel, insertBefore } = dropPos;
    if (!dropIndicator) return;

    const noOpEmptyDrop = !panel &&
      ((grid === originalParent && isWithinOriginalRect(clientX, clientY)) || !canAppendToGrid(grid, clientY));
    if (noOpEmptyDrop) {
      dropIndicator.style.opacity = '0';
      if (lastTargetPanel) {
        lastTargetPanel.classList.remove('panel-drop-target');
        lastTargetPanel = null;
      }
      return;
    }

    // highlight hovered panel
    if (panel !== lastTargetPanel) {
      if (lastTargetPanel) lastTargetPanel.classList.remove('panel-drop-target');
      if (panel) panel.classList.add('panel-drop-target');
      lastTargetPanel = panel;
    }

    // compute absolute coordinates for the indicator
    let top = 0;
    let left = 0;
    let width = 0;

    if (panel) {
      const panelRect = panel.getBoundingClientRect();
      width = panelRect.width;
      left = panelRect.left;
      top = insertBefore ? panelRect.top - 4 : panelRect.bottom;
    } else {
      // dropping into empty grid: position at grid bottom
      const gridRect = grid.getBoundingClientRect();
      width = gridRect.width;
      left = gridRect.left;
      top = gridRect.bottom;
    }

    dropIndicator.style.width = width + 'px';
    dropIndicator.style.left = left + 'px';
    dropIndicator.style.top = top + 'px';
    dropIndicator.style.opacity = '0.8';
  };

  let lastX = 0;
  let lastY = 0;

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    if (!dragStarted) {
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      dragStarted = true;

      // Initialize drag visualization
      document.body.classList.add('panel-drag-active');
      el.classList.add('dragging-source');
      originalParent = el.parentElement as HTMLElement;
      originalIndex = Array.from(originalParent.children).indexOf(el);
      originalRect = el.getBoundingClientRect();
      ghostEl = createGhostElement();
      dropIndicator = createDropIndicator();
      onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          // Cancel drag and restore original position
          document.body.classList.remove('panel-drag-active');
          el.classList.remove('dragging-source');
          if (ghostEl) {
            ghostEl.style.opacity = '0';
            const g = ghostEl;
            setTimeout(() => g.remove(), 200);
            ghostEl = null;
          }
          if (dropIndicator) {
            dropIndicator.style.opacity = '0';
            const d = dropIndicator;
            setTimeout(() => d.remove(), 200);
            dropIndicator = null;
          }
          if (lastTargetPanel) {
            lastTargetPanel.classList.remove('panel-drop-target');
            lastTargetPanel = null;
          }

          if (originalParent && originalIndex >= 0) {
            const children = Array.from(originalParent.children);
            const insertBefore = children[originalIndex];
            if (insertBefore) {
              originalParent.insertBefore(el, insertBefore);
            } else {
              originalParent.appendChild(el);
            }
          }

          document.removeEventListener('keydown', onKeyDown!, true);
          onKeyDown = null;
          isDragging = false;
          dragStarted = false;
          originalRect = null;
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        }
      };
      document.addEventListener('keydown', onKeyDown, true);
    }

    lastX = e.clientX;
    lastY = e.clientY;
    const cx = e.clientX;
    const cy = e.clientY;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (dragStarted) {
        updateGhostPosition(cx, cy);
        updateDropIndicator(cx, cy);
      }
      rafId = 0;
    });
  };

  const onMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }

    if (dragStarted) {
      // Find final drop position using most recent cursor coords
      const dropPos = findDropPosition(lastX, lastY);
      const moved = dropPos ? commitDrop(dropPos, lastX, lastY) : false;

      // Clean up drag visualization (panel-drag-active is cleared unconditionally below)
      el.classList.remove('dragging-source');
      if (ghostEl) {
        ghostEl.style.opacity = '0';
        const g = ghostEl;
        setTimeout(() => g.remove(), 200);
        ghostEl = null;
      }
      if (dropIndicator) {
        dropIndicator.style.opacity = '0';
        const d = dropIndicator;
        setTimeout(() => d.remove(), 200);
        dropIndicator = null;
      }
      if (lastTargetPanel) {
        lastTargetPanel.classList.remove('panel-drop-target');
        lastTargetPanel = null;
      }

      if (moved) {
        const isInBottom = !!el.closest('.map-bottom-grid');
        if (isInBottom) {
          bottomSetMemory.add(key);
        } else {
          bottomSetMemory.delete(key);
        }
        savePanelOrder();
      }
    }
    dragStarted = false;
    document.body.classList.remove('panel-drag-active');
    originalRect = null;
    if (onKeyDown) {
      document.removeEventListener('keydown', onKeyDown, true);
      onKeyDown = null;
    }
  };

  el.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  registerCleanup(() => {
    el.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    if (onKeyDown) {
      document.removeEventListener('keydown', onKeyDown, true);
      onKeyDown = null;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (ghostEl) ghostEl.remove();
    if (dropIndicator) dropIndicator.remove();
    isDragging = false;
    dragStarted = false;
    document.body.classList.remove('panel-drag-active');
    originalRect = null;
    el.classList.remove('dragging-source');
  });
}
