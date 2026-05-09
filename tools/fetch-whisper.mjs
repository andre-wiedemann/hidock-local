// Build whisper.cpp from source for the current platform and copy the
// resulting `whisper-cli` binary to resources/whisper/<platform-arch>/.
//
//   npm run whisper:fetch      — runs once per platform
//   delete resources/whisper/  — to force a rebuild
//
// Why build instead of downloading prebuilt: whisper.cpp doesn't publish
// macOS binaries on its release page, and even the Windows binaries are
// inconsistently packaged. Building from a pinned source tag is the only
// stable path that works on all three target platforms.
//
// CI runners on macOS / Linux / Windows each build their own copy during
// release.yml; for local dev, this script is run once and the binary lives
// in resources/whisper/ until you delete it.
//
// Requirements:
//   - git
//   - cmake
//   - a C++ toolchain (Xcode CLT on macOS, build-essential on Linux,
//     Visual Studio Build Tools on Windows)

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

const WHISPER_VERSION = 'v1.7.4';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PLAT_ARCH = `${process.platform}-${process.arch}`;
const TARGET_DIR = join(ROOT, 'resources', 'whisper', PLAT_ARCH);
const BIN_NAME = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
const TARGET_BIN = join(TARGET_DIR, BIN_NAME);

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function findBuiltBinary(buildRoot) {
  // CMake on different platforms puts the binary in slightly different
  // places. Probe the common spots.
  const candidates =
    process.platform === 'win32'
      ? [
          'build/bin/Release/whisper-cli.exe',
          'build/bin/whisper-cli.exe'
        ]
      : ['build/bin/whisper-cli', 'build/whisper-cli'];
  for (const rel of candidates) {
    const abs = join(buildRoot, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

function copyAdjacentLibraries(buildRoot) {
  // Even with BUILD_SHARED_LIBS=OFF, whisper.cpp may produce shared libs for
  // GGML on certain platforms. Copy any *.dylib / *.so / *.dll next to the
  // binary so loader paths resolve at runtime.
  const candidates = [
    join(buildRoot, 'build', 'src'),
    join(buildRoot, 'build', 'ggml', 'src'),
    join(buildRoot, 'build', 'bin'),
    join(buildRoot, 'build', 'bin', 'Release')
  ];
  const exts =
    process.platform === 'darwin'
      ? ['.dylib']
      : process.platform === 'win32'
        ? ['.dll']
        : ['.so'];
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!exts.some((ext) => file.endsWith(ext))) continue;
      const src = join(dir, file);
      const dst = join(TARGET_DIR, file);
      if (!existsSync(dst)) {
        copyFileSync(src, dst);
        console.log(`  + ${file}`);
      }
    }
  }
}

function main() {
  if (existsSync(TARGET_BIN)) {
    const stat = statSync(TARGET_BIN);
    console.log(
      `✓ whisper-cli already at ${TARGET_BIN} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`
    );
    console.log('  Delete the file to force a rebuild.');
    return;
  }

  const buildRoot = join(tmpdir(), `whisper-build-${PLAT_ARCH}-${WHISPER_VERSION}`);
  console.log(`Building whisper.cpp ${WHISPER_VERSION} for ${PLAT_ARCH}…`);
  console.log(`Build dir: ${buildRoot}`);

  rmSync(buildRoot, { recursive: true, force: true });
  run(
    `git clone --depth 1 --branch ${WHISPER_VERSION} https://github.com/ggml-org/whisper.cpp.git "${buildRoot}"`
  );

  // Static link where possible to avoid dragging libraries around. macOS
  // gets Metal automatically (it's the default when targeting Apple silicon
  // or Intel macOS with Metal-capable GPU).
  const cmakeArgs = [
    '-B build',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DWHISPER_BUILD_TESTS=OFF',
    '-DWHISPER_BUILD_SERVER=OFF',
    '-DWHISPER_BUILD_EXAMPLES=ON'
  ];
  run(`cmake ${cmakeArgs.join(' ')}`, { cwd: buildRoot });
  run(`cmake --build build --config Release -j`, { cwd: buildRoot });

  const sourceBin = findBuiltBinary(buildRoot);
  if (!sourceBin) {
    console.error('Built binary not found. Listing build/ contents:');
    run(`find "${join(buildRoot, 'build')}" -name "whisper-cli*" -type f`);
    process.exit(1);
  }

  mkdirSync(TARGET_DIR, { recursive: true });
  copyFileSync(sourceBin, TARGET_BIN);
  if (process.platform !== 'win32') {
    execSync(`chmod +x "${TARGET_BIN}"`);
  }
  copyAdjacentLibraries(buildRoot);

  const finalSize = statSync(TARGET_BIN).size;
  console.log(
    `✓ whisper-cli built at ${TARGET_BIN} (${(finalSize / 1024 / 1024).toFixed(1)} MB)`
  );
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
