import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { q, pool } from '../lib/db.js';
import { exigerAuth, exigerRole, exigerMdpChange, portee } from '../lib/auth.js';
import { journaliser } from '../lib/audit.js';
import { supprimerFichier } from '../lib/fichiers.js';

const r = Router();
r.use(exigerAuth, exigerMdpChange);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // 2 Mo max
});

const protegerCellule = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
const dateISO = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    const tz = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
    return tz.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};

// ---------- Lecture (portée par rôle) ----------
r.get('/', async (req, res) => {
  const p = portee(req.compte);
  const conditions = [];
  const params = [];

  if (!p.tous) {
    if (p.chantierId) { params.push(p.chantierId); conditions.push(`chantier_id=$${params.length}`); }
    else { params.push(p.serviceId); conditions.push(`service_id=$${params.length}`); }
  }
  // Par defaut on ne montre que l'effectif present ; ?inclureSortis=1 pour l'historique (RH).
  if (req.query.inclureSortis !== '1') conditions.push('actif');
  // Recherche serveur : indispensable au-delà de quelques centaines d'employés.
  const recherche = String(req.query.recherche || '').trim().slice(0, 100);
  if (recherche) {
    params.push(`%${recherche.toLowerCase()}%`);
    conditions.push(`(lower(nom) LIKE $${params.length} OR lower(prenom) LIKE $${params.length} OR lower(poste) LIKE $${params.length})`);
  }
  if (req.query.societeId) { params.push(Number(req.query.societeId)); conditions.push(`societe_id=$${params.length}`); }

  // Par défaut on ne liste que le personnel présent. Les employés sortis de l'effectif
  // restent consultables via ?inclureSortis=1 (leurs dossiers sont conservés).
  if (req.query.inclureSortis !== '1') conditions.push('actif');

  const ou = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const total = Number((await q(`SELECT count(*)::int AS n FROM employes${ou}`, params)).rows[0].n);

  // Pagination : limite haute pour protéger le serveur et le réseau des chantiers.
  const limite = Math.min(Math.max(Number(req.query.limite) || 500, 1), 1000);
  const page = Math.max(Number(req.query.page) || 1, 1);
  params.push(limite, (page - 1) * limite);
  const { rows } = await q(
    `SELECT * FROM employes${ou} ORDER BY nom, prenom LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  res.json({ employes: rows, total, page, limite });
});

// ---------- Écriture (RH) ----------
const texte = (max) => z.string().trim().max(max).default('');
const dateOpt = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const schemaEmploye = z.object({
  // Identité
  prenom: z.string().trim().min(1).max(100),
  nom: z.string().trim().min(1).max(100),
  matricule: texte(30).optional(),
  dateNaissance: dateOpt,
  lieuNaissance: texte(120).optional(),
  sexe: z.enum(['M', 'F']).default('M'),
  numIdentite: texte(30).optional(),
  numCnas: texte(30).optional(),
  situationFamiliale: z.enum(['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf/Veuve']).default('Célibataire'),
  enfantsACharge: z.number().int().min(0).max(30).default(0),
  groupeSanguin: texte(5).optional(),
  // Coordonnées
  adresse: texte(300).optional(),
  wilayaResidence: texte(60).optional(),
  urgenceNom: texte(120).optional(),
  urgenceLien: texte(60).optional(),
  urgenceTelephone: texte(30).optional(),
  // Contrat et paie
  poste: z.string().trim().min(1).max(200),
  niveauQualification: texte(60).optional(),
  categorieConventionnelle: texte(60).optional(),
  salaireBase: z.number().min(0).max(99999999).default(0),
  rib: texte(40).optional(),
  finPeriodeEssai: dateOpt,
  observations: texte(1000).optional(),
  societeId: z.number().int().positive(),
  serviceId: z.number().int().positive().nullable().optional(),
  chantierId: z.number().int().positive().nullable().optional(),
  categorie: z.enum(['Chantier', 'Administratif']),
  rotationId: z.number().int().positive().nullable().optional(),
  debutCycle: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  email: z.string().max(200).default(''),
  telephone: z.string().max(50).default(''),
  dateEmbauche: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  soldeConges: z.number().min(0).max(999),
  typeContrat: z.enum(['CDI', 'CDD']),
  finContrat: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  prochaineVisiteMedicale: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

async function normaliser(d) {
  if (d.categorie === 'Chantier') {
    if (!d.chantierId) throw new Error('Un employé de chantier doit être affecté à un chantier.');
    const { rows } = await q('SELECT service_id FROM chantiers WHERE id=$1', [d.chantierId]);
    if (!rows[0]) throw new Error('Chantier introuvable.');
    d.serviceId = rows[0].service_id;
  } else {
    if (!d.serviceId) throw new Error('Un employé administratif doit être affecté à un service.');
    d.chantierId = null; d.rotationId = null; d.debutCycle = null;
  }
  if (d.typeContrat === 'CDD' && !d.finContrat) throw new Error('Un CDD doit avoir une date de fin.');
  if (d.typeContrat === 'CDI') d.finContrat = null;
  return d;
}

const COLS = `prenom,nom,poste,societe_id,service_id,chantier_id,categorie,rotation_id,debut_cycle,
  email,telephone,date_embauche,solde_conges,type_contrat,fin_contrat,prochaine_visite_medicale,
  matricule,date_naissance,lieu_naissance,sexe,num_identite,num_cnas,situation_familiale,enfants_a_charge,
  adresse,wilaya_residence,urgence_nom,urgence_lien,urgence_telephone,groupe_sanguin,
  salaire_base,categorie_conventionnelle,rib,niveau_qualification,fin_periode_essai,observations`;

const NB_COLS = 36;
const PLACEHOLDERS = Array.from({ length: NB_COLS }, (_, i) => `$${i + 1}`).join(',');

const vals = (d) => [
  d.prenom, d.nom, d.poste, d.societeId, d.serviceId, d.chantierId ?? null, d.categorie,
  d.rotationId ?? null, d.debutCycle ?? null, d.email ?? '', d.telephone ?? '', d.dateEmbauche,
  d.soldeConges, d.typeContrat, d.finContrat ?? null, d.prochaineVisiteMedicale ?? null,
  d.matricule || null, d.dateNaissance ?? null, d.lieuNaissance ?? '', d.sexe ?? 'M',
  d.numIdentite ?? '', d.numCnas ?? '', d.situationFamiliale ?? 'Célibataire', d.enfantsACharge ?? 0,
  d.adresse ?? '', d.wilayaResidence ?? '', d.urgenceNom ?? '', d.urgenceLien ?? '',
  d.urgenceTelephone ?? '', d.groupeSanguin ?? '', d.salaireBase ?? 0,
  d.categorieConventionnelle ?? '', d.rib ?? '', d.niveauQualification ?? '',
  d.finPeriodeEssai ?? null, d.observations ?? '',
];

/** Attribue un matricule automatique si le RH n'en fournit pas (format AIFG-0001). */
async function assurerMatricule(d) {
  if (d.matricule && d.matricule.trim()) return d;
  const prefixe = 'AIFG';
  const { rows } = await q("SELECT nextval('seq_matricule') AS n");
  d.matricule = `${prefixe}-${String(rows[0].n).padStart(4, '0')}`;
  return d;
}

r.post('/', exigerRole('rh'), async (req, res) => {
  const p = schemaEmploye.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Données employé invalides : ' + (p.error.issues[0]?.path?.join('.') || '') });
  try {
    const d = await assurerMatricule(await normaliser(p.data));
    const { rows } = await q(`INSERT INTO employes (${COLS}) VALUES (${PLACEHOLDERS}) RETURNING *`, vals(d));
    await journaliser(req, 'creation', `employe:${rows[0].id}`, { nom: d.nom });
    res.status(201).json(rows[0]);
  } catch (e) {
    const m = String(e.message || '');
    if (m.includes('uq_employes_matricule')) return res.status(409).json({ erreur: 'Ce matricule est déjà attribué à un autre employé.' });
    if (m.includes('uq_employes_cnas')) return res.status(409).json({ erreur: 'Ce numéro de sécurité sociale (CNAS) est déjà enregistré.' });
    res.status(400).json({ erreur: m || 'Création impossible.' });
  }
});

r.put('/:id', exigerRole('rh'), async (req, res) => {
  const p = schemaEmploye.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Données employé invalides.' });
  try {
    const d = await normaliser(p.data);
    const affectations = COLS.split(',').map((c, i) => `${c.trim()}=$${i + 1}`).join(',');
    const { rows } = await q(
      `UPDATE employes SET ${affectations} WHERE id=$${NB_COLS + 1} RETURNING *`, [...vals(d), req.params.id]);
    if (!rows[0]) return res.status(404).json({ erreur: 'Employé introuvable.' });
    await journaliser(req, 'modification', `employe:${req.params.id}`);
    res.json(rows[0]);
  } catch (e) { res.status(400).json({ erreur: String(e.message || 'Modification impossible.') }); }
});

/**
 * Sortie d'effectif. On ne supprime PAS l'employe : ses feuilles de pointage archivees
 * sont des pieces justificatives de paie (conservation legale). La suppression definitive
 * n'est possible que s'il n'a aucun historique.
 */
r.delete('/:id', exigerRole('rh'), async (req, res) => {
  const motif = String(req.body?.motif || '').slice(0, 200);
  const dateSortie = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.dateSortie || '')
    ? req.body.dateSortie : new Date().toISOString().slice(0, 10);

  const historique = await q(
    `SELECT (SELECT count(*) FROM lignes_pointage WHERE employe_id=$1)::int AS pointages,
            (SELECT count(*) FROM conges WHERE employe_id=$1)::int AS conges`, [req.params.id]);
  const { pointages, conges } = historique.rows[0];

  if (pointages === 0 && conges === 0 && req.query.definitif === '1') {
    // Les fichiers physiques doivent partir avec la fiche : la cascade en base
    // supprime les métadonnées, pas les fichiers sur le disque.
    const docs = await q('SELECT nom_stockage FROM documents WHERE employe_id=$1', [req.params.id]);
    for (const d of docs.rows) await supprimerFichier(d.nom_stockage);
    await q('DELETE FROM employes WHERE id=$1', [req.params.id]);
    await journaliser(req, 'suppression_definitive', `employe:${req.params.id}`, { motif });
    return res.json({ ok: true, mode: 'supprime' });
  }

  const { rows } = await q(
    'UPDATE employes SET actif=FALSE, date_sortie=$1, motif_sortie=$2 WHERE id=$3 RETURNING id, nom, prenom',
    [dateSortie, motif, req.params.id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Employe introuvable.' });
  await journaliser(req, 'sortie_effectif', `employe:${req.params.id}`, { motif, dateSortie, pointages, conges });
  res.json({ ok: true, mode: 'sorti_effectif', historiqueConserve: { pointages, conges } });
});

/** Reintegration d'un employe sorti de l'effectif. */
r.post('/:id/reintegrer', exigerRole('rh'), async (req, res) => {
  const { rows } = await q(
    'UPDATE employes SET actif=TRUE, date_sortie=NULL, motif_sortie=NULL WHERE id=$1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Employe introuvable.' });
  await journaliser(req, 'reintegration', `employe:${req.params.id}`);
  res.json(rows[0]);
});

// ---------- Export Excel (RH / Direction) ----------
r.get('/export.xlsx', exigerRole('rh', 'direction'), async (_req, res) => {
  const { rows } = await q(`
    SELECT e.*, s.nom AS societe, sv.nom AS service, ch.nom AS chantier, ro.nom AS rotation
    FROM employes e
    JOIN societes s ON s.id=e.societe_id
    JOIN services sv ON sv.id=e.service_id
    LEFT JOIN chantiers ch ON ch.id=e.chantier_id
    LEFT JOIN rotations ro ON ro.id=e.rotation_id
    ORDER BY e.nom`);
  const lignes = rows.map((e) => Object.fromEntries(Object.entries({
    'Matricule': e.matricule ?? '', 'Nom': e.nom, 'Prénom': e.prenom, 'Sexe': e.sexe,
    'Date naissance': e.date_naissance ? String(e.date_naissance).slice(0, 10) : '',
    'Lieu naissance': e.lieu_naissance, 'N° identité': e.num_identite, 'N° CNAS': e.num_cnas,
    'Situation familiale': e.situation_familiale, 'Enfants à charge': e.enfants_a_charge,
    'Groupe sanguin': e.groupe_sanguin, 'Adresse': e.adresse, 'Wilaya résidence': e.wilaya_residence,
    'Contact urgence': e.urgence_nom, 'Lien urgence': e.urgence_lien, 'Tél. urgence': e.urgence_telephone,
    'Poste': e.poste, 'Qualification': e.niveau_qualification, 'Catégorie conventionnelle': e.categorie_conventionnelle,
    'Salaire de base': Number(e.salaire_base), 'RIB': e.rib,
    'Fin période essai': e.fin_periode_essai ? String(e.fin_periode_essai).slice(0, 10) : '',
    'Société': e.societe,
    'Service': e.service, 'Chantier': e.chantier ?? '', 'Catégorie': e.categorie,
    'Rotation': e.rotation ?? '', 'Début cycle': e.debut_cycle ? String(e.debut_cycle).slice(0, 10) : '',
    'Email': e.email, 'Téléphone': e.telephone,
    'Date embauche': String(e.date_embauche).slice(0, 10), 'Solde congés': Number(e.solde_conges),
    'Contrat': e.type_contrat, 'Fin contrat': e.fin_contrat ? String(e.fin_contrat).slice(0, 10) : '',
    'Prochaine visite médicale': e.prochaine_visite_medicale ? String(e.prochaine_visite_medicale).slice(0, 10) : '',
    'Observations': e.observations,
    'Statut': e.actif ? 'En activité' : 'Sorti de l\'effectif',
    'Date de sortie': e.date_sortie ? String(e.date_sortie).slice(0, 10) : '',
    'Motif de sortie': e.motif_sortie ?? '',
  }).map(([k, v]) => [k, protegerCellule(v)])));
  const ws = XLSX.utils.json_to_sheet(lignes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employés');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="employes_aifg.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
});

// ---------- Import Excel (RH) ----------
r.post('/import', exigerRole('rh'), upload.single('fichier'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erreur: 'Aucun fichier reçu (champ « fichier », .xlsx, 2 Mo max).' });
  // Vérification de la signature réelle du fichier : un .xlsx est une archive ZIP (« PK\x03\x04 »).
  const sig = req.file.buffer.subarray(0, 4);
  if (!(sig[0] === 0x50 && sig[1] === 0x4b && sig[2] === 0x03 && sig[3] === 0x04)) {
    return res.status(400).json({ erreur: "Ce fichier n'est pas un classeur Excel (.xlsx) valide." });
  }
  let brut;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const feuille = wb.Sheets[wb.SheetNames[0]];
    if (!feuille) throw new Error('classeur vide');

    // SÉCURITÉ : on lit le classeur en TABLEAUX (header: 1), pas en objets.
    // sheet_to_json en mode objet crée les clés depuis le fichier, ce qui expose
    // à la pollution de prototype (GHSA-4r6h-8v6p-xvw6) si un fichier piégé
    // contient une colonne nommée « __proto__ » ou « constructor ».
    // En construisant nous-mêmes des objets sans prototype, ce vecteur disparaît.
    const grille = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: '', blankrows: false });
    if (grille.length === 0) throw new Error('classeur vide');
    const entetes = (grille[0] || []).map((h) => String(h ?? '').trim());
    brut = grille.slice(1).map((ligne) => {
      const objet = Object.create(null); // pas de prototype : rien à polluer
      entetes.forEach((entete, i) => {
        if (entete && !['__proto__', 'constructor', 'prototype'].includes(entete)) {
          objet[entete] = ligne[i] ?? '';
        }
      });
      return objet;
    });
  } catch { return res.status(400).json({ erreur: 'Fichier illisible : envoyez un classeur Excel (.xlsx) conforme au modèle.' }); }
  if (brut.length > 2000) return res.status(400).json({ erreur: 'Maximum 2000 lignes par import.' });

  const val = (ligne, ...cles) => {
    for (const k of Object.keys(ligne)) {
      if (cles.some((c) => k.trim().toLowerCase() === c.toLowerCase())) return ligne[k];
    }
    return '';
  };

  const client = await pool.connect();
  const rapport = { importes: 0, societesCreees: [], servicesCrees: [], chantiersCrees: [], ignores: [] };
  try {
    await client.query('BEGIN');
    for (let i = 0; i < brut.length; i++) {
      const ligne = brut[i];
      const nom = String(val(ligne, 'Nom') ?? '').trim().slice(0, 100);
      const prenom = String(val(ligne, 'Prénom', 'Prenom') ?? '').trim().slice(0, 100);
      if (!nom && !prenom) continue;
      if (!nom || !prenom) { rapport.ignores.push({ ligne: i + 2, raison: 'Nom ou prénom manquant.' }); continue; }

      const nomSoc = String(val(ligne, 'Société', 'Societe') ?? '').trim() || 'AIFG';
      let soc = (await client.query('SELECT id FROM societes WHERE lower(nom)=lower($1)', [nomSoc])).rows[0];
      if (!soc) {
        soc = (await client.query(`INSERT INTO societes (nom,type) VALUES ($1,'Sous-traitance') RETURNING id`, [nomSoc])).rows[0];
        rapport.societesCreees.push(nomSoc);
      }

      const nomSrv = String(val(ligne, 'Service') ?? '').trim();
      if (!nomSrv) { rapport.ignores.push({ ligne: i + 2, raison: 'Service manquant.' }); continue; }
      let srv = (await client.query('SELECT id FROM services WHERE lower(nom)=lower($1)', [nomSrv])).rows[0];
      if (!srv) {
        srv = (await client.query('INSERT INTO services (nom) VALUES ($1) RETURNING id', [nomSrv])).rows[0];
        rapport.servicesCrees.push(nomSrv);
      }

      const catBrut = String(val(ligne, 'Catégorie', 'Categorie') ?? '').trim().toLowerCase();
      const categorie = catBrut.startsWith('admin') ? 'Administratif' : 'Chantier';

      let chantierId = null;
      if (categorie === 'Chantier') {
        const nomCh = String(val(ligne, 'Chantier') ?? '').trim();
        if (!nomCh) { rapport.ignores.push({ ligne: i + 2, raison: 'Chantier manquant pour un employé de chantier.' }); continue; }
        let ch = (await client.query('SELECT id, service_id FROM chantiers WHERE lower(nom)=lower($1)', [nomCh])).rows[0];
        if (!ch) {
          ch = (await client.query('INSERT INTO chantiers (nom, service_id) VALUES ($1,$2) RETURNING id, service_id', [nomCh, srv.id])).rows[0];
          rapport.chantiersCrees.push(nomCh);
        }
        chantierId = ch.id; srv = { id: ch.service_id };
      }

      const nomRot = String(val(ligne, 'Rotation') ?? '').trim();
      const rot = nomRot ? (await client.query('SELECT id FROM rotations WHERE lower(nom)=lower($1)', [nomRot])).rows[0] : null;

      const contrat = String(val(ligne, 'Contrat', 'Type contrat') ?? '').trim().toUpperCase() === 'CDD' ? 'CDD' : 'CDI';
      const finContrat = contrat === 'CDD' ? dateISO(val(ligne, 'Fin contrat')) : null;
      if (contrat === 'CDD' && !finContrat) { rapport.ignores.push({ ligne: i + 2, raison: 'CDD sans date de fin de contrat valide.' }); continue; }

      const matriculeFichier = String(val(ligne, 'Matricule') ?? '').trim();
      let matricule = matriculeFichier || null;
      if (!matricule) {
        const seq = await client.query("SELECT nextval('seq_matricule') AS n");
        matricule = `AIFG-${String(seq.rows[0].n).padStart(4, '0')}`;
      }
      await client.query(`INSERT INTO employes (${COLS}) VALUES (${PLACEHOLDERS})`, [
        prenom, nom, String(val(ligne, 'Poste') ?? '').trim().slice(0, 200) || '—',
        soc.id, srv.id, chantierId, categorie,
        categorie === 'Chantier' ? (rot?.id ?? null) : null,
        categorie === 'Chantier' ? dateISO(val(ligne, 'Début cycle', 'Debut cycle')) : null,
        String(val(ligne, 'Email', 'E-mail') ?? '').trim().slice(0, 200),
        String(val(ligne, 'Téléphone', 'Telephone') ?? '').trim().slice(0, 50),
        dateISO(val(ligne, 'Date embauche', "Date d'embauche")) || new Date().toISOString().slice(0, 10),
        Number(val(ligne, 'Solde congés', 'Solde conges')) || 0,
        contrat, finContrat, dateISO(val(ligne, 'Prochaine visite médicale', 'Visite médicale', 'Visite medicale')),
        matricule,
        dateISO(val(ligne, 'Date naissance', 'Date de naissance')),
        String(val(ligne, 'Lieu naissance', 'Lieu de naissance') ?? '').trim().slice(0, 120),
        String(val(ligne, 'Sexe') ?? 'M').trim().toUpperCase().startsWith('F') ? 'F' : 'M',
        String(val(ligne, 'N° identité', 'Num identite', 'NIN') ?? '').trim().slice(0, 30),
        String(val(ligne, 'N° CNAS', 'Num CNAS', 'CNAS', 'Securite sociale') ?? '').trim().slice(0, 30),
        (() => {
          const sf = String(val(ligne, 'Situation familiale') ?? '').trim().toLowerCase();
          if (sf.startsWith('mari')) return 'Marié(e)';
          if (sf.startsWith('div')) return 'Divorcé(e)';
          if (sf.startsWith('veu')) return 'Veuf/Veuve';
          return 'Célibataire';
        })(),
        Number(val(ligne, 'Enfants à charge', 'Enfants')) || 0,
        String(val(ligne, 'Adresse') ?? '').trim().slice(0, 300),
        String(val(ligne, 'Wilaya résidence', 'Wilaya') ?? '').trim().slice(0, 60),
        String(val(ligne, 'Contact urgence') ?? '').trim().slice(0, 120),
        String(val(ligne, 'Lien urgence') ?? '').trim().slice(0, 60),
        String(val(ligne, 'Tél. urgence', 'Tel urgence') ?? '').trim().slice(0, 30),
        String(val(ligne, 'Groupe sanguin') ?? '').trim().slice(0, 5),
        Number(val(ligne, 'Salaire de base', 'Salaire')) || 0,
        String(val(ligne, 'Catégorie conventionnelle', 'Categorie conventionnelle') ?? '').trim().slice(0, 60),
        String(val(ligne, 'RIB', 'CCP') ?? '').trim().slice(0, 40),
        String(val(ligne, 'Qualification', 'Niveau qualification') ?? '').trim().slice(0, 60),
        dateISO(val(ligne, 'Fin période essai', 'Fin periode essai')),
        String(val(ligne, 'Observations') ?? '').trim().slice(0, 1000),
      ]);
      rapport.importes += 1;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(400).json({ erreur: 'Import annulé (aucune ligne enregistrée) : ' + String(e.message || e) });
  } finally { client.release(); }

  await journaliser(req, 'import_excel', 'employes', rapport);
  res.json(rapport);
});

export default r;
