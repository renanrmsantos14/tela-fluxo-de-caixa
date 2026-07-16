import type { RuntimeContext, XrmLike } from '../types';

function candidateFromParent(): XrmLike | undefined {
  try {
    return window.parent !== window ? (window.parent as unknown as { Xrm?: XrmLike }).Xrm : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveRuntimeContext(): Promise<RuntimeContext> {
  const xrm = candidateFromParent() ?? window.Xrm;
  if (xrm?.WebApi) return { mode: 'xrm', xrm, clientUrl: xrm.Utility?.getGlobalContext().getClientUrl() };
  const localHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const local = localHost;
  if (local) return { mode: 'mock' };
  const clientUrl = location.origin;
  try {
    const response = await fetch(`${clientUrl}/api/data/v9.2/WhoAmI`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (response.ok) return { mode: 'direct', clientUrl };
  } catch {
    // Direct URL not authenticated: app remains usable with sample data.
  }
  return { mode: 'mock' };
}

declare global {
  interface Window { Xrm?: XrmLike; __APP_BUILD_INFO?: { version: string; builtAt: string } }
}
