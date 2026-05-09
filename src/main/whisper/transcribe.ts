// Run whisper.cpp on a single audio file.
//
// Pipeline:
//   1. Validate binary + model + input file
//   2. ffmpeg → 16 kHz mono PCM WAV in a request-scoped temp dir
//      (whisper.cpp without ffmpeg support requires WAV input)
//   3. whisper-cli → writes <basePath>.{txt,vtt,json} per requested formats
//   4. Clean up the temp WAV
//
// Progress wiring:
//   - decoding   = ffmpeg `out_time_us` parsed from stderr `progress=`
//   - transcribing = whisper-cli `progress = N%` lines on stderr
//
// Cancellation:
//   - cancelTranscribe(requestId) kills the active child process. The
//     transcribe() promise rejects with a WhisperError(code=CANCELLED).

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import {
  TranscribeFormat,
  TranscribeProgress,
  TranscribeRequest,
  TranscribeResult,
  WhisperError
} from '../../shared/whisper.js';
import { findWhisperBinary } from './binary.js';
import { isModelDownloaded, modelPath } from './models.js';

type ProgressEmitter = (progress: TranscribeProgress) => void;

interface ActiveRequest {
  ffmpeg?: ChildProcess;
  whisper?: ChildProcess;
  cancelled: boolean;
}

const active = new Map<string, ActiveRequest>();

function err(code: WhisperError['code'], message: string): WhisperError {
  return { code, message };
}

function tempWavPath(requestId: string): string {
  const baseTmp =
    typeof app !== 'undefined' && typeof app.getPath === 'function'
      ? app.getPath('temp')
      : tmpdir();
  const dir = join(baseTmp, 'hidock-local', requestId);
  mkdirSync(dir, { recursive: true });
  return join(dir, 'audio.wav');
}

/**
 * Cancel an in-flight transcription. Idempotent — does nothing if the
 * request already finished or never existed.
 */
export function cancelTranscribe(requestId: string): void {
  const ctx = active.get(requestId);
  if (!ctx) return;
  ctx.cancelled = true;
  ctx.ffmpeg?.kill('SIGTERM');
  ctx.whisper?.kill('SIGTERM');
}

/**
 * Convert any audio file ffmpeg understands into 16 kHz mono signed-16
 * PCM WAV — the format whisper.cpp expects when not built with ffmpeg
 * support.
 */
function runFfmpeg(
  inputPath: string,
  outputWav: string,
  ctx: ActiveRequest,
  emit: ProgressEmitter,
  requestId: string,
  totalDurationSec: number | null
): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    if (!ffmpegStatic) {
      rejectFn(err('FFMPEG_FAILED', 'ffmpeg-static did not provide a binary path'));
      return;
    }
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'info',
      '-progress', 'pipe:2',
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outputWav
    ];
    const proc = spawn(ffmpegStatic, args);
    ctx.ffmpeg = proc;

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // ffmpeg's -progress writes `out_time_us=NNN` lines. Convert to %.
      const m = text.match(/out_time_us=(\d+)/);
      if (m && totalDurationSec) {
        const sec = parseInt(m[1], 10) / 1_000_000;
        const pct = Math.min(100, Math.round((sec / totalDurationSec) * 100));
        emit({ requestId, phase: 'decoding', percent: pct });
      }
    });

    proc.on('error', (e) => rejectFn(err('FFMPEG_FAILED', e.message)));
    proc.on('close', (code) => {
      if (ctx.cancelled) {
        rejectFn(err('CANCELLED', 'Transcription cancelled'));
        return;
      }
      if (code !== 0) {
        rejectFn(err('FFMPEG_FAILED', `ffmpeg exited with code ${code}`));
        return;
      }
      resolveFn();
    });
  });
}

interface WhisperRunOptions {
  binary: string;
  modelFile: string;
  wavPath: string;
  basePath: string;
  formats: TranscribeFormat[];
  language?: string;
  threads: number;
}

