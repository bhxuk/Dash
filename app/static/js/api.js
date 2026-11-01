// Thin JSON client for the Dash server. In the public demo every call is
// answered in the browser by demo.js instead, so the same UI code runs in both.

export const isDemo = document.documentElement.dataset.demo === 'true';

let demoModule;

export async function api(path, method = 'GET', body) {
  if (isDemo) {
    demoModule ??= await import('./demo.js');
    return demoModule.demoApi(path, method, body);
  }
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) options.body = JSON.stringify(body);
  let response;
  try {
    response = await fetch('api/' + path, options);
  } catch {
    throw new Error('Dash server is not reachable. Check the container is running.');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('The server returned an unexpected response.'); }
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

/** URL for a camera snapshot (cache-busted) or live MJPEG stream. */
export function cameraUrl(entityId, { stream = false } = {}) {
  if (isDemo) return demoModule ? demoModule.demoCamera(entityId) : '';
  const id = encodeURIComponent(entityId);
  return stream ? `api/home/camera/${id}?stream=1` : `api/home/camera/${id}?t=${Date.now()}`;
}
