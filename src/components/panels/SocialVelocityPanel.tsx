import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { fetchSocialVelocity, type SocialVelocityPost } from '@/services/social-velocity';
import { sanitizeUrl } from '@/utils/sanitize';
import { PanelShell } from '@/components/PanelShell';

function relativeTime(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function velocityColor(score: number): string {
  if (score >= 80) return '#e74c3c';
  if (score >= 50) return '#e67e22';
  if (score >= 25) return '#f1c40f';
  return '#27ae60';
}

function formatScore(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface PostData { posts: SocialVelocityPost[] }

async function fetcher(_signal: AbortSignal): Promise<PostData> {
  const data = await fetchSocialVelocity();
  const posts = [...(data.posts ?? [])].sort((a, b) => b.velocityScore - a.velocityScore);
  return { posts };
}

export function SocialVelocityPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, { ttlMs: 5 * 60 * 1000 });

  if (loading) return <div className="panel-loading" />;

  if (error || !data?.posts?.length) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? 'No signal data available'}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const posts = data.posts;
  return (
    <div>
      <div style={{ overflowY: 'auto', maxHeight: 440 }}>
        {posts.slice(0, 20).map((p, i) => {
          const age = relativeTime(p.createdAt);
          const vColor = velocityColor(p.velocityScore);
          const ratio = Math.round(p.upvoteRatio * 100);
          const barWidth = Math.max(4, Math.round(p.velocityScore));
          return (
            <div key={`${p.url}-${i}`} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', minWidth: 18, textAlign: 'right', marginTop: 2 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a
                    href={sanitizeUrl(p.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', textDecoration: 'none', lineHeight: 1.35, display: 'block' }}
                  >
                    {p.title}
                  </a>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }}>r/{p.subreddit}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>▲ {formatScore(p.score)}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>💬 {formatScore(p.numComments)}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{ratio}% up</span>
                    {age && <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{age}</span>}
                  </div>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: vColor }}>{Math.round(p.velocityScore)}</span>
                  <div style={{ width: 32, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
                    <div style={{ height: '100%', width: `${barWidth}%`, maxWidth: '100%', borderRadius: 2, background: vColor }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-dim)' }}>Reddit · velocity = recency × score × ratio</div>
    </div>
  );
}

export function SocialVelocityPanel() {
  return (
    <PanelShell
      id="social-velocity"
      title="Social Velocity"
      infoTooltip={t('components.socialVelocity.infoTooltip')}
    >
      <SocialVelocityPanelContent />
    </PanelShell>
  );
}
