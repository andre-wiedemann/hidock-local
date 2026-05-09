# HiDock P1 protocol — reverse-engineered from HiNotes vendor JS

Findings from static analysis of `index-hinotes.js` (the vendor app's
production bundle, captured 2026-05-09). Supersedes large parts of
`docs/USB_PROTOCOL.md` — the structure we'd reverse-engineered from
behavior was right at the byte level but miscategorized at the field
level. Notes here will graduate into `docs/USB_PROTOCOL.md` once the
new init sequence is wired up and verified end-to-end.

---

## 1. Packet structure (corrected)

The 12-byte command header is **not** `[magic][cmd1][cmd2][param region]`
as we thought. It's:

```
offset  size   field
------  ----   -------------------------------------------------------------
0..1    2      Magic — always 0x12 0x34
2..3    2      Command code, big-endian uint16
4..7    4      Sequence index, big-endian uint32 (auto-incrementing)
8..11   4      Body length, big-endian uint32
12..    N      Body bytes (e.g. filename for TRANSFER_FILE)
```

Decoded straight out of the vendor's `Command.make`:

```js
Un[ul++]=18,                                  // 0x12
Un[ul++]=52,                                  // 0x34
Un[ul++]=this.command>>8&255,                 // cmd hi
Un[ul++]=this.command>>0&255,                 // cmd lo
Un[ul++]=this.index>>24&255,                  // seq[31:24]
Un[ul++]=this.index>>16&255,                  // seq[23:16]
Un[ul++]=this.index>>8&255,                   // seq[15:8]
Un[ul++]=this.index>>0&255,                   // seq[7:0]
let C1=this.msgBody.length;
Un[ul++]=C1>>24&255,                          // bodyLen[31:24]
Un[ul++]=C1>>16&255,
Un[ul++]=C1>>8&255,
Un[ul++]=C1>>0&255;
for (let S1=0;S1<this.msgBody.length;S1++)
  Un[ul++]=this.msgBody[S1]&255;
```

So what we'd been calling `param1` is actually the low byte of an
auto-incrementing sequence number. The historical `0x0E` value for
`QUERY_FILE_LIST` is just sequence 14 — incidentally what the
standalone landed on after issuing other commands first.

---

## 2. Command code table

The vendor app defines all command codes as a flat enum. Codes are
16-bit; high byte > 0 indicates a "category-specific" command (BT,
realtime, factory).

