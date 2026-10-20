/* DSTRITO · utilidades compartidas (se carga ANTES del script principal) */

// Escapa texto de usuario antes de meterlo en innerHTML (evita XSS).
window.esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// fetch con token de sesión y errores uniformes ({error: "..."} del servidor).
window.apiFetch = async (path, { method = 'GET', body, auth = true } = {}) => {
  const headers = {};
  // Con FormData NO se fija Content-Type: el navegador lo pone solo, con el "boundary" que
  // necesita multipart/form-data. Si lo escribes a mano, el servidor no puede leer los archivos.
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (auth && typeof currentSession !== 'undefined' && currentSession?.token) {
    headers.Authorization = `Bearer ${currentSession.token}`;
  }
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch (_) { /* respuesta sin cuerpo */ }

  if (res.status === 401 && auth && typeof currentSession !== 'undefined' && currentSession) {
    logout();
    showToast('Tu sesión expiró. Inicia sesión de nuevo.');
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Ocurrió un error inesperado.');
    err.status = res.status;
    throw err;
  }
  return data;
};

// Estilos de campos reutilizados por los módulos.
window.DS_INPUT =
  'w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-dstrito-red';
window.DS_LABEL = 'mb-1.5 block text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-neutral-400';
