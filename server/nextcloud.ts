/**
 * Nextcloud WebDAV + OCS Share API client.
 * All operations use HTTP Basic Auth with the provided credentials.
 * No server-side state is stored — credentials come from each request.
 */

export interface NCCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

export interface NCEntry {
  href: string;
  name: string;
  path: string;      // logical path relative to user root, e.g. "/Documents/file.pdf"
  isFolder: boolean;
  size?: number;
  mime?: string;
  modified?: string;
  etag?: string;
}

export interface NCQuota {
  used: number;
  available: number; // -1 = unlimited
}

function basicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

/** Build the full WebDAV URL for a logical path. */
export function davUrl(creds: NCCredentials, logicalPath: string): string {
  const encodedUser = encodeURIComponent(creds.username);
  const base = `${creds.baseUrl}/remote.php/dav/files/${encodedUser}`;
  const p = logicalPath.startsWith('/') ? logicalPath : '/' + logicalPath;
  return base + p;
}

/** Decoded user root path (for stripping from PROPFIND hrefs). */
function userRootDecoded(creds: NCCredentials): string {
  return `/remote.php/dav/files/${creds.username}/`;
}

// ── Minimal WebDAV PROPFIND XML parser ────────────────────────────────────────

function xmlText(block: string, tag: string): string | undefined {
  // Matches both "d:tag" and "D:tag" namespace prefixes
  const m = block.match(new RegExp(`<(?:d|D):${tag}>([\\s\\S]*?)<\\/(?:d|D):${tag}>`, 'i'));
  return m?.[1]?.trim();
}

function parseWebDAVListing(xml: string, creds: NCCredentials, folderPath: string): NCEntry[] {
  const entries: NCEntry[] = [];
  const root = userRootDecoded(creds);

  const responseRe = /<(?:d|D):response>([\s\S]*?)<\/(?:d|D):response>/gi;
  let m: RegExpExecArray | null;

  while ((m = responseRe.exec(xml)) !== null) {
    const block = m[1];

    const hrefRaw = xmlText(block, 'href');
    if (!hrefRaw) continue;

    const decodedHref = decodeURIComponent(hrefRaw.trim());

    // Strip user root to get logical path
    let logicalPath = decodedHref.startsWith(root)
      ? decodedHref.slice(root.length - 1) // keep leading /
      : decodedHref;
    if (!logicalPath.startsWith('/')) logicalPath = '/' + logicalPath;

    // Skip the root directory entry itself
    if (logicalPath === '/' || logicalPath === '') continue;

    const isFolder = /<(?:d|D):collection\s*\/>/.test(block);
    // Remove trailing slash from folder paths for consistency
    const cleanPath = isFolder ? logicalPath.replace(/\/$/, '') : logicalPath;
    if (cleanPath === '') continue; // root again after stripping

    const nameRaw = xmlText(block, 'displayname');
    const name = nameRaw || cleanPath.split('/').filter(Boolean).pop() || cleanPath;

    const sizeRaw = xmlText(block, 'getcontentlength');
    const size = sizeRaw ? Number(sizeRaw) : undefined;

    const mime = xmlText(block, 'getcontenttype');
    const modified = xmlText(block, 'getlastmodified');
    const etag = xmlText(block, 'getetag')?.replace(/"/g, '');

    // Skip entries outside the requested folder (Depth:1 includes parent dirs)
  const folderPrefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
  const isInsideFolder = (path: string): boolean =>
    path === folderPath || path.startsWith(folderPrefix);
  if (!isInsideFolder(cleanPath)) continue;

  entries.push({ href: hrefRaw.trim(), name, path: cleanPath, isFolder, size, mime, modified, etag });
  }

  return entries;
}

// ── WebDAV operations ─────────────────────────────────────────────────────────

const PROPFIND_BODY = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>`;

export async function ncListFolder(creds: NCCredentials, folderPath: string): Promise<NCEntry[]> {
  const url = davUrl(creds, folderPath.endsWith('/') ? folderPath : folderPath + '/');
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: basicAuth(creds.username, creds.password),
      Depth: '1',
      'Content-Type': 'application/xml',
    },
    body: PROPFIND_BODY,
  });
  if (res.status !== 207 && !res.ok) {
    throw new Error(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`);
  }
  return parseWebDAVListing(await res.text(), creds, folderPath);
}

export async function ncDownload(creds: NCCredentials, filePath: string): Promise<Response> {
  const url = davUrl(creds, filePath);
  const res = await fetch(url, {
    headers: { Authorization: basicAuth(creds.username, creds.password) },
  });
  if (!res.ok) throw new Error(`WebDAV GET failed: ${res.status}`);
  return res;
}

