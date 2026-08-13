import { useEffect } from 'react';
import { isDesktopRuntime } from '@/services/runtime';
import { mlWorker } from '@/services/ml-worker';
import { getAiFlowSettings, subscribeAiFlowChange, isHeadlineMemoryEnabled } from '@/services/ai-flow-settings';
import { BETA_MODE } from '@/config/beta';

export function useMlWorker(): void {
  useEffect(() => {
    const aiFlow = getAiFlowSettings();
    if (aiFlow.browserModel || isDesktopRuntime()) {
      void mlWorker.init();
      if (BETA_MODE) mlWorker.loadModel('summarization-beta').catch(() => {});
    }

    if (isHeadlineMemoryEnabled()) {
      mlWorker.init().then(ok => {
        if (ok) mlWorker.loadModel('embeddings').catch(() => {});
      }).catch(() => {});
    }

    const unsubAiFlow = subscribeAiFlowChange((key) => {
      if (key === 'browserModel') {
        const s = getAiFlowSettings();
        if (s.browserModel) {
          mlWorker.init().then(ok => {
            if (ok && isHeadlineMemoryEnabled()) {
              mlWorker.loadModel('embeddings').catch(() => {});
            }
          }).catch(() => {});
        } else if (!isDesktopRuntime()) {
          mlWorker.terminate();
        }
      }
      if (key === 'headlineMemory') {
        if (isHeadlineMemoryEnabled()) {
          mlWorker.init().then(ok => {
            if (ok) mlWorker.loadModel('embeddings').catch(() => {});
          }).catch(() => {});
        } else {
          mlWorker.unloadModel('embeddings').catch(() => {});
          const s = getAiFlowSettings();
          if (!s.browserModel && !isDesktopRuntime()) {
            mlWorker.terminate();
          }
        }
      }
    });

    return () => {
      unsubAiFlow();
      mlWorker.terminate();
    };
  }, []);
}
