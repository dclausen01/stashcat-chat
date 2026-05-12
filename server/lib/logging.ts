import path from 'path';
import * as fsSync from 'fs';

export function debugLog(...args: unknown[]) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  const logPath = path.join(process.cwd(), 'e2e-debug.log');
  try {
    fsSync.appendFileSync(logPath, line);
  } catch (e) {
    console.warn('[debugLog] could not write to', logPath, e instanceof Error ? e.message : e);
  }
  console.log(...args);
}

/** Server log to file for debugging - works in both dev and production */
export function serverLog(...args: unknown[]) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const line = `[${new Date().toISOString()}] ${msg}\n`;

  const possiblePaths = [
    path.join(process.cwd(), 'server.log'),
    path.join(process.cwd(), '..', 'server.log'),
    path.join('/tmp', 'stashcat-server.log'),
  ];

  for (const logPath of possiblePaths) {
    try {
      fsSync.appendFileSync(logPath, line);
      break;
    } catch {
      // Try next path
    }
  }

  console.log(...args);
}

/** Extract error message safely from unknown catch values. */
export function errorMessage(err: unknown, fallback = 'Failed'): string {
  return err instanceof Error ? err.message : fallback;
}