export async function ncUpload(creds: NCCredentials, filePath: string, data: Buffer, contentType = 'application/octet-stream'): Promise<void> {
  const url = davUrl(creds, filePath);
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: basicAuth(creds.username, creds.password),
      'Content-Type': contentType,
    },
    body: new Uint8Array(data),
  });
  if (!res.ok) throw new Error(`WebDAV PUT failed: ${res.status}`);
}

export async function ncDelete(creds: NCCredentials, filePath: string): Promise<void> {
  const url = davUrl(creds, filePath);
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: basicAuth(creds.username, creds.password) },
  });
  if (!res.ok) throw new Error(`WebDAV DELETE failed: ${res.status}`);
}

export async function ncMove(creds: NCCredentials, fromPath: string, toPath: string): Promise<void> {
  const fromUrl = davUrl(creds, fromPath);
  const toUrl = davUrl(creds, toPath);
  const res = await fetch(fromUrl, {
    method: 'MOVE',
    headers: {
      Authorization: basicAuth(creds.username, creds.password),
      Destination: toUrl,
      Overwrite: 'F',
    },
  });
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    throw new Error(`WebDAV MOVE failed: ${res.status}`);
  }
}

export async function ncMkcol(creds: NCCredentials, folderPath: string): Promise<void> {
  const url = davUrl(creds, folderPath.endsWith('/') ? folderPath : folderPath + '/');
  const res = await fetch(url, {
    method: 'MKCOL',
    headers: { Authorization: basicAuth(creds.username, creds.password) },
  });
  // 405 = already exists, treat as OK
  if (!res.ok && res.status !== 405) {
    throw new Error(`WebDAV MKCOL failed: ${res.status}`);
  }
}

export async function ncQuota(creds: NCCredentials): Promise<NCQuota> {
  const url = davUrl(creds, '/');
  const body = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:quota-available-bytes/><d:quota-used-bytes/></d:prop></d:propfind>`;
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: basicAuth(creds.username, creds.password),
      Depth: '0',
      'Content-Type': 'application/xml',
    },
    body,
  });
  if (res.status !== 207 && !res.ok) throw new Error(`Quota PROPFIND failed: ${res.status}`);
  const xml = await res.text();
  const availM = xml.match(/<(?:d|D):quota-available-bytes>(-?\d+)<\/(?:d|D):quota-available-bytes>/i);
  const usedM = xml.match(/<(?:d|D):quota-used-bytes>(-?\d+)<\/(?:d|D):quota-used-bytes>/i);
  return {
    used: usedM ? Number(usedM[1]) : 0,
    available: availM ? Number(availM[1]) : -1,
  };
}

/** Test credentials: returns true if PROPFIND on root succeeds. */
export async function ncProbe(creds: NCCredentials): Promise<boolean> {
  try {
    const url = davUrl(creds, '/');
    const res = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        Authorization: basicAuth(creds.username, creds.password),
        Depth: '0',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>`,
    });
    return res.status === 207 || res.ok;
  } catch {
    return false;
  }
}

// ── OCS Share API ─────────────────────────────────────────────────────────────

export async function ncCreateShare(creds: NCCredentials, filePath: string, sharePassword?: string): Promise<{ url: string; token: string }> {
  const ocsUrl = `${creds.baseUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`;
  const body = new URLSearchParams({
    path: filePath,  // URLSearchParams encodes the value itself
    shareType: '3',  // public link
    permissions: '1', // read-only
  });
  if (sharePassword) body.set('password', sharePassword);
  const res = await fetch(ocsUrl, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(creds.username, creds.password),
      'Content-Type': 'application/x-www-form-urlencoded',
      'OCS-APIREQUEST': 'true',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    // Try to extract OCS error message from response body for better diagnostics
    const text = await res.text();
    let hint = text;
    try {
      const json = JSON.parse(text);
      const ocsMsg = json?.ocs?.data?.error ?? json?.ocs?.meta?.message ?? json?.message;
      if (ocsMsg) hint = ocsMsg;
    } catch { /* ignore parse errors */ }
    console.error(`[Nextcloud] OCS Share failed ${res.status}: ${hint}`);
    throw new Error(`OCS Share failed: ${res.status} — ${hint}`);
  }
  const json = await res.json() as { ocs: { data: { url: string; token: string } } };
  return { url: json.ocs.data.url, token: json.ocs.data.token };
}
