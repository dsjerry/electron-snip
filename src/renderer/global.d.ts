import type { SnipRendererApi } from '../shared/api';

declare global {
  interface Window {
    snip: SnipRendererApi;
  }
}

export {};
