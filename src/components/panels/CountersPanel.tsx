import { useEffect, useRef } from 'react';
import {
  COUNTER_METRICS,
  getCounterValue,
  formatCounterValue,
} from '@/services/humanity-counters';
import { isDesktopRuntime } from '@/services/runtime';
import { PanelShell } from '@/components/PanelShell';
import { t } from '@/services/i18n';

// ── Constants ─────────────────────────────────────────────────────────────────

const DESKTOP_THROTTLE_MS = 250;

// ── Main panel content ────────────────────────────────────────────────────────

/**
 * Content-only component — rendered inside CountersPanelBridge's content div.
 *
 * Counter values are updated via direct DOM textContent writes in the rAF loop
 * (not React state) to avoid 60fps re-renders. valueRefs holds refs to the
 * value <div> elements for each metric, populated via the ref callback.
 */
export function CountersPanelContent() {
  const desktopMode = isDesktopRuntime();
  const frameIdRef = useRef<number | null>(null);
  const lastUpdateRef = useRef(0);
  const valueRefs = useRef<Map<string, HTMLElement>>(new Map());

  // rAF animation loop
  useEffect(() => {
    const tick = () => {
      if (desktopMode) {
        const now = performance.now();
        if (now - lastUpdateRef.current < DESKTOP_THROTTLE_MS) {
          frameIdRef.current = requestAnimationFrame(tick);
          return;
        }
        lastUpdateRef.current = now;
      }
      for (const metric of COUNTER_METRICS) {
        const el = valueRefs.current.get(metric.id);
        if (el) el.textContent = formatCounterValue(getCounterValue(metric), metric.formatPrecision);
      }
      frameIdRef.current = requestAnimationFrame(tick);
    };

    if (!desktopMode || !document.hidden) {
      frameIdRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    };
  }, [desktopMode]);

  // Desktop: pause on hidden, resume on visible
  useEffect(() => {
    if (!desktopMode) return;

    const tick = () => {
      const now = performance.now();
      if (now - lastUpdateRef.current < DESKTOP_THROTTLE_MS) {
        frameIdRef.current = requestAnimationFrame(tick);
        return;
      }
      lastUpdateRef.current = now;
      for (const metric of COUNTER_METRICS) {
        const el = valueRefs.current.get(metric.id);
        if (el) el.textContent = formatCounterValue(getCounterValue(metric), metric.formatPrecision);
      }
      frameIdRef.current = requestAnimationFrame(tick);
    };

    const handler = () => {
      if (document.hidden) {
        if (frameIdRef.current !== null) {
          cancelAnimationFrame(frameIdRef.current);
          frameIdRef.current = null;
        }
      } else {
        lastUpdateRef.current = 0;
        if (frameIdRef.current === null) {
          frameIdRef.current = requestAnimationFrame(tick);
        }
      }
    };

    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [desktopMode]);

  return (
    <div className="counters-grid">
      {COUNTER_METRICS.map(metric => (
        <div key={metric.id} className="counter-card">
          <div className="counter-icon">{metric.icon}</div>
          <div
            className="counter-value"
            data-counter={metric.id}
            ref={el => {
              if (el) valueRefs.current.set(metric.id, el);
              else valueRefs.current.delete(metric.id);
            }}
          >
            {formatCounterValue(getCounterValue(metric), metric.formatPrecision)}
          </div>
          <div className="counter-label">{metric.label}</div>
          <div className="counter-source">{metric.source}</div>
        </div>
      ))}
    </div>
  );
}

export function CountersPanel() {
  return (
    <PanelShell
      id="counters"
      title="Live Counters"
      infoTooltip={t('components.counters.infoTooltip')}
    >
      <CountersPanelContent />
    </PanelShell>
  );
}
