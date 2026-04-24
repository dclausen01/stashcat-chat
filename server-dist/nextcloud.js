"use strict";
/**
 * Nextcloud WebDAV + OCS Share API client.
 * All operations use HTTP Basic Auth with the provided credentials.
 * No server-side state is stored — credentials come from each request.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.davUrl = davUrl;
exports.ncListFolder = ncListFolder;
exports.ncDownload = ncDownload;
exports.ncUpload = ncUpload;
exports.ncDelete = ncDelete;
exports.ncMove = ncMove;
exports.ncMkcol = ncMkcol;
exports.ncQuota = ncQuota;
exports.ncProbe = ncProbe;
exports.ncCreateShare = ncCreateShare;
function basicAuth(username, password) {
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}
/** Build the full WebDAV URL for a logical path. */
function davUrl(creds, logicalPath) {
    const encodedUser = encodeURIComponent(creds.username);
    const base = `${creds.baseUrl}/remote.php/dav/files/${encodedUser}`;
    const p = logicalPath.startsWith('/') ? logicalPath : '/' + logicalPath;
    return base + p;
}
/** Decoded user root path (for stripping from PROPFIND hrefs). */
function userRootDecoded(creds) {
    return `/remote.php/dav/files/${creds.username}/`;
}
// ── Minimal WebDAV PROPFIND XML parser ────────────────────────────────────────
function xmlText(block, tag) {
    // Matches both "d:tag" and "D:tag" namespace prefixes
    const m = block.match(new RegExp(`<(?:d|D):${tag}>([\\s\\S]*?)<\\/(?:d|D):${tag}>`, 'i'));
    return m?.[1]?.trim();
}
function parseWebDAVListing(xml, creds) {
    const entries = [];
    const root = userRootDecoded(creds);
    const responseRe = /<(?:d|D):response>([\s\S]*?)<\/(?:d|D):response>/gi;
    let m;
    while ((m = responseRe.exec(xml)) !== null) {
        const block = m[1];
        const hrefRaw = xmlText(block, 'href');
        if (!hrefRaw)
            continue;
        const decodedHref = decodeURIComponent(hrefRaw.trim());
        // Strip user root to get logical path
        let logicalPath = decodedHref.startsWith(root)
            ? decodedHref.slice(root.length - 1) // keep leading /
            : decodedHref;
        if (!logicalPath.startsWith('/'))
            logicalPath = '/' + logicalPath;
        // Skip the root directory entry itself
        if (logicalPath === '/' || logicalPath === '')
            continue;
        const isFolder = /<(?:d|D):collection\s*\/>/.test(block);
        // Remove trailing slash from folder paths for consistency
        const cleanPath = isFolder ? logicalPath.replace(/\/$/, '') : logicalPath;
        if (cleanPath === '')
            continue; // root again after stripping
        const nameRaw = xmlText(block, 'displayname');
        const name = nameRaw || cleanPath.split('/').filter(Boolean).pop() || cleanPath;
        const sizeRaw = xmlText(block, 'getcontentlength');
        const size = sizeRaw ? Number(sizeRaw) : undefined;
        const mime = xmlText(block, 'getcontenttype');
        const modified = xmlText(block, 'getlastmodified');
        const etag = xmlText(block, 'getetag')?.replace(/"/g, '');
        entries.push({ href: hrefRaw.trim(), name, path: cleanPath, isFolder, size, mime, modified, etag });
    }
    return entries;
}
// ── WebDAV operations ─────────────────────────────────────────────────────────
const PROPFIND_BODY = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>`;
async function ncListFolder(creds, folderPath) {
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
    return parseWebDAVListing(await res.text(), creds);
}
async function ncDownload(creds, filePath) {
    const url = davUrl(creds, filePath);
    const res = await fetch(url, {
        headers: { Authorization: basicAuth(creds.username, creds.password) },
    });
    if (!res.ok)
        throw new Error(`WebDAV GET failed: ${res.status}`);
    return res;
}
async function ncUpload(creds, filePath, data, contentType = 'application/octet-stream') {
    const url = davUrl(creds, filePath);
    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: basicAuth(creds.username, creds.password),
            'Content-Type': contentType,
        },
        body: new Uint8Array(data),
    });
    if (!res.ok)
        throw new Error(`WebDAV PUT failed: ${res.status}`);
}
async function ncDelete(creds, filePath) {
    const url = davUrl(creds, filePath);
    const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: basicAuth(creds.username, creds.password) },
    });
    if (!res.ok)
        throw new Error(`WebDAV DELETE failed: ${res.status}`);
}
async function ncMove(creds, fromPath, toPath) {
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
async function ncMkcol(creds, folderPath) {
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
async function ncQuota(creds) {
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
    if (res.status !== 207 && !res.ok)
        throw new Error(`Quota PROPFIND failed: ${res.status}`);
    const xml = await res.text();
    const availM = xml.match(/<(?:d|D):quota-available-bytes>(-?\d+)<\/(?:d|D):quota-available-bytes>/i);
    const usedM = xml.match(/<(?:d|D):quota-used-bytes>(-?\d+)<\/(?:d|D):quota-used-bytes>/i);
    return {
        used: usedM ? Number(usedM[1]) : 0,
        available: availM ? Number(availM[1]) : -1,
    };
}
/** Test credentials: returns true if PROPFIND on root succeeds. */
async function ncProbe(creds) {
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
    }
    catch {
        return false;
    }
}
// ── OCS Share API ─────────────────────────────────────────────────────────────
async function ncCreateShare(creds, filePath) {
    const ocsUrl = `${creds.baseUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`;
    const body = new URLSearchParams({
        path: filePath,
        shareType: '3', // public link
        permissions: '1', // read-only
    });
    const res = await fetch(ocsUrl, {
        method: 'POST',
        headers: {
            Authorization: basicAuth(creds.username, creds.password),
            'Content-Type': 'application/x-www-form-urlencoded',
            'OCS-APIREQUEST': 'true',
        },
        body: body.toString(),
    });
    if (!res.ok)
        throw new Error(`OCS Share failed: ${res.status}`);
    const json = await res.json();
    return { url: json.ocs.data.url, token: json.ocs.data.token };
}
