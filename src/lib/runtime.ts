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
    throw new Error(`Dataverse recusou a autenticação da URL direta (${response.status}).`);
  } catch (error) {
    throw new Error('Não foi possível autenticar a URL direta no Dataverse.', { cause: error });
  }
}

declare global {
  interface Window { Xrm?: XrmLike; __APP_BUILD_INFO?: { version: string; builtAt: string } }
}
