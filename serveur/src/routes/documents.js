import { Router } from 'express';
import multer from 'multer';
import { readFile } from 'fs/promises';
import { z } from 'zod';
import { q } from '../lib/db.js';
import { exigerAuth, exigerMdpChange, exigerRole, portee } from '../lib/auth.js';
import { journaliser } from '../lib/audit.js';
import {
  enregistrerFichier, supprimerFichier, cheminSecurise, fichierExiste,
  TAILLE_MAX, TYPES_ACCEPTES,
} from '../lib/fichiers.js';

const r = Router();
r.use(exigerAuth, exigerMdpChange);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAILLE_MAX, files: 1 } });

const CATEGORIES = ['Photo', 'Contrat de travail', "Pièce d'identité", 'Diplôme',
  'Certificat médical', 'Attestation de travail', 'Habilitation',
  'Contrat de sous-traitance', 'Justificatif de congé', 'Autre'];

/** Vérifie que le compte a le droit de voir/agir sur les documents d'un employé. */
async function autoriseSurEmploye(compte, employeId) {
  const p = portee(compte);
  if (p.tous) return true;
  const { rows } = await q('SELECT service_id, chantier_id FROM employes WHERE id=$1', [employeId]);
  const e = rows[0];
  if (!e) return false;
  if (p.chantierId) return e.chantier_id === p.chantierId;
  return e.service_id === p.serviceId;
}

// ---------- Liste des documents d'une entité ----------
r.get('/documents', async (req, res) => {
  const employeId = req.query.employeId ? Number(req.query.employeId) : null;
  const societeId = req.query.societeId ? Number(req.query.societeId) : null;
  const congeId = req.query.congeId ? Number(req.query.congeId) : null;

  if (employeId && !(await autoriseSurEmploye(req.compte, employeId))) {
    return res.status(403).json({ erreur: 'Cet employé ne relève pas de votre périmètre.' });
  }
  if ((societeId || congeId) && !['rh', 'direction'].includes(req.compte.role)) {
    return res.status(403).json({ erreur: 'Accès réservé au service RH.' });
  }
  if (!employeId && !societeId && !congeId) {
    return res.status(400).json({ erreur: 'Précisez employeId, societeId ou congeId.' });
  }

  const { rows } = await q(
    `SELECT id, categorie, nom_original, type_mime, taille_octets, empreinte_sha256,
            to_char(date_document,'YYYY-MM-DD') AS date_document,
            to_char(date_expiration,'YYYY-MM-DD') AS date_expiration,
            description, ajoute_par, ajoute_le
     FROM documents
     WHERE ($1::int IS NULL OR employe_id=$1)
       AND ($2::int IS NULL OR societe_id=$2)
       AND ($3::int IS NULL OR conge_id=$3)
       AND (($1::int IS NOT NULL AND employe_id IS NOT NULL)
         OR ($2::int IS NOT NULL AND societe_id IS NOT NULL)
         OR ($3::int IS NOT NULL AND conge_id IS NOT NULL))
     ORDER BY categorie, ajoute_le DESC`,
    [employeId, societeId, congeId]);
  res.json(rows);
});

// ---------- Dépôt ----------
const schemaMeta = z.object({
  categorie: z.enum(CATEGORIES),
  employeId: z.coerce.number().int().positive().optional(),
  societeId: z.coerce.number().int().positive().optional(),
  congeId: z.coerce.number().int().positive().optional(),
  dateDocument: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  dateExpiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  description: z.string().max(300).optional(),
});

