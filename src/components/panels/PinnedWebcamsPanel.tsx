import { useState, useEffect } from 'react';
import { t } from '@/services/i18n';
import {
  getPinnedWebcams,
  getActiveWebcams,
  unpinWebcam,
  toggleWebcam,
  onPinnedChange,
} from '@/services/webcams/pinned-store';
import { PanelShell } from '@/components/PanelShell';

const MAX_SLOTS = 4;
const PLAYER_FALLBACK = 'https://webcams.windy.com/webcams/public/embed/player';

function buildPlayerUrl(webcamId: string, playerUrl?: string): string {
  if (playerUrl) return playerUrl;
  return `${PLAYER_FALLBACK}/${encodeURIComponent(webcamId)}/day`;
}

export function PinnedWebcamsPanelContent() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = onPinnedChange(() => setTick(t => t + 1));
    return unsub;
  }, []);

  const active = getActiveWebcams();
  const allPinned = getPinnedWebcams();

  return (
    <div className="pinned-webcams-content">
      <div className="pinned-webcams-grid">
        {Array.from({ length: MAX_SLOTS }, (_, i) => {
          const cam = active[i];
          if (!cam) {
            return (
              <div key={i} className="pinned-webcam-slot pinned-webcam-slot--empty">
                <div className="pinned-webcam-placeholder">
                  {t('components.pinnedWebcams.pinFromMap') ?? 'Pin a webcam from the map'}
                </div>
              </div>
            );
          }
          return (
            <div key={cam.webcamId} className="pinned-webcam-slot">
              <iframe
                className="pinned-webcam-iframe"
                src={buildPlayerUrl(cam.webcamId, cam.playerUrl)}
                sandbox="allow-scripts allow-same-origin allow-popups"
                frameBorder="0"
                title={cam.title || cam.webcamId}
                allow="autoplay; encrypted-media"
                allowFullScreen
                loading="lazy"
              />
              <div className="pinned-webcam-label">
                <span className="pinned-webcam-title">{cam.title || cam.webcamId}</span>
                <button
                  className="pinned-webcam-toggle"
                  title="Hide stream"
                  onClick={() => toggleWebcam(cam.webcamId)}
                >
                  ⏸
                </button>
                <button
                  className="pinned-webcam-unpin"
                  title="Unpin"
                  onClick={() => unpinWebcam(cam.webcamId)}
                >
                  ✖
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {allPinned.length > MAX_SLOTS && (
        <div className="pinned-webcams-list">
          <div className="pinned-webcams-list-header">Pinned ({allPinned.length})</div>
          {allPinned.map(cam => (
            <div
              key={cam.webcamId}
              className={`pinned-webcam-row${cam.active ? ' pinned-webcam-row--active' : ''}`}
            >
              <span className="pinned-webcam-row-name">{cam.title || cam.webcamId}</span>
              <span className="pinned-webcam-row-country">{cam.country}</span>
              <button
                className="pinned-webcam-row-toggle"
                onClick={() => toggleWebcam(cam.webcamId)}
              >
                {cam.active ? 'ON' : 'OFF'}
              </button>
              <button
                className="pinned-webcam-row-remove"
                title="Unpin"
                onClick={() => unpinWebcam(cam.webcamId)}
              >
                ✖
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PinnedWebcamsPanel() {
  return (
    <PanelShell
      id="windy-webcams"
      title={t('panels.windyWebcams')}
      className="panel-wide"
    >
      <PinnedWebcamsPanelContent />
    </PanelShell>
  );
}
