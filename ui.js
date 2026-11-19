// Utilidades de interfaz comunes a los modos Individual y Compartido.

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const dec = (n) => String(n).replace('.', ',');
export const APP_VERSION = '5';

/** Titulo de tarjeta con una nota oculta tras un icono (i). Se despliega al tocar el icono. */
export const h2 = (title, note = '', style = '') =>
  `<h2${style ? ` style="${style}"` : ''}>${title}${note ? ' <button type="button" class="info" aria-expanded="false" aria-label="Mas informacion">i</button>' : ''}</h2>`
  + (note ? `<p class="infotext" role="note" hidden>${note}</p>` : '');

document.addEventListener('click', (e) => {
  const b = e.target.closest('.info');
  if (!b) return;
  const note = b.closest('h2')?.nextElementSibling;
  if (!note?.classList.contains('infotext')) return;
  note.hidden = !note.hidden;
  b.setAttribute('aria-expanded', String(!note.hidden));
});

/** Borra la cache de la app y recarga (los datos del usuario NO se tocan: viven en localStorage/IndexedDB). */
export async function updateApp() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map((r) => r.unregister()));
    await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch { /* se recarga igualmente */ }
  location.reload();
}

export function banner(msg) {
  const b = $('#banner');
  b.textContent = msg;
  b.hidden = false;
}

let toastTimer;
export function toast(msg, actionLabel, fn, ms = 6000) {
  const t = $('#toast');
  t.replaceChildren(document.createTextNode(msg));
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { fn(); t.hidden = true; };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Entrega un archivo: abre el menu Compartir del movil (WhatsApp, Archivos, correo...) si existe;
 * si no, lo descarga. Devuelve 'shared' | 'downloaded' | 'cancelled'.
 */
export async function deliver(name, text, type) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';     // el usuario cerro el menu
    // cualquier otro fallo (permiso, gesto caducado): se descarga
  }
  downloadBlob(name, blob);
  return 'downloaded';
}
