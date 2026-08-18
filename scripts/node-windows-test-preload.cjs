// Node 24 can report uv_os_get_passwd ENOMEM on Windows under high commit
// pressure. tsx only needs a stable per-user cache suffix, so keep this
// workaround confined to test tooling and inherited test subprocesses.
if (process.platform === "win32" && typeof process.geteuid !== "function") {
  Object.defineProperty(process, "geteuid", {
    configurable: true,
    value: () => 0,
  });

  const preloadOption = `--require=${JSON.stringify(__filename)}`;
  const existingOptions = process.env.NODE_OPTIONS?.trim();
  if (!existingOptions?.includes(__filename)) {
    process.env.NODE_OPTIONS = existingOptions
      ? `${existingOptions} ${preloadOption}`
      : preloadOption;
  }
}
