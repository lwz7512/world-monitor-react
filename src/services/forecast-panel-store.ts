import type { Forecast, ForecastCase } from '@/generated/client/worldmonitor/forecast/v1/service_client';
import { mergeCachedCaseFiles, needsCaseFileRefetch } from '@/components/forecast-case-files';

export type { Forecast };

export interface ForecastSourceState {
  generatedAt: number;
  degraded: boolean;
  stale: boolean;
  error: string;
}

export interface SimulationPath {
  pathId: string;
  label: string;
  summary: string;
  confidence: number;
  keyActors: string[];
}

export interface SimulationTheater {
  theaterId: string;
  theaterLabel: string;
  stateKind: string;
  topPaths: SimulationPath[];
  dominantReactions: string[];
  stabilizers: string[];
  invalidators: string[];
}

type Listener<T> = (data: T) => void;

function makeChannel<T>(initial: T) {
  let _data = initial;
  const _subs = new Set<Listener<T>>();
  return {
    set(data: T): void { _data = data; for (const sub of _subs) sub(_data); },
    get(): T { return _data; },
    subscribe(cb: Listener<T>): () => void { _subs.add(cb); return () => { _subs.delete(cb); }; },
  };
}

export const forecastsChannel = makeChannel<Forecast[]>([]);
export const forecastSourceChannel = makeChannel<ForecastSourceState>({ generatedAt: 0, degraded: false, stale: false, error: '' });
export const forecastTheatersChannel = makeChannel<SimulationTheater[]>([]);
export const forecastCaseFilesChannel = makeChannel<Record<string, ForecastCase>>({});

// Module-level de-dupe guard for case file loading (not reactive)
let _caseFilesPromise: Promise<void> | null = null;
let _caseFilesFetchedIds = new Set<string>();
let _caseFilesSettled = false;

function parseTheaters(json: string): SimulationTheater[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (v): v is SimulationTheater =>
        v && typeof v === 'object' && typeof v.theaterId === 'string' && typeof v.theaterLabel === 'string',
    );
  } catch {
    return [];
  }
}

export const setForecastData = (
  forecasts: Forecast[],
  sourceState: Partial<ForecastSourceState>,
): void => {
  const caseFiles = forecastCaseFilesChannel.get();
  const caseFilesById = new Map(Object.entries(caseFiles)) as Map<string, ForecastCase>;
  const merged = mergeCachedCaseFiles(forecasts, caseFilesById);

  if (needsCaseFileRefetch(merged, _caseFilesFetchedIds, _caseFilesSettled)) {
    _caseFilesPromise = null;
    _caseFilesSettled = false;
    _caseFilesFetchedIds = new Set<string>();
  }

  forecastsChannel.set(merged);
  forecastSourceChannel.set({
    generatedAt: sourceState.generatedAt ?? 0,
    degraded: sourceState.degraded === true,
    stale: sourceState.stale === true,
    error: sourceState.error || '',
  });
};

export const setForecastSimulation = (theaterSummariesJson: string): void => {
  forecastTheatersChannel.set(parseTheaters(theaterSummariesJson));
};

export const loadForecastCaseFiles = async (): Promise<void> => {
  if (_caseFilesPromise) return _caseFilesPromise;

  _caseFilesPromise = (async () => {
    try {
      const { fetchForecastFeed } = await import('@/services/forecast');
      const feed = await fetchForecastFeed();
      const newCaseFiles: Record<string, ForecastCase> = { ...forecastCaseFilesChannel.get() };
      for (const f of feed.forecasts) {
        _caseFilesFetchedIds.add(f.id);
        if (f.caseFile) newCaseFiles[f.id] = f.caseFile;
      }
      _caseFilesSettled = true;
      forecastCaseFilesChannel.set(newCaseFiles);
      // Patch the forecasts channel so merged caseFile is visible on re-render
      forecastsChannel.set(
        forecastsChannel.get().map((f) => {
          const caseFile = newCaseFiles[f.id];
          return !f.caseFile && caseFile ? { ...f, caseFile } : f;
        }),
      );
    } catch {
      _caseFilesPromise = null;
    }
  })();

  return _caseFilesPromise;
};