| Code (dec / hex) | Constant name              | Vendor display name           |
|------------------|----------------------------|-------------------------------|
| 0 / 0x0000       | INVAILD                    | invalid-0                     |
| 1 / 0x0001       | QUERY_DEVICE_INFO          | get-device-info               |
| 2 / 0x0002       | QUERY_DEVICE_TIME          | get-device-time               |
| 3 / 0x0003       | SET_DEVICE_TIME            | set-device-time               |
| 4 / 0x0004       | QUERY_FILE_LIST            | get-file-list                 |
| 5 / 0x0005       | TRANSFER_FILE              | transfer-file                 |
| 6 / 0x0006       | QUERY_FILE_COUNT           | get-file-count                |
| 7 / 0x0007       | DELETE_FILE                | delete-file                   |
| 8 / 0x0008       | REQUEST_FIRMWARE_UPGRADE   | request-firmware-upgrade      |
| 9 / 0x0009       | FIRMWARE_UPLOAD            | firmware-upload               |
| 10 / 0x000A      | DEVICE_MSG_TEST            | device msg test               |
| 11 / 0x000B      | GET_SETTINGS               | get-settings                  |
| 12 / 0x000C      | SET_SETTINGS               | set-settings                  |
| 13 / 0x000D      | GET_FILE_BLOCK             | get file block                |
| 16 / 0x0010      | READ_CARD_INFO             | read card info                |
| 17 / 0x0011      | FORMAT_CARD                | format card                   |
| 18 / 0x0012      | GET_RECORDING_FILE         | get recording file            |
| 19 / 0x0013      | RESTORE_FACTORY_SETTINGS   | restore factory settings      |
| 20 / 0x0014      | SCHEDULE_INFO              | send meeting schedule info    |
| 21 / 0x0015      | TRANSFER_FILE_PARTIAL      | (transfer file partial)       |
| 22 / 0x0016      | REQUEST_TONE_UPDATE        | (request tone update)         |
| 23 / 0x0017      | TONE_UPDATE                | (tone update)                 |
| 24 / 0x0018      | REQUEST_UAC_UPDATE         | (request UAC update)          |
| 25 / 0x0019      | UAC_UPDATE                 | (UAC update)                  |
| 28 / 0x001C      | SEND_KEY_CODE              | (send key code)               |
| 29 / 0x001D      | GET_RECORDING_STATUS       | (get recording status)        |
| 30 / 0x001E      | SET_RECORDING_QUALITY      | (set recording quality)       |
| 31 / 0x001F      | GET_RECORDING_QUALITY      | (get recording quality)       |
| 32 / 0x0020      | REALTIME_READ_SETTING      | (realtime read setting)       |
| 33 / 0x0021      | REALTIME_CONTROL           | (realtime control)            |
| 34 / 0x0022      | REALTIME_TRANSFER          | (realtime transfer)           |
| 4097 / 0x1001    | BLUETOOTH_SCAN             | bluetooth-scan                |
| 4098 / 0x1002    | BLUETOOTH_CMD              | bluetooth-cmd                 |
| 4099 / 0x1003    | BLUETOOTH_STATUS           | bluetooth-status              |
| 4100 / 0x1004    | GET_BATTERY_STATUS         | (get battery status)          |
| 4101 / 0x1005    | BT_SCAN                    | (bt scan)                     |
| 4102 / 0x1006    | BT_DEV_LIST                | (bt dev list)                 |
| 4103 / 0x1007    | BT_GET_PAIRED_DEV_LIST     | (bt get paired dev list)      |
| 4104 / 0x1008    | BT_REMOVE_PAIRED_DEV       | (bt remove paired dev)        |
| 4105 / 0x1009    | SET_AUDIO_INPUT_DEV        | (set audio input dev)         |
| 4106 / 0x100A    | GET_AUDIO_INPUT_DEV        | (get audio input dev)         |
| 61447 / 0xF007   | TEST_SN_WRITE              | test sn write                 |
| 61448 / 0xF008   | RECORD_TEST_START          | record test start             |
| 61449 / 0xF009   | RECORD_TEST_END            | record test end               |
| 61451 / 0xF00B   | FACTORY_RESET              | factory reset                 |
| 61456 / 0xF010   | WRITE_WEBUSB_TIMEOUT       | (write webusb timeout)        |
| 61457 / 0xF011   | READ_WEBUSB_TIMEOUT        | (read webusb timeout)         |

---

## 3. Mapping our existing identifiers

We had the following in `src/renderer/src/usb/protocol.ts`:

| Our name              | Our bytes      | Reality                                   |
|-----------------------|----------------|-------------------------------------------|
| SUBCMD_DEVICE_INFO    | cmd1=0, cmd2=1 | command = 0x0001 = QUERY_DEVICE_INFO ✓    |
| SUBCMD_FILE_LIST      | cmd1=0, cmd2=4 | command = 0x0004 = QUERY_FILE_LIST ✓      |
| SUBCMD_DOWNLOAD_FILE  | cmd1=0, cmd2=5 | command = 0x0005 = TRANSFER_FILE ✓        |
| SUBCMD_STORAGE_INFO   | cmd1=0, cmd2=10| command = 0x0010 = READ_CARD_INFO ✓       |
| SUBCMD_STORAGE_INIT   | cmd1=10, cmd2=4| command = 0x1004 = **GET_BATTERY_STATUS** |

