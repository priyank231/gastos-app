// Copia COMPLETA para cambiar de móvil: modo individual + modo compartido + fotos de tickets + ajustes, en un solo archivo.
// Lógica pura (sin DOM): la lectura/escritura de fotos y localStorage la hace app.js.
import { validateBackup, defaultData } from './core.js';
import { validateShared } from './shared.js';

export const BACKUP_APP = 'gastos-copia-completa';

/** photos: { photoId: dataURL }. settings: { autoRead: boolean }. */
export function buildBackup({ individual, shared, photos = {}, settings = {} }) {
  return {
    app: BACKUP_APP, version: 3, created: new Date().toISOString(),
    individual, shared: shared && shared.groupId ? shared : null, photos, settings,
  };
}

/**
 * Lee una copia. Acepta:
 *  - la copia completa (esta),
 *  - la copia antigua del modo individual (solo datos individuales).
 * Devuelve { individual, shared|null, photos, settings, kind }. Lanza Error si no es una copia válida.
 */
export function parseBackup(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Archivo no válido');
  if (obj.app === BACKUP_APP) {
    const individual = obj.individual ? validateBackup(obj.individual) : defaultData();
    const shared = obj.shared ? validateShared(obj.shared) : null;
    const photos = {};
    for (const [k, v] of Object.entries(obj.photos || {})) {
      if (typeof v === 'string' && v.startsWith('data:image/')) photos[String(k).slice(0, 40)] = v;
    }
    return { kind: 'completa', individual, shared: shared && shared.groupId ? shared : null, photos,
      settings: { autoRead: obj.settings?.autoRead !== false } };
  }
  if (Array.isArray(obj.expenses) && Array.isArray(obj.categories)) {
    return { kind: 'individual', individual: validateBackup(obj), shared: null, photos: {}, settings: {} };
  }
  throw new Error('No es una copia de Gastos');
}

/** Resumen legible para confirmar antes de restaurar. */
export function describeBackup(b) {
  const d = b.individual;
  const parts = [`${d.expenses.length} gastos`, `${d.incomes.length} ingresos`, `${d.categories.length} categorías`];
  if (d.investments.length) parts.push(`${d.investments.length} inversiones`);
  if (b.shared) parts.push(`modo compartido: ${b.shared.entries.filter((e) => !e.deleted).length} movimientos`);
  const n = Object.keys(b.photos).length;
  if (n) parts.push(`${n} fotos`);
  return parts.join(', ');
}
