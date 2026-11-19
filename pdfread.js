// Lee un extracto en PDF EN EL MÓVIL (pdf.js): usa el texto del PDF si lo tiene y, si es una imagen
// (por ejemplo, un PDF "impreso" o tachado), lo lee con OCR probando el giro de la página.
import { openWorker, ocrWords } from './ocr.js';
import { reconstructRows } from './statement.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build';
let loading = null;

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!loading) {
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `${PDFJS}/pdf.min.js`;
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`; res(window.pdfjsLib); };
      s.onerror = () => { loading = null; rej(new Error('No se pudo descargar el lector de PDF (hace falta conexión la primera vez)')); };
      document.head.append(s);
    });
  }
  return loading;
}

/** Palabras con posición a partir del texto del propio PDF (null si la página no tiene texto). */
async function textWords(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = tc.items.filter((i) => i.str && i.str.trim());
  if (items.length < 25) return null;
  const U = window.pdfjsLib.Util;
  const words = [];
  for (const it of items) {
    const t = U.transform(vp.transform, it.transform);
    const fh = Math.hypot(t[2], t[3]) || 10;
    const perChar = (it.width || 0) / Math.max(1, it.str.length);
    let off = 0;
    for (const part of it.str.split(/(\s+)/)) {
      if (part.trim()) words.push({ text: part, x0: t[4] + off * perChar, x1: t[4] + (off + part.length) * perChar, y0: t[5] - fh, y1: t[5] });
      off += part.length;
    }
  }
  return words;
}

function rotated(canvas, deg) {
  if (deg === 0) return canvas;
  const c = document.createElement('canvas');
  const swap = deg === 90 || deg === 270;
  c.width = swap ? canvas.height : canvas.width;
  c.height = swap ? canvas.width : canvas.height;
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2);
  x.rotate((deg * Math.PI) / 180);
  x.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}

function shrunk(canvas, maxSide) {
  const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  if (k === 1) return canvas;
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

const MONTH = /^(ene|feb|mar|abr|may|jun|jul|ago|sept?|set|oct|nov|dic)$/;
const score = (words) => words.reduce((n, w) => {
  const k = w.text.toLowerCase().replace(/[^a-z]/g, '');
  return n + (MONTH.test(k) ? 1 : 0) + (k === 'balance' || k === 'fecha' ? 3 : 0);
}, 0);

async function renderPage(page, scale) {
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
}

/**
 * Devuelve { rows, mode: 'texto' | 'ocr' | 'mixto', pages }. onStatus(texto, porcentaje|null).
 */
export async function readStatement(file, { onStatus = () => {}, keepWords = false } = {}) {
  onStatus('Abriendo el PDF…', null);
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const rows = [];
  const modes = new Set();
  const dump = [];
  let worker = null, rotation = null;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      onStatus(`Leyendo página ${n} de ${pdf.numPages}…`, null);
      const page = await pdf.getPage(n);
      const words = await textWords(page);
      let pageRows = words ? reconstructRows(words) : [];
      if (pageRows.length) { modes.add('texto'); rows.push(...pageRows); continue; }

      // sin texto utilizable: OCR
      if (!worker) worker = await openWorker((t, p) => onStatus(`Página ${n}/${pdf.numPages}: ${t}`, p));
      const canvas = await renderPage(page, 2.6);
      if (rotation === null) {
        for (const deg of [0, 90, 270]) {
          onStatus(`Detectando la orientación de la página (${deg}°)…`, null);
          const w = await ocrWords(worker, shrunk(rotated(canvas, deg), 1400));
          if (score(w) >= 6) { rotation = deg; break; }
        }
        if (rotation === null) rotation = 0;
      }
      const upright = rotated(canvas, rotation);
      onStatus(`Página ${n}/${pdf.numPages}: leyendo la tabla…`, null);
      const ow = await ocrWords(worker, upright);
      if (keepWords) dump.push(ow);
      pageRows = reconstructRows(ow);
      if (pageRows.length) { modes.add('ocr'); rows.push(...pageRows); }
    }
  } finally {
    if (worker) worker.terminate().catch(() => {});
  }
  return { rows, mode: modes.size > 1 ? 'mixto' : [...modes][0] || 'ninguno', pages: pdf.numPages, rotation, words: dump };
}
