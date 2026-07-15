export async function listen<T>(
  _event: string,
  _handler: (event: { payload: T }) => void,
): Promise<() => void> {
  console.debug(`[Tauri Web] listen("${_event}") registered`);
  return () => {};
}
