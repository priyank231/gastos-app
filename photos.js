// Fotos de tickets: se guardan en IndexedDB del movil (localStorage no cabe) y se comprimen antes.

const DB = 'gastos-photos';
const ST = 'photos';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(ST, mode);
    const req = fn(t.objectStore(ST));
    t.oncomplete = () => { db.close(); res(req?.result); };
    t.onerror = () => { db.close(); rej(t.error); };
    t.onabort = () => { db.close(); rej(t.error); };
  });
}

export const putPhoto = (id, blob) => tx('readwrite', (s) => s.put({ id, blob }));
export const delPhoto = (id) => tx('readwrite', (s) => s.delete(id));
export async function getPhoto(id) {
  try { return (await tx('readonly', (s) => s.get(id)))?.blob || null; } catch { return null; }
}

/** Reduce la foto (lado mayor 1280 px, JPEG 0,7): ~150-300 KB en vez de varios MB. */
export async function compress(file, maxDim = 1280, quality = 0.7) {
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
  const k = Math.min(1, maxDim / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo comprimir'))), 'image/jpeg', quality));
}

export const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result); r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
export const dataURLToBlob = async (url) => (await fetch(url)).blob();
