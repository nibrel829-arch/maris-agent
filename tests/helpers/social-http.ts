import type { ProviderHttp, ProviderHttpInit } from '@/server/social/providers';

export interface HttpCall {
  url: string;
  init: ProviderHttpInit;
}

export interface HttpScene {
  match: (url: string, init: ProviderHttpInit) => boolean;
  status: number;
  body: unknown;
}

/**
 * Scripted provider HTTP double. Every call is recorded; an unmatched call
 * throws so tests fail loudly instead of inventing provider behaviour.
 */
export function scriptedHttp(scenes: HttpScene[]): ProviderHttp & { calls: HttpCall[] } {
  const calls: HttpCall[] = [];
  const http = (async (url: string, init: ProviderHttpInit) => {
    calls.push({ url, init });
    const scene = scenes.find((candidate) => candidate.match(url, init));
    if (!scene) throw new Error(`Unexpected provider call: ${url}`);
    return {
      status: scene.status,
      json: async () => scene.body,
      text: async () => JSON.stringify(scene.body),
    };
  }) as ProviderHttp & { calls: HttpCall[] };
  http.calls = calls;
  return http;
}

export const urlContains =
  (part: string) =>
  (url: string): boolean =>
    url.includes(part);

export function formBody(init: ProviderHttpInit): URLSearchParams {
  const body = typeof init.body === 'string' ? init.body : '';
  return new URLSearchParams(body);
}
