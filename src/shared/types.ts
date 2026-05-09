// Cross-process types and constants shared between main, preload, and renderer.

/** USB Vendor ID for the HiDock P1 (Actions Semiconductor). */
export const HIDOCK_P1_VENDOR_ID = 0x10d6;

/** USB Product ID for the HiDock P1. */
export const HIDOCK_P1_PRODUCT_ID = 0xb00e;

/** USB endpoint numbers for the HiDock P1's bulk transfers. */
export const HIDOCK_P1_OUT_ENDPOINT = 1;
export const HIDOCK_P1_IN_ENDPOINT = 2;

/** Two-byte protocol header that prefixes every host→device command. */
export const PROTOCOL_MAGIC: readonly [number, number] = [0x12, 0x34];
