import {
  HIDOCK_P1_PRODUCT_ID,
  HIDOCK_P1_VENDOR_ID
} from '../../../shared/types.js';

/** Returns true if the renderer's WebUSB API is available. */
export function isWebUsbAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

/** Trigger the OS device picker (must be called from a user gesture). */
export async function requestDevice(): Promise<USBDevice> {
  return navigator.usb.requestDevice({
    filters: [
      { vendorId: HIDOCK_P1_VENDOR_ID, productId: HIDOCK_P1_PRODUCT_ID }
    ]
  });
}

/** Look up an already-paired HiDock without prompting (used for auto-reconnect). */
export async function findPairedDevice(): Promise<USBDevice | null> {
  if (!isWebUsbAvailable()) return null;
  const all = await navigator.usb.getDevices();
  return (
    all.find(
      (d) =>
        d.vendorId === HIDOCK_P1_VENDOR_ID &&
        d.productId === HIDOCK_P1_PRODUCT_ID
    ) ?? null
  );
}

/** Open the device and claim interface 0. Idempotent. */
export async function openAndClaim(device: USBDevice): Promise<void> {
  if (!device.opened) await device.open();
  await device.selectConfiguration(1);
  await device.claimInterface(0);
}

/** Best-effort close. Safe to call on an already-closed device. */
export async function closeDevice(device: USBDevice): Promise<void> {
  try {
    await device.close();
  } catch {
    // Ignore — device may already be closed or detached.
  }
}
