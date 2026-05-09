import { state } from '../state.js';
import { log } from './log.js';
import { hideStorageInfo } from './storage-panel.js';

export type ConnectHandler = (device: USBDevice) => void | Promise<void>;
export type DisconnectHandler = () => void | Promise<void>;

export function setConnectedUi(deviceLabel = 'HiDock P1'): void {
  const status = document.getElementById('connectionStatus');
  if (status) {
    status.textContent = `Connected to ${deviceLabel}`;
    status.className = 'status success';
  }
  (document.getElementById('connectBtn') as HTMLButtonElement | null)?.setAttribute('disabled', 'true');
  (document.getElementById('disconnectBtn') as HTMLButtonElement | null)?.removeAttribute('disabled');
  const section = document.getElementById('downloadSection');
  if (section) section.style.display = 'block';
}

export function setDisconnectedUi(reason = 'Disconnected'): void {
  state.device = null;
  const status = document.getElementById('connectionStatus');
  if (status) {
    status.textContent = reason;
    status.className = reason.startsWith('Disconnected') ? 'status' : 'status error';
  }
  (document.getElementById('connectBtn') as HTMLButtonElement | null)?.removeAttribute('disabled');
  (document.getElementById('disconnectBtn') as HTMLButtonElement | null)?.setAttribute('disabled', 'true');
  const section = document.getElementById('downloadSection');
  if (section) section.style.display = 'none';
  hideStorageInfo();
}

export function setConnectionError(message: string): void {
  const status = document.getElementById('connectionStatus');
  if (status) {
    status.textContent = `Connection failed: ${message}`;
    status.className = 'status error';
  }
  log(`Error: ${message}`, 'error');
}
