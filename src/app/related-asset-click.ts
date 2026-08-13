import type { AppContext } from '@/app/app-context';
import type { RelatedAsset } from '@/types';
import type { NewsPanel } from '@/components/NewsPanel';
import { saveToStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';

export function attachRelatedAssetHandlers(panel: NewsPanel, ctx: AppContext): void {
  panel.setRelatedAssetHandlers({
    onRelatedAssetClick: (asset) => handleRelatedAssetClick(asset, ctx),
    onRelatedAssetsFocus: (assets) => ctx.map?.highlightAssets(assets),
    onRelatedAssetsClear: () => ctx.map?.highlightAssets(null),
  });
}

export function handleRelatedAssetClick(asset: RelatedAsset, ctx: AppContext): void {
  if (!ctx.map) return;

  switch (asset.type) {
    case 'pipeline':
      ctx.map.enableLayer('pipelines');
      ctx.mapLayers.pipelines = true;
      saveToStorage(STORAGE_KEYS.mapLayers, ctx.mapLayers);
      ctx.map.triggerPipelineClick(asset.id);
      break;
    case 'cable':
      ctx.map.enableLayer('cables');
      ctx.mapLayers.cables = true;
      saveToStorage(STORAGE_KEYS.mapLayers, ctx.mapLayers);
      ctx.map.triggerCableClick(asset.id);
      break;
    case 'datacenter':
      ctx.map.enableLayer('datacenters');
      ctx.mapLayers.datacenters = true;
      saveToStorage(STORAGE_KEYS.mapLayers, ctx.mapLayers);
      ctx.map.triggerDatacenterClick(asset.id);
      break;
    case 'base':
      ctx.map.enableLayer('bases');
      ctx.mapLayers.bases = true;
      saveToStorage(STORAGE_KEYS.mapLayers, ctx.mapLayers);
      ctx.map.triggerBaseClick(asset.id);
      break;
    case 'nuclear':
      ctx.map.enableLayer('nuclear');
      ctx.mapLayers.nuclear = true;
      saveToStorage(STORAGE_KEYS.mapLayers, ctx.mapLayers);
      ctx.map.triggerNuclearClick(asset.id);
      break;
  }
}
