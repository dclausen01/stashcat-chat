import { get } from './core';

export interface PublicConfig {
  nextcloudUrl: string;
}

export function getPublicConfig(): Promise<PublicConfig> {
  return get<PublicConfig>('/config');
}
