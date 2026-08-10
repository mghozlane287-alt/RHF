/**
 * Stockage sécurisé des pièces jointes.
 *
 * Principes de sécurité appliqués :
 *  1. Les fichiers sont écrits HORS du dossier servi par le web : aucun accès direct
 *     par URL n'est possible, tout passe par une route authentifiée.
 *  2. Le nom de fichier sur disque est aléatoire — le nom fourni par l'utilisateur
 *     n'est jamais utilisé comme chemin (protection contre la traversée de répertoire
 *     et contre les extensions doubles du type « photo.jpg.php »).
 *  3. Le type réel est vérifié par la SIGNATURE BINAIRE du fichier, pas par l'extension
 *     ni par l'en-tête déclaré par le navigateur, tous deux falsifiables.
 *  4. Une empreinte SHA-256 est conservée : elle permet de prouver qu'un document
 *     archivé n'a pas été modifié depuis son dépôt.
 */
import { createHash, randomUUID } from 'crypto';
import { mkdir, writeFile, unlink, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ici = path.dirname(fileURLToPath(import.meta.url));

export const DOSSIER_FICHIERS = process.env.DOSSIER_FICHIERS
  || path.join(ici, '../../fichiers');

export const TAILLE_MAX = Number(process.env.TAILLE_MAX_FICHIER || 10 * 1024 * 1024); // 10 Mo

/**
 * Sur les hébergements gratuits (Render, Koyeb...), le disque est EPHEMERE : il est
 * remis à zéro à chaque redémarrage ou déploiement. Les pièces jointes déposées y
 * seraient perdues. On l'annonce clairement au démarrage plutôt que de laisser
 * découvrir la perte après coup.
 */
export const STOCKAGE_EPHEMERE = process.env.STOCKAGE_EPHEMERE === 'true';
if (STOCKAGE_EPHEMERE) {
  console.warn('[ATTENTION] STOCKAGE_EPHEMERE=true : les pieces jointes seront PERDUES '
    + 'a chaque redemarrage. Mode acceptable pour une periode de test uniquement.');
}

/** Types acceptés, identifiés par leur signature binaire (« magic bytes »). */
const SIGNATURES = [
  { mime: 'image/jpeg', ext: '.jpg', octets: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: '.png', octets: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'application/pdf', ext: '.pdf', octets: [0x25, 0x50, 0x44, 0x46] }, // %PDF
];

/** ZIP : couvre .docx et .xlsx, qui sont des archives. */
const SIGNATURE_ZIP = [0x50, 0x4b, 0x03, 0x04];

export const TYPES_ACCEPTES = 'JPEG, PNG, PDF, DOCX, XLSX';

/**
 * Détermine le type réel d'un fichier à partir de son contenu.
 * Renvoie null si le type n'est pas autorisé — c'est-à-dire si le fichier
 * n'est pas ce qu'il prétend être.
 */
export function typeReel(tampon, nomOriginal = '') {
  for (const s of SIGNATURES) {
    if (s.octets.every((o, i) => tampon[i] === o)) return { mime: s.mime, ext: s.ext };
  }
  if (SIGNATURE_ZIP.every((o, i) => tampon[i] === o)) {
    const ext = path.extname(nomOriginal).toLowerCase();
    if (ext === '.docx') return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' };
    if (ext === '.xlsx') return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' };
  }
  return null;
}

/** Nettoie le nom affiché (jamais utilisé comme chemin sur le disque). */
export function nomAffichage(nom) {
  return String(nom || 'document')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\\/]/g, '-')
    .trim()
    .slice(0, 180) || 'document';
}

/** Écrit le fichier sous un nom aléatoire et renvoie ses métadonnées. */
export async function enregistrerFichier(tampon, nomOriginal) {
  const type = typeReel(tampon, nomOriginal);
  if (!type) {
    throw Object.assign(
      new Error(`Type de fichier non autorisé. Formats acceptés : ${TYPES_ACCEPTES}.`),
      { statut: 415 }
    );
  }
  if (tampon.length > TAILLE_MAX) {
    throw Object.assign(
      new Error(`Fichier trop volumineux (maximum ${Math.round(TAILLE_MAX / 1024 / 1024)} Mo).`),
      { statut: 413 }
    );
  }

  // Répartition en sous-dossiers par mois : évite des dizaines de milliers de
  // fichiers dans un seul répertoire, et facilite les sauvegardes incrémentales.
  const mois = new Date().toISOString().slice(0, 7);
  const dossier = path.join(DOSSIER_FICHIERS, mois);
  await mkdir(dossier, { recursive: true, mode: 0o750 });

  const nomStockage = path.join(mois, `${randomUUID()}${type.ext}`);
  await writeFile(path.join(DOSSIER_FICHIERS, nomStockage), tampon, { mode: 0o640 });

  return {
    nomStockage,
    typeMime: type.mime,
    taille: tampon.length,
    empreinte: createHash('sha256').update(tampon).digest('hex'),
    nomOriginal: nomAffichage(nomOriginal),
  };
}

/**
 * Résout le chemin d'un fichier stocké en vérifiant qu'il reste bien
 * à l'intérieur du dossier de stockage (protection contre « ../ »).
 */
export function cheminSecurise(nomStockage) {
  const complet = path.resolve(DOSSIER_FICHIERS, nomStockage);
  const racine = path.resolve(DOSSIER_FICHIERS);
  if (!complet.startsWith(racine + path.sep)) {
    throw Object.assign(new Error('Chemin de fichier invalide.'), { statut: 400 });
  }
  return complet;
}

export async function supprimerFichier(nomStockage) {
  try { await unlink(cheminSecurise(nomStockage)); }
  catch { /* fichier déjà absent : la suppression en base reste valable */ }
}

export async function fichierExiste(nomStockage) {
  try { await stat(cheminSecurise(nomStockage)); return true; }
  catch { return false; }
}
