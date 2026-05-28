function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL || "").trim();
  return configured ? trimTrailingSlash(configured) : "";
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function getRealtimeBaseUrl(): string {
  const configured = (import.meta.env.VITE_REALTIME_WS_URL || "").trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

export function liveWsUrl(token: string): string {
  return `${getRealtimeBaseUrl()}/live?token=${encodeURIComponent(token)}`;
}
