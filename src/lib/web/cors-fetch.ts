/**
 * Browser/Capacitor WebView CORS helper.
 * Tries direct fetch first, then public read-through proxies.
 */
export async function fetchTextCors(
  url: string,
  init?: RequestInit,
): Promise<string> {
  const attempts: Array<() => Promise<Response>> = [
    () => fetch(url, init),
    () => fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, init),
    () =>
      fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, init),
  ];

  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (!res.ok) {
        lastErr = new Error(`Request failed (${res.status})`);
        if (res.status === 404) throw lastErr;
        continue;
      }
      return await res.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    lastErr instanceof Error
      ? lastErr.message
      : "Network/CORS request failed",
  );
}

export async function fetchJsonCors<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const text = await fetchTextCors(url, init);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Invalid JSON response");
  }
}
