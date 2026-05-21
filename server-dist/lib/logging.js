"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugLog = debugLog;
exports.serverLog = serverLog;
exports.errorMessage = errorMessage;
/**
 * Async, rotierendes Logging fuer Server-Hot-Paths.
 *
 * Frueher: `appendFileSync()` pro Event auf bis zu 3 Log-Pfade. Auf einem
 * geschaeftigen Plesk haengt damit der Event-Loop pro Realtime-Event — und
 * die Dateien wuchsen unbegrenzt.
 *
 * Jetzt:
 *  - Erst-Init-Pass waehlt EINEN beschreibbaren Pfad pro Log-Datei und cached
 *    ihn (kein repeated stat+open pro Aufruf).
 *  - Schreibvorgaenge laufen async via `fs.promises.appendFile`, serialisiert
 *    durch eine simple Promise-Queue (keine konkurrierenden writes auf dieselbe
 *    Datei).
 *  - Rotation: wenn die Datei > MAX_LOG_BYTES wird, wird sie nach `.1` umbenannt
 *    (bestehende `.1` wird verworfen — wir halten max. 2 Generationen).
 *  - Backpressure-Schutz: wenn die Queue ueber MAX_QUEUE_DEPTH waechst, werden
 *    neue Eintraege verworfen (zaehlt einen Drop-Counter), bevor das ganze
 *    Programm wegen Disk-I/O zum Stillstand kommt.
 */
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
/** Max. Dateigroesse vor Rotation (5 MB). */
const MAX_LOG_BYTES = 5 * 1024 * 1024;
/** Max. ausstehende Log-Zeilen in der Queue, bevor wir droppen. */
const MAX_QUEUE_DEPTH = 1000;
/** Bytes seit dem letzten Rotation-Check, ab denen wir nochmal stat() rufen. */
const ROTATION_CHECK_INTERVAL_BYTES = 256 * 1024;
const targetsByFilename = new Map();
let queueDepth = 0;
let droppedSinceLastReport = 0;
let chain = Promise.resolve();
function pickLogPath(filename) {
    const candidates = [
        path_1.default.join(process.cwd(), filename),
        path_1.default.join(process.cwd(), '..', filename),
        path_1.default.join('/tmp', `stashcat-${filename}`),
    ];
    for (const p of candidates) {
        try {
            if ((0, fs_1.existsSync)(p)) {
                (0, fs_1.accessSync)(p, fs_1.constants.W_OK);
                return p;
            }
            (0, fs_1.accessSync)(path_1.default.dirname(p), fs_1.constants.W_OK);
            return p;
        }
        catch {
            /* nicht beschreibbar — naechster Kandidat */
        }
    }
    return null;
}
async function initialSize(p) {
    try {
        return (await (0, promises_1.stat)(p)).size;
    }
    catch {
        return 0;
    }
}
async function maybeRotate(target) {
    if (target.bytesSinceCheck < ROTATION_CHECK_INTERVAL_BYTES)
        return;
    target.bytesSinceCheck = 0;
    try {
        target.size = (await (0, promises_1.stat)(target.path)).size;
    }
    catch {
        target.size = 0;
    }
    if (target.size < MAX_LOG_BYTES)
        return;
    const rotated = `${target.path}.1`;
    try {
        try {
            await (0, promises_1.unlink)(rotated);
        }
        catch { /* gibt's evtl. nicht — egal */ }
        await (0, promises_1.rename)(target.path, rotated);
        target.size = 0;
    }
    catch {
        /* Rotation fehlgeschlagen — wir loggen weiter ins gleiche File. */
    }
}
function enqueueWrite(target, line) {
    if (queueDepth >= MAX_QUEUE_DEPTH) {
        droppedSinceLastReport++;
        return;
    }
    queueDepth++;
    const bytes = Buffer.byteLength(line, 'utf8');
    chain = chain
        .then(() => maybeRotate(target))
        .then(() => (0, promises_1.appendFile)(target.path, line))
        .then(() => {
        target.size += bytes;
        target.bytesSinceCheck += bytes;
    })
        .catch(() => { })
        .finally(() => {
        queueDepth--;
        if (droppedSinceLastReport > 0 && queueDepth === 0) {
            const n = droppedSinceLastReport;
            droppedSinceLastReport = 0;
            // Drop-Warnung nur auf stdout — sonst loggen wir die eigene
            // Backpressure in dieselbe Pipeline, die gerade ueberlastet ist.
            console.warn(`[Logging] Dropped ${n} log line(s) due to backpressure`);
        }
    });
}
function format(args) {
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    return `[${new Date().toISOString()}] ${msg}\n`;
}
async function ensureTargetAndWrite(filename, line) {
    let target = targetsByFilename.get(filename);
    if (!target) {
        const p = pickLogPath(filename);
        if (!p)
            return; // kein schreibbarer Pfad — console.log lief eh schon
        target = { path: p, size: await initialSize(p), bytesSinceCheck: 0 };
        targetsByFilename.set(filename, target);
    }
    enqueueWrite(target, line);
}
function debugLog(...args) {
    const line = format(args);
    void ensureTargetAndWrite('e2e-debug.log', line);
    console.log(...args);
}
function serverLog(...args) {
    const line = format(args);
    void ensureTargetAndWrite('server.log', line);
    console.log(...args);
}
/** Extract error message safely from unknown catch values. */
function errorMessage(err, fallback = 'Failed') {
    return err instanceof Error ? err.message : fallback;
}
