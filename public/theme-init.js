// Setzt die Theme-Klasse, bevor React rendert — verhindert das weisse
// Aufblitzen beim Laden im Dark Mode.
//
// Bewusst eine eigene Datei statt eines Inline-Scripts: die CSP erlaubt
// `script-src 'self'` ohne 'unsafe-inline', ein Inline-Block wuerde vom
// Browser blockiert. Muss synchron (ohne defer/async) im <head> stehen,
// damit die Klasse vor dem ersten Paint gesetzt ist.
(function () {
  try {
    var saved = localStorage.getItem('schulchat_theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {
    /* localStorage kann blockiert sein — dann bleibt das Light-Theme */
  }
})();
