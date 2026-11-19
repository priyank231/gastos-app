// Utilidades de interfaz comunes a los modos Individual y Compartido.
import { eur } from './core.js';

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const dec = (n) => String(n).replace('.', ',');
export const APP_VERSION = '9';
export const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** Círculo de color con la inicial (color estable según el nombre). */
export function avatar(name, size = 0) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const letter = (String(name).trim()[0] || '?');
  const big = size ? `;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;border-radius:${Math.round(size * 0.3)}px` : '';
  return `<span class="avatar" style="background:hsl(${h} 52% 46%)${big}" aria-hidden="true">${esc(letter)}</span>`;
}

/** Título de tarjeta con una nota oculta tras un icono (i). Se despliega al tocar el icono. */
export const h2 = (title, note = '', style = '') =>
  `<h2${style ? ` style="${style}"` : ''}>${title}${note ? ' <button type="button" class="info" aria-expanded="false" aria-label="Más información">i</button>' : ''}</h2>`
  + (note ? `<p class="infotext" role="note" hidden>${note}</p>` : '');

document.addEventListener('click', (e) => {
  const b = e.target.closest('.info');
  if (!b) return;
  const note = b.closest('h2')?.nextElementSibling;
  if (!note?.classList.contains('infotext')) return;
  note.hidden = !note.hidden;
  b.setAttribute('aria-expanded', String(!note.hidden));
});

/** Borra la caché de la app y recarga (los datos del usuario NO se tocan: viven en localStorage/IndexedDB). */
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
 * Entrega un archivo: abre el menú Compartir del móvil (WhatsApp, Archivos, correo...) si existe;
 * si no, lo descarga. Devuelve 'shared' | 'downloaded' | 'cancelled'.
 */
export async function deliver(name, text, type) {
  const blob = text instanceof Blob ? text : new Blob([text], { type: `${type};charset=utf-8` });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';     // el usuario cerró el menú
    // cualquier otro fallo (permiso, gesto caducado): se descarga
  }
  downloadBlob(name, blob);
  return 'downloaded';
}

/** Copia texto al portapapeles (alternativa al menú Compartir). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* sin permiso */ }
    ta.remove();
    return ok;
  }
}

// ---------- lectura de tickets (OCR bajo demanda) ----------
const AUTO_KEY = 'gastos.autoread';
export const autoReadOn = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };
export const setAutoRead = (on) => { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* opcional */ } };

/** Muestra el estado de la lectura en el elemento `el` (clase: busy | ok | warn). */
export function setScanStatus(el, text, kind = '') {
  el.hidden = !text;
  el.textContent = text || '';
  el.className = `scan-status ${kind}`.trim();
}

/** Lee la foto y devuelve el resultado interpretado. Lanza Error si no se puede leer. */
export async function scanTicket(file, { categories, el }) {
  setScanStatus(el, 'Leyendo el ticket…', 'busy');
  const { readTicket } = await import('./ocr.js');
  const r = await readTicket(file, { categories, onStatus: (txt, pct) => setScanStatus(el, pct == null ? txt : `${txt} ${pct} %`, 'busy') });
  return r.parsed;
}

/** Texto para el usuario con lo que se ha leído (siempre pide revisar). */
export function describeScan(p) {
  if (p.empty) return { text: 'No se pudo leer el ticket. Rellénalo a mano.', kind: 'warn' };
  const bits = [];
  if (p.amount != null) bits.push(`importe ${eur(p.amount)}${p.amountSure ? '' : ' (dudoso)'}`);
  if (p.place) bits.push(`local ${p.place}`);
  if (p.date) bits.push(`fecha ${p.date.split('-').reverse().join('/')}`);
  return { text: `Leído: ${bits.join(', ')}. Revisa los datos antes de guardar.`, kind: p.amount != null && p.amountSure ? 'ok' : 'warn' };
}
