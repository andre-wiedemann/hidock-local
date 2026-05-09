// Download a prebuilt sherpa-onnx release bundle for the current
// platform and copy the `sherpa-onnx-offline-speaker-diarization`
// binary to resources/sherpa/<platform-arch>/.
//
//   npm run sherpa:fetch       — runs once per platform
//   delete resources/sherpa/   — to force a re-download
//
// We pull a static-linked tarball from sherpa-onnx's GitHub releases so
// there are no shared libraries to drag along. Each runner only needs
// its own platform's binary; CI populates platform-scoped trees in
// release.yml the same way it does for whisper-cli.
//
// Requirements:
//   - curl + tar (macOS / Linux), built into the OS
//   - PowerShell 5.1+ (Windows), Invoke-WebRequest + tar (tar is in
//     Windows 10 1803+)

import { execSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const SHERPA_VERSION = 'v1.13.1';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PLAT_ARCH = `${process.platform}-${process.arch}`;
const TARGET_DIR = join(ROOT, 'resources', 'sherpa', PLAT_ARCH);
const BIN_NAME =
  process.platform === 'win32'
    ? 'sherpa-onnx-offline-speaker-diarization.exe'
    : 'sherpa-onnx-offline-speaker-diarization';
const TARGET_BIN = join(TARGET_DIR, BIN_NAME);

// Map node's (platform, arch) to sherpa-onnx's release tarball naming
// scheme. We always pick a static build so there are no companion
// .dylib/.so/.dll files to bundle. Windows uses MT (static CRT) for the
// same reason: the binary self-contains the runtime.
function tarballSpec() {
  const v = SHERPA_VERSION.replace(/^v/, '');
  switch (PLAT_ARCH) {
    case 'darwin-arm64':
      return {
        name: `sherpa-onnx-v${v}-osx-arm64-static`,
        ext: 'tar.bz2'
      };
    case 'darwin-x64':
      // sherpa-onnx doesn't ship an x64-only macOS build; the universal2
      // binary covers both arches. Slightly larger but works on both.
      return {
        name: `sherpa-onnx-v${v}-osx-universal2-static`,
        ext: 'tar.bz2'
      };
    case 'linux-x64':
      return {
        name: `sherpa-onnx-v${v}-linux-x64-static`,
        ext: 'tar.bz2'
      };
    case 'win32-x64':
      return {
        name: `sherpa-onnx-v${v}-win-x64-static-MT-Release`,
        ext: 'tar.bz2'
      };
    default:
      throw new Error(
        `Unsupported platform-arch for sherpa-onnx: ${PLAT_ARCH}. ` +
          `Add a mapping in tools/fetch-sherpa.mjs.`
      );
  }
}

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function download(url, dest) {
  if (process.platform === 'win32') {
    // PowerShell's Invoke-WebRequest follows redirects by default.
    run(
      `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${dest}'"`
    );
  } else {
    run(`curl -fL -o "${dest}" "${url}"`);
  }
}

function extract(archive, intoDir) {
  // tar handles bz2 directly via -j on all three platforms (Windows
  // since 10 1803). We extract into a scratch dir and find the binary
  // afterwards rather than fighting per-platform path syntax.
  mkdirSync(intoDir, { recursive: true });
  run(`tar -xjf "${archive}" -C "${intoDir}"`);
}

function findBinary(extractRoot, expectedName) {
  // sherpa-onnx tarballs unpack as `<name>/bin/<binary>`. We don't
  // hardcode the wrapper dir name because the tarball spec already
  // captures it — but if upstream renames the layout, fall back to a
  // recursive scan.
  const directGuess = join(extractRoot, expectedName, 'bin', BIN_NAME);
  if (existsSync(directGuess)) return directGuess;

  // Fallback: depth-2 scan.
  for (const top of readdirSync(extractRoot)) {
    const binDir = join(extractRoot, top, 'bin');
    if (!existsSync(binDir)) continue;
    const candidate = join(binDir, BIN_NAME);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  if (existsSync(TARGET_BIN)) {
    const stat = statSync(TARGET_BIN);
    console.log(
      `✓ sherpa-onnx-offline-speaker-diarization already at ${TARGET_BIN} ` +
        `(${(stat.size / 1024 / 1024).toFixed(1)} MB)`
    );
    console.log('  Delete the file to force a re-download.');
    return;
  }

  const spec = tarballSpec();
  const url = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/${spec.name}.${spec.ext}`;
  const scratch = join(tmpdir(), `sherpa-fetch-${PLAT_ARCH}-${SHERPA_VERSION}`);
  const archivePath = join(scratch, `${spec.name}.${spec.ext}`);

  console.log(`Fetching sherpa-onnx ${SHERPA_VERSION} for ${PLAT_ARCH}…`);
  console.log(`  URL: ${url}`);
  console.log(`  Scratch: ${scratch}`);

  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });

  download(url, archivePath);
  extract(archivePath, scratch);

  const sourceBin = findBinary(scratch, spec.name);
  if (!sourceBin) {
    console.error(
      `Diarization binary not found inside ${scratch}. ` +
        `Listing tree:`
    );
    run(`find "${scratch}" -name "${BIN_NAME}" -type f`);
    process.exit(1);
  }

  mkdirSync(TARGET_DIR, { recursive: true });
  copyFileSync(sourceBin, TARGET_BIN);
  if (process.platform !== 'win32') {
    execSync(`chmod +x "${TARGET_BIN}"`);
  }

  // Free the scratch dir — we don't need any of the other tools shipped
  // in the tarball (~150 MB of binaries we won't use).
  rmSync(scratch, { recursive: true, force: true });

  const finalSize = statSync(TARGET_BIN).size;
  console.log(
    `✓ sherpa-onnx-offline-speaker-diarization at ${TARGET_BIN} ` +
      `(${(finalSize / 1024 / 1024).toFixed(1)} MB)`
  );
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
