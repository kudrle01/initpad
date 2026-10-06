// Applies the stored color theme before first paint so the page never flashes
// the wrong palette. Kept as a same-origin file because the Content Security
// Policy forbids inline scripts. Mirrors src/theme.tsx.
(function () {
  try {
    var stored = localStorage.getItem('initpad.theme');
    var dark =
      stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (error) {
    // Storage can be unavailable (private mode, blocked cookies): keep light.
  }
})();
