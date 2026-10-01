// Level sharing API (served by the separate api container under /api).

async function request(path, options = {}) {
  let resp;
  try {
    resp = await fetch(path, {
      ...options,
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch {
    throw new Error("Couldn't reach the level server. Check your internet and try again.");
  }
  let data = null;
  try {
    data = await resp.json();
  } catch {
    // not JSON (for example a proxy error page)
  }
  if (!resp.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : null;
    throw new Error(detail || `The level server had a problem (${resp.status}).`);
  }
  return data;
}

export const shareLevel = (level) =>
  request("/api/levels", { method: "POST", body: JSON.stringify({ level }) });

export const getLevel = (code) => request(`/api/levels/${encodeURIComponent(code)}`);

export const recentLevels = () => request("/api/levels?limit=12");
