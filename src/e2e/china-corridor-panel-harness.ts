import '../styles/main.css';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ChinaCorridorPanelContent } from '@/components/panels/ChinaCorridorPanel';
import { setRendererCapability } from '@/services/china-corridor-store';
import {
  CHINA_CORRIDOR_SIGNAL_FAMILIES,
  CHINA_LOGISTICS_CORRIDORS,
  type ChinaCorridorSignalFamily,
} from '../../shared/china-logistics-corridors';
import type {
  ChinaCorridorCondition,
  ChinaCorridorControlTowerResponse,
  CorridorSourceSignal,
} from '../../shared/china-corridor-control-towers';

declare global {
  interface Window {
    __chinaCorridorPanelHarness?: {
      selectedCorridorId: string | null;
      rendererSupportsOverlay: boolean | null;
      switchRenderer: (renderer: 'deck' | 'globe' | 'svg') => void;
      ready: boolean;
    };
  }
}

const observedAt = '2026-07-25T10:00:00.000Z';

function signal(family: ChinaCorridorSignalFamily): CorridorSourceSignal {
  return {
    id: `signal:test:${family}`,
    family,
    selectorId: `test:${family}`,
    availability: 'available',
    publisher: {
      id: 'publisher:test',
      name: family === 'hazard' ? '<script>unsafe publisher</script>' : `Reviewed ${family} publisher`,
      type: 'official',
    },
    sourceUrl: 'https://example.com/source',
    sourceScope: 'regional',
    observationTime: observedAt,
    observationTimePrecision: 'instant',
    releaseTime: '2026-07-25T10:02:00.000Z',
    releaseTimePrecision: 'instant',
    retrievalTime: '2026-07-25T10:05:00.000Z',
    retrievalTimePrecision: 'instant',
    revision: null,
    transportFreshness: 'fresh',
    contentFreshness: 'current',
    summary: family === 'hazard' ? '<img src=x onerror=alert(1)> unsafe title' : `Reviewed ${family} condition`,
    metrics: {},
  };
}

function condition(family: ChinaCorridorSignalFamily): ChinaCorridorCondition {
  const unavailable = family === 'strategic_industry';
  return {
    family,
    providerId: `provider:${family}`,
    availability: unavailable ? 'unavailable' : family === 'hazard' ? 'stale' : 'available',
    reason: unavailable ? 'No reviewed source observation is present.' : null,
    sourceSignals: unavailable ? [] : [signal(family)],
    provenance: null,
  };
}

const response: ChinaCorridorControlTowerResponse = {
  generatedAt: '2026-07-25T12:00:00.000Z',
  corridors: CHINA_LOGISTICS_CORRIDORS.map((definition, index) => ({
    ...definition,
    availability: index === 1 ? 'stale' : 'partial',
    conditions: CHINA_CORRIDOR_SIGNAL_FAMILIES.map(condition),
  })),
};

// Mock the supply-chain API endpoint so the React component renders with test data
const originalFetch = (...args: Parameters<typeof fetch>) => fetch(...args);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : (input as Request).url;
  if (url.includes('get-china-corridor-control-towers')) {
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return originalFetch(input as RequestInfo, init);
};

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app');

const params = new URLSearchParams(window.location.search);
const rendererParam = params.get('renderer') ?? 'deck';

const harness = {
  selectedCorridorId: null as string | null,
  rendererSupportsOverlay: rendererParam === 'pending-deck' ? null : rendererParam === 'deck',
  switchRenderer: (kind: 'deck' | 'globe' | 'svg') => {
    setRendererCapability(kind === 'deck');
    harness.rendererSupportsOverlay = kind === 'deck';
  },
  ready: false,
};
window.__chinaCorridorPanelHarness = harness;

// Set initial renderer capability via the store
if (rendererParam !== 'pending-deck') {
  setRendererCapability(rendererParam === 'deck');
}

// Track corridor selection from the React component's custom event
window.addEventListener('wm:corridor-select', (e) => {
  harness.selectedCorridorId = (e as CustomEvent<{ corridor: { id: string } }>).detail.corridor.id;
});

createRoot(app).render(createElement(ChinaCorridorPanelContent));

// Mark ready after React has had a chance to render with the mocked data
requestAnimationFrame(() => {
  harness.ready = true;
});