So **what we've been calling `STORAGE_INIT` is actually `GET_BATTERY_STATUS`** — entirely unrelated to storage. That's why "init then info" doesn't actually init storage; it just reads battery before reading the card. The standalone HTML inherited this misnaming from the original reverse-engineering effort.

---

## 4. Init sequence the vendor uses

Captured from a HiNotes runtime log on auto-connect:

```
get-time           → "2026-05-09 17:31:53"
set-time-to        → host clock          (BCD-encoded body)
get-settings       → autoRecord/autoPlay/...
get-recording-quality
get-card-info      → free/used/capacity (READ_CARD_INFO)
battery-status
... a few more init hits ...
file-list          → count: 224, time: 98ms
```

So the proper init order is (as command codes):

1. `QUERY_DEVICE_INFO`         (1)   — version + serial
2. `QUERY_DEVICE_TIME`         (2)   — read device clock
3. `SET_DEVICE_TIME`           (3)   — sync to host clock; body = BCD time
4. `GET_SETTINGS`              (11)  — autoRecord, autoPlay, etc.
5. `GET_RECORDING_QUALITY`     (31)
6. `READ_CARD_INFO`            (16)  — card-level info, what we partially had as STORAGE_INFO
7. `GET_BATTERY_STATUS`        (4100)— what we mistakenly called STORAGE_INIT
8. `QUERY_FILE_LIST`           (4)   — finally the listing

The "warm" state where the file-list response truncates to ~214 entries
is what the device falls into when it hasn't seen a full init sequence
in the current session. Sending the abbreviated standalone-style
init (just READ_CARD_INFO + GET_BATTERY_STATUS) is enough to coax 223
sometimes; sending the full sequence is what gets 224 reliably.

### `SET_DEVICE_TIME` body

The vendor wraps the time bytes in `body(this.to_bcd(ul))`. BCD-encoded
host time. Format almost certainly:

```
[YY YY MM DD HH MM SS]
```

…each as two BCD nibbles per byte. Need to decode `to_bcd` to confirm.

---

## 5. Sequence index quirks

The vendor's `Command.sequence(idx)` gets called with an
auto-incrementing per-session counter (`sqidx++`). We've been
hard-coding values like `param1=3` (which lands at byte 7 — the
seq-low byte) and `param1=0x0E`. Effectively we send sequences 3 and
14 over and over.

The device may or may not care about strictly-increasing sequence
numbers across the session. Worth testing: with the new init flow,
also use a real auto-increment from sqidx=1 upward.

---

## 6. Implementation plan

Phase 1 — **rename + reframe**:
- Rename our constants: `SUBCMD_STORAGE_INIT` → `CMD_GET_BATTERY_STATUS`, etc.
- Add `buildCommandPacket` v2 that takes a single 16-bit command code
  and a separate body, instead of cmd1/cmd2/param1/param2.
- Old function stays for now as a thin wrapper around the new one.

Phase 2 — **add the init sequence**:
- New `runInitSequence(device)` in commands.ts that fires the seven
  commands in order.
- Each one increments a session-scoped `sqidx`.
- Called once after `openAndClaim`, before any user-triggered work.

Phase 3 — **decode `SET_DEVICE_TIME` body**:
- Extract `to_bcd` from the vendor JS.
- Build a host-clock BCD body and verify the device acks.

Phase 4 — **verify**:
- Run a `npm run dev` session, click List Files. Expect 224.
- Confirm subsequent List Files calls also return 224 (no degradation).
- If still flaky, capture HiNotes' `set-time-to` body bytes via the
  DevTools snippet I already shared with the user, compare with ours.

---

## 7. Open questions

- Does the device check that sequence numbers strictly increase?
- Does `SET_DEVICE_TIME` need to be sent *every* connect, or just first?
- Does `READ_CARD_INFO` block the current session if `GET_BATTERY_STATUS`
  hasn't run yet? Some firmware-state hint.
- What is the body format of the file-list response actually documenting?
  Our parser works on heuristic regex matching. With a proper packet
  spec, we could parse without regex and likely get all 224 entries
  even from a "warm" response.
