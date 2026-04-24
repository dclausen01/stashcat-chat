/**
 * OnlyOffice Document Server integration (read-only).
 *
 * Enables viewing Office documents in the OnlyOffice editor.
 * No save-back / callback logic — purely read-only.
 */
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

// ── Configuration ────────────────────────────────────────────────────────────

const ONLYOFFICE_URL = process.env.ONLYOFFICE_URL || 'https://office.bbz-rd-eck.de';
const ONLYOFFICE_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET || '';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://chat.bbz-rd-eck.com';
export { PUBLIC_URL };

if (!ONLYOFFICE_JWT_SECRET) {
  console.warn('[OnlyOffice] ONLYOFFICE_JWT_SECRET is not set — JWT signing will fail');
}

// ── Office file type detection ───────────────────────────────────────────────

const OFFICE_EXTENSIONS: Record<string, string> = {
  docx: 'word', doc: 'word', odt: 'word', rtf: 'word', txt: 'word',
  xlsx: 'cell', xls: 'cell', ods: 'cell', csv: 'cell',
  pptx: 'slide', ppt: 'slide', odp: 'slide',
};

export function getOfficeDocType(fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return OFFICE_EXTENSIONS[ext] ?? null;
}

// ── Short-lived download tokens ──────────────────────────────────────────────

interface DownloadToken {
  /** Stashcat file ID (if Stashcat file) */
  fileId?: string;
  /** Nextcloud file path (if Nextcloud file) */
  ncPath?: string;
  /** Nextcloud username (required for NC files) */
  ncUsername?: string;
  /** Nextcloud app password (only for NC files, stored in short-lived token) */
  ncAppPassword?: string;
  clientKey: string;
  createdAt: number;
}

const downloadTokens = new Map<string, DownloadToken>();
const TOKEN_TTL = 60 * 60 * 1000; // 1 hour — viewing session only

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of downloadTokens) {
    if (now - entry.createdAt > TOKEN_TTL) downloadTokens.delete(key);
  }
}, 60_000);

export function createDownloadToken(opts: { fileId?: string; ncPath?: string; ncUsername?: string; ncAppPassword?: string; clientKey: string }): string {
  const secret = randomBytes(32).toString('hex');
  downloadTokens.set(secret, { createdAt: Date.now(), clientKey: opts.clientKey, fileId: opts.fileId, ncPath: opts.ncPath, ncUsername: opts.ncUsername, ncAppPassword: opts.ncAppPassword });
  return secret;
}

export function validateDownloadToken(secret: string): DownloadToken | null {
  const entry = downloadTokens.get(secret);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TOKEN_TTL) {
    downloadTokens.delete(secret);
    return null;
  }
  return entry;
}

// ── Config builder ───────────────────────────────────────────────────────────

interface EditorConfigOptions {
  fileName: string;
  userId: string;
  userName: string;
  /** URL that OnlyOffice will fetch to download the file */
  downloadUrl: string;
}

export function buildViewerConfig(opts: EditorConfigOptions) {
  const ext = opts.fileName.split('.').pop()?.toLowerCase() || '';
  const docType = OFFICE_EXTENSIONS[ext];
  if (!docType) throw new Error(`Unsupported file type: .${ext}`);

  const docKey = `${opts.downloadUrl}_view_${Date.now()}`;

  const config: Record<string, unknown> = {
    documentType: docType,
    document: {
      key: docKey,
      fileType: ext,
      title: opts.fileName,
      url: opts.downloadUrl,
      permissions: {
        edit: false,
        download: true,
        print: true,
        comment: false,
        copy: true,
      },
    },
    editorConfig: {
      mode: 'view',
      lang: 'de',
      user: {
        id: opts.userId,
        name: opts.userName,
      },
      customization: {
        chat: false,
        compactHeader: false,
      },
    },
  };

  config.token = jwt.sign(config, ONLYOFFICE_JWT_SECRET, { algorithm: 'HS256' });

  return { config, onlyofficeUrl: ONLYOFFICE_URL };
}
