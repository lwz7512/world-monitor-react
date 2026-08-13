import { getAlertsNearLocation } from '@/services/geo-convergence';
import type { ClusteredEvent } from '@/types';

// 0-100 event risk score: 0.40×severity + 0.30×geoConvergence + 0.30×CII
// CII component omitted until lat/lon→country lookup is added; weights rebalanced to 0.57+0.43
export function computeEventRisk(cluster: ClusteredEvent): number | null {
  if (!cluster.threat) return null;
  const levelScore: Record<string, number> = {
    critical: 95,
    high: 75,
    medium: 50,
    low: 25,
    info: 10,
  };
  const severity = (levelScore[cluster.threat.level] ?? 10) * (cluster.threat.confidence ?? 1);

  const geoAlert =
    cluster.lat != null && cluster.lon != null
      ? getAlertsNearLocation(cluster.lat, cluster.lon, 500)
      : null;
  const geoScore = geoAlert?.score ?? 0;

  // Rebalanced (CII pending): 0.57×severity + 0.43×geoConvergence
  return Math.round(0.57 * severity + 0.43 * geoScore);
}
