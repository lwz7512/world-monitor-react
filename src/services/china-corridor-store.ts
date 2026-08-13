let _supported: boolean | null = null;
const _subs = new Set<(supported: boolean) => void>();

export function setRendererCapability(supported: boolean): void {
  _supported = supported;
  for (const sub of _subs) sub(supported);
}

export function getRendererCapability(): boolean | null { return _supported; }

export function subscribeRendererCapability(cb: (supported: boolean) => void): () => void {
  _subs.add(cb);
  return () => { _subs.delete(cb); };
}
