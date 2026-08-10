/**
 * Fonctions de sécurité côté client.
 * 1) echapperHtml : neutralise toute injection HTML/JS dans les documents imprimés
 *    (les noms, postes et motifs peuvent provenir d'un import Excel non fiable).
 * 2) protegerCelluleExcel : neutralise l'injection de formules dans les exports
 *    (une cellule commençant par = + - @ serait exécutée par Excel à l'ouverture).
 */
export function echapperHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function protegerCelluleExcel<T>(v: T): T | string {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

export function protegerLigneExcel<T extends Record<string, unknown>>(ligne: T): Record<string, unknown> {
  const sortie: Record<string, unknown> = {};
  for (const k of Object.keys(ligne)) sortie[k] = protegerCelluleExcel(ligne[k]);
  return sortie;
}
