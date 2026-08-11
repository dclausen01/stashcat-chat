// Viewer-Bootstrap fuer OnlyOffice.
//
// Bewusst eine eigene Datei statt eines Inline-Scripts: die CSP erlaubt
// `script-src 'self' <ONLYOFFICE_URL-Origin>` ohne 'unsafe-inline' — ein
// Inline-Block wuerde vom Browser blockiert und die Seite bliebe auf
// "Dokument wird geladen..." stehen.
(function () {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');

  function showError(msg) {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'flex';
    errorEl.textContent = msg;
  }

  // Die erlaubte OnlyOffice-Origin kommt vom Server (aus ONLYOFFICE_URL) —
  // derselben Quelle, aus der auch die CSP gebaut wird. Damit gibt es keine
  // zweite, manuell zu pflegende Host-Allowlist, die auseinanderlaufen kann.
  // Dev laeuft auf dem Vite-Port ohne /api-Proxy, daher beide Pfade probieren.
  async function loadAllowedOrigin() {
    for (const path of ['/api/config', '/backend/api/config']) {
      try {
        const res = await fetch(path);
        if (!res.ok) continue;
        const data = await res.json();
        if (data && data.onlyofficeUrl) return new URL(data.onlyofficeUrl).origin;
      } catch (e) {
        /* naechsten Pfad probieren */
      }
    }
    return null;
  }

  async function boot() {
    const hash = window.location.hash.slice(1);
    if (!hash) {
      showError('Keine Konfiguration gefunden. Bitte Dokument erneut öffnen.');
      return;
    }

    let config;
    let onlyofficeUrl;
    try {
      ({ config, onlyofficeUrl } = JSON.parse(decodeURIComponent(atob(hash))));
    } catch (e) {
      showError('Ungültige Konfiguration.');
      return;
    }
    if (!config || !onlyofficeUrl) {
      showError('Ungültige Konfiguration.');
      return;
    }

    // Sicherheitsprüfung (P0, B1): Das OnlyOffice-API-Skript darf nur von der
    // konfigurierten Instanz geladen werden. Der #hash ist vom Aufrufer
    // kontrollierbar — ohne diese Prüfung konnte ein praeparierter Chat-Link
    // beliebiges JS auf der Chat-Origin ausführen (Token-Diebstahl).
    // Fail-closed: ohne bekannte Server-Origin wird nichts geladen.
    const allowedOrigin = await loadAllowedOrigin();
    if (!allowedOrigin) {
      showError('OnlyOffice-Konfiguration konnte nicht geprüft werden. Bitte später erneut versuchen.');
      return;
    }

    let parsedOoUrl;
    try {
      parsedOoUrl = new URL(onlyofficeUrl);
    } catch (e) {
      showError('Ungültige OnlyOffice-URL.');
      return;
    }
    if (parsedOoUrl.protocol !== 'https:' || parsedOoUrl.origin !== allowedOrigin) {
      showError('OnlyOffice-Quelle nicht erlaubt.');
      return;
    }

    const script = document.createElement('script');
    script.src = onlyofficeUrl + '/web-apps/apps/api/documents/api.js';
    script.onerror = () => showError('OnlyOffice Document Server ist nicht erreichbar: ' + onlyofficeUrl);
    script.onload = () => {
      loadingEl.style.display = 'none';
      try {
        new DocsAPI.DocEditor('editor', config);
      } catch (e) {
        showError('Viewer konnte nicht gestartet werden: ' + e.message);
      }
    };
    document.head.appendChild(script);
  }

  boot().catch((e) => showError('Fehler beim Laden: ' + e.message));
})();