r.post('/documents', exigerRole('rh'), upload.single('fichier'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ erreur: `Aucun fichier reçu (champ « fichier », ${TYPES_ACCEPTES}, ${Math.round(TAILLE_MAX / 1024 / 1024)} Mo max).` });
  }
  const p = schemaMeta.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Métadonnées du document invalides.' });

  const rattachements = [p.data.employeId, p.data.societeId, p.data.congeId].filter(Boolean);
  if (rattachements.length !== 1) {
    return res.status(400).json({ erreur: 'Le document doit être rattaché à un employé, une société ou un congé — et à un seul.' });
  }

  let meta;
  try {
    meta = await enregistrerFichier(req.file.buffer, req.file.originalname);
  } catch (e) {
    return res.status(e.statut || 400).json({ erreur: e.message });
  }

  try {
    // Une photo remplace la précédente plutôt que de s'y ajouter.
    if (p.data.categorie === 'Photo' && p.data.employeId) {
      const ancienne = (await q(`SELECT nom_stockage FROM documents WHERE employe_id=$1 AND categorie='Photo'`, [p.data.employeId])).rows[0];
      if (ancienne) {
        await q(`DELETE FROM documents WHERE employe_id=$1 AND categorie='Photo'`, [p.data.employeId]);
        await supprimerFichier(ancienne.nom_stockage);
      }
    }

    const { rows } = await q(
      `INSERT INTO documents (employe_id, societe_id, conge_id, categorie, nom_original, nom_stockage,
                              type_mime, taille_octets, empreinte_sha256, date_document, date_expiration,
                              description, ajoute_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, categorie, nom_original, type_mime, taille_octets, empreinte_sha256,
                 to_char(date_document,'YYYY-MM-DD') AS date_document,
                 to_char(date_expiration,'YYYY-MM-DD') AS date_expiration,
                 description, ajoute_par, ajoute_le`,
      [p.data.employeId ?? null, p.data.societeId ?? null, p.data.congeId ?? null,
       p.data.categorie, meta.nomOriginal, meta.nomStockage, meta.typeMime, meta.taille,
       meta.empreinte, p.data.dateDocument || null, p.data.dateExpiration || null,
       p.data.description ?? '', req.compte.email]);

    await journaliser(req, 'depot_document', `document:${rows[0].id}`,
      { categorie: p.data.categorie, empreinte: meta.empreinte.slice(0, 16) });
    res.status(201).json(rows[0]);
  } catch (e) {
    await supprimerFichier(meta.nomStockage); // pas d'orphelin sur le disque
    res.status(400).json({ erreur: 'Enregistrement impossible : ' + String(e.message || '') });
  }
});

// ---------- Téléchargement ----------
r.get('/documents/:id/fichier', async (req, res) => {
  const { rows } = await q('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ erreur: 'Document introuvable.' });

  if (d.employe_id && !(await autoriseSurEmploye(req.compte, d.employe_id))) {
    return res.status(403).json({ erreur: 'Ce document ne relève pas de votre périmètre.' });
  }
  if ((d.societe_id || d.conge_id) && !['rh', 'direction'].includes(req.compte.role)) {
    return res.status(403).json({ erreur: 'Accès réservé au service RH.' });
  }
  if (!(await fichierExiste(d.nom_stockage))) {
    return res.status(410).json({ erreur: 'Le fichier n\'est plus présent sur le serveur. Restaurez une sauvegarde.' });
  }

  const contenu = await readFile(cheminSecurise(d.nom_stockage));
  const enLigne = d.type_mime.startsWith('image/') || d.type_mime === 'application/pdf';

  // Empêche l'interprétation du fichier comme du code par le navigateur.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; object-src 'none'");
  res.setHeader('Content-Disposition',
    `${enLigne ? 'inline' : 'attachment'}; filename="${encodeURIComponent(d.nom_original)}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.type(d.type_mime).send(contenu);
});

// ---------- Suppression ----------
r.delete('/documents/:id', exigerRole('rh'), async (req, res) => {
  const { rows } = await q('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Document introuvable.' });
  await q('DELETE FROM documents WHERE id=$1', [req.params.id]);
  await supprimerFichier(rows[0].nom_stockage);
  await journaliser(req, 'suppression_document', `document:${req.params.id}`,
    { categorie: rows[0].categorie, nom: rows[0].nom_original });
  res.json({ ok: true });
});

// ---------- Documents arrivant à expiration ----------
r.get('/documents-expirants', exigerRole('rh', 'direction'), async (req, res) => {
  const jours = Math.min(Math.max(Number(req.query.jours) || 60, 1), 365);
  const { rows } = await q(
    `SELECT d.id, d.categorie, d.nom_original,
            to_char(d.date_expiration,'YYYY-MM-DD') AS date_expiration,
            e.id AS employe_id, e.nom, e.prenom, e.matricule
     FROM documents d
     LEFT JOIN employes e ON e.id = d.employe_id
     WHERE d.date_expiration IS NOT NULL
       AND d.date_expiration <= CURRENT_DATE + ($1 || ' days')::interval
     ORDER BY d.date_expiration`, [jours]);
  res.json(rows);
});

export default r;
