// Persistencia en el propio dispositivo (localStorage). Los datos nunca salen del teléfono
// salvo que exportes una copia de seguridad.
import { defaultData, migrate, validateImport, toLocalISO } from './core.js';

const KEY = 'mesada.data.v1';
const BACKUP_KEY = 'mesada.data.v1.prev';

export function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultData();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.error(e);
    // Si el registro principal está dañado, intenta la copia anterior.
    try {
      const prev = localStorage.getItem(BACKUP_KEY);
      if (prev) return migrate(JSON.parse(prev));
    } catch {}
    throw new Error('No se pudieron leer los datos guardados.');
  }
}

export function saveData(data) {
  const json = JSON.stringify(data);
  const current = localStorage.getItem(KEY);
  if (current) localStorage.setItem(BACKUP_KEY, current);
  localStorage.setItem(KEY, json);
  // Verificación: lo guardado debe poder leerse igual.
  if (localStorage.getItem(KEY) !== json) throw new Error('El navegador no confirmó el guardado.');
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {}
  return false;
}

export function exportJSON(data) {
  return JSON.stringify({ ...data, exportedAt: toLocalISO(new Date()), app: 'Mesada' }, null, 2);
}

export function backupFileName() {
  return `mesada-copia-${toLocalISO(new Date()).replace('T', '_').replace(':', '-')}.json`;
}

export function parseImport(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  const err = validateImport(obj);
  if (err) throw new Error(err);
  delete obj.exportedAt;
  delete obj.app;
  return migrate(obj);
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
