import { app, BrowserWindow, session, shell } from 'electron';
import { join } from 'node:path';
import { buildAppMenu } from './menu.js';
import {
  HIDOCK_P1_PRODUCT_ID,
  HIDOCK_P1_VENDOR_ID
} from '../shared/types.js';

const isDev = !app.isPackaged;

function isHiDock(vendorId?: number, productId?: number): boolean {
  return vendorId === HIDOCK_P1_VENDOR_ID && productId === HIDOCK_P1_PRODUCT_ID;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });

  // Open external links in the OS browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

function configureUsbPermissions(): void {
  // Auto-pick the HiDock when the renderer calls navigator.usb.requestDevice.
  // The user still triggers this through the Connect button, so it's gated by
  // a real user gesture — we just skip the chooser dialog Electron would
  // otherwise show.
  session.defaultSession.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    const match = details.deviceList.find((d) =>
      isHiDock(d.vendorId, d.productId)
    );
    callback(match?.deviceId);
  });

  // Persist permission so future sessions auto-reconnect.
  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType !== 'usb') return false;
    const dev = details.device as { vendorId?: number; productId?: number };
    return isHiDock(dev.vendorId, dev.productId);
  });

  session.defaultSession.setUSBProtectedClassesHandler((details) =>
    details.protectedClasses
  );
}

app.whenReady().then(() => {
  configureUsbPermissions();
  buildAppMenu();
  const initialWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Re-focus the initial window if the user clicks the dock icon.
  initialWindow.on('focus', () => initialWindow.show());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
