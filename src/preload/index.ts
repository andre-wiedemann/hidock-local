// The renderer is privileged enough to talk to WebUSB directly, so the
// preload layer is intentionally minimal. We only expose static metadata
// the renderer needs (app version, platform) and keep all USB I/O inside
// the renderer where the WebUSB API lives.

import { contextBridge } from 'electron';

const api = {
  platform: process.platform,
  version: process.env['npm_package_version'] ?? '0.0.0'
};

contextBridge.exposeInMainWorld('hidock', api);

export type HidockApi = typeof api;
