(function () {
  try {
    var STORAGE_KEY = "theme";
    var stored = localStorage.getItem(STORAGE_KEY);
    var isDark =
      stored === "dark" ||
      ((stored !== "light") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
  } catch {
    // localStorage may be unavailable; fall back to the default (light) theme.
  }
})();
