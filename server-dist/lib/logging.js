"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugLog = debugLog;
exports.serverLog = serverLog;
exports.errorMessage = errorMessage;
const path_1 = __importDefault(require("path"));
const fsSync = __importStar(require("fs"));
function debugLog(...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    const logPath = path_1.default.join(process.cwd(), 'e2e-debug.log');
    try {
        fsSync.appendFileSync(logPath, line);
    }
    catch (e) {
        console.warn('[debugLog] could not write to', logPath, e instanceof Error ? e.message : e);
    }
    console.log(...args);
}
/** Server log to file for debugging - works in both dev and production */
function serverLog(...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    const possiblePaths = [
        path_1.default.join(process.cwd(), 'server.log'),
        path_1.default.join(process.cwd(), '..', 'server.log'),
        path_1.default.join('/tmp', 'stashcat-server.log'),
    ];
    for (const logPath of possiblePaths) {
        try {
            fsSync.appendFileSync(logPath, line);
            break;
        }
        catch {
            // Try next path
        }
    }
    console.log(...args);
}
/** Extract error message safely from unknown catch values. */
function errorMessage(err, fallback = 'Failed') {
    return err instanceof Error ? err.message : fallback;
}