function runWhisper(
  opts: WhisperRunOptions,
  ctx: ActiveRequest,
  emit: ProgressEmitter,
  requestId: string
): Promise<{ detectedLanguage?: string }> {
  return new Promise((resolveFn, rejectFn) => {
    const args = [
      '-m', opts.modelFile,
      '-f', opts.wavPath,
      '-of', opts.basePath,
      '-pp',                       // print progress
      '-t', String(opts.threads)
    ];
    if (opts.formats.includes('txt')) args.push('-otxt');
    if (opts.formats.includes('vtt')) args.push('-ovtt');
    if (opts.formats.includes('json')) args.push('-oj');
    if (opts.language) args.push('-l', opts.language);

    const proc = spawn(opts.binary, args);
    ctx.whisper = proc;

    let detectedLanguage: string | undefined;
    let stderrBuf = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf += text;
      // whisper-cli prints lines like:
      //   whisper_print_progress_callback: progress = 10%
      //   whisper_full_with_state: progress = 12%
      const progMatch = text.match(/progress\s*=\s*(\d+)%/);
      if (progMatch) {
        emit({
          requestId,
          phase: 'transcribing',
          percent: parseInt(progMatch[1], 10)
        });
      }
      // Detected language line:
      //   whisper_full_with_state: auto-detected language: en (p = 0.998765)
      const langMatch = text.match(/auto-detected language:\s*(\w+)/);
      if (langMatch) detectedLanguage = langMatch[1];
    });

    proc.on('error', (e) => rejectFn(err('WHISPER_FAILED', e.message)));
    proc.on('close', (code) => {
      if (ctx.cancelled) {
        rejectFn(err('CANCELLED', 'Transcription cancelled'));
        return;
      }
      if (code !== 0) {
        const tail = stderrBuf.slice(-400);
        rejectFn(
          err('WHISPER_FAILED', `whisper-cli exited with code ${code}\n${tail}`)
        );
        return;
      }
      resolveFn({ detectedLanguage });
    });
  });
}

/**
 * Probe an audio file's duration via ffmpeg-static (sets up `-i` then bails
 * out — ffmpeg prints duration to stderr before failing on no output spec).
 */
function probeDurationSec(inputPath: string): Promise<number | null> {
  return new Promise((resolveFn) => {
    if (!ffmpegStatic) {
      resolveFn(null);
      return;
    }
    let stderr = '';
    const proc = spawn(ffmpegStatic, ['-hide_banner', '-i', inputPath]);
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}\.\d+)/);
      if (!m) {
        resolveFn(null);
        return;
      }
      const [, hh, mm, ss] = m;
      resolveFn(parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss));
    });
    proc.on('error', () => resolveFn(null));
  });
}

export async function transcribe(
  req: TranscribeRequest,
  emit: ProgressEmitter
): Promise<TranscribeResult> {
  const startedAt = Date.now();

  // 1. Validate.
  const binary = findWhisperBinary();
  if (!binary) {
    throw err(
      'BINARY_MISSING',
      'whisper-cli was not found. Run `npm run whisper:fetch` (dev) or reinstall the app.'
    );
  }
  if (!existsSync(req.audioPath)) {
    throw err('AUDIO_MISSING', `Audio file not found: ${req.audioPath}`);
  }
  if (!isModelDownloaded(req.modelName)) {
    throw err(
      'MODEL_MISSING',
      `Model not downloaded: ${req.modelName}. Pick + download one in Settings → Models.`
    );
  }

  const ctx: ActiveRequest = { cancelled: false };
  active.set(req.requestId, ctx);
  const wavPath = tempWavPath(req.requestId);

  try {
    emit({ requestId: req.requestId, phase: 'preparing', percent: 0 });

    // 2. Probe duration (best-effort — used to compute decode % only).
    const durationSec = await probeDurationSec(req.audioPath);

    // 3. Convert to WAV.
    await runFfmpeg(req.audioPath, wavPath, ctx, emit, req.requestId, durationSec);

    // 4. Run whisper-cli.
    const threads = req.threads ?? Math.max(1, Math.floor(cpus().length / 2));
    const { detectedLanguage } = await runWhisper(
      {
        binary,
        modelFile: modelPath(req.modelName),
        wavPath,
        basePath: req.basePath,
        formats: req.formats,
        language: req.language,
        threads
      },
      ctx,
      emit,
      req.requestId
    );

    // 5. Collect outputs.
    emit({ requestId: req.requestId, phase: 'finalizing', percent: 100 });
    const outputs: TranscribeResult['outputs'] = {};
    for (const fmt of req.formats) {
      const ext = fmt === 'json' ? '.json' : fmt === 'vtt' ? '.vtt' : '.txt';
      const path = `${req.basePath}${ext}`;
      if (existsSync(path) && statSync(path).size > 0) outputs[fmt] = path;
    }

    return {
      requestId: req.requestId,
      outputs,
      durationSec: (Date.now() - startedAt) / 1000,
      detectedLanguage
    };
  } finally {
    active.delete(req.requestId);
    // Clean up the temp WAV directory.
    try {
      rmSync(join(wavPath, '..'), { recursive: true, force: true });
    } catch {
      // Non-fatal.
    }
  }
}
