// Lee el texto de la foto de un ticket EN EL MOVIL (Tesseract.js, WASM). La foto no sale del dispositivo:
// solo se descarga el lector (~7 MB, una vez; queda en cache) desde jsDelivr.
import { parseTicket } from './ticket.js';

const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist';
const CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0';
const LANG = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/4.0.0_best_int';

let loading = null;
function loadLib() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `${TESS}/tesseract.min.js`;
      s.onload = () => res(window.Tesseract);
      s.onerror = () => { loading = null; rej(new Error('No se pudo descargar el lector de tickets (hace falta conexión la primera vez)')); };
      document.head.append(s);
    });
  }
  return loading;
}

/** Foto -> lienzo en gris con contraste estirado, lado mayor <= 2400 px (el texto pequeno necesita resolucion). */
export async function toOcrCanvas(file, maxDim = 2400) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = () => rej(new Error('Imagen no valida'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  const k = Math.min(1.5, maxDim / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const px = img.data, hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
    px[i] = g; hist[g]++;
  }
  const total = px.length / 4;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const g = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span));
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const STATUS = {
  'loading tesseract core': 'Preparando el lector…',
  'initializing tesseract': 'Preparando el lector…',
  'initialized tesseract': 'Preparando el lector…',
  'loading language traineddata': 'Descargando idioma (solo la primera vez)…',
  'loaded language traineddata': 'Preparando el lector…',
  'initializing api': 'Preparando el lector…',
  'initialized api': 'Preparando el lector…',
};

/**
 * Lee un ticket y devuelve { text, parsed }. `onStatus(texto, porcentaje|null)` informa del progreso.
 * El worker se destruye al terminar para no ocupar memoria del móvil.
 */
export async function readTicket(file, { categories = [], onStatus = () => {} } = {}) {
  onStatus('Preparando la foto…', null);
  const canvas = await toOcrCanvas(file);
  onStatus('Descargando el lector (solo la primera vez)…', null);
  const T = await loadLib();
  const worker = await T.createWorker('spa', 1, {
    workerPath: `${TESS}/worker.min.js`, corePath: CORE, langPath: LANG,
    logger: (m) => {
      if (m.status === 'recognizing text') onStatus('Leyendo el ticket…', Math.round((m.progress || 0) * 100));
      else if (STATUS[m.status]) onStatus(STATUS[m.status], null);
    },
  });
  try {
    const { data } = await worker.recognize(canvas);
    return { text: data.text || '', parsed: parseTicket(data.text || '', { categories }) };
  } finally {
    worker.terminate().catch(() => {});
  }
}
