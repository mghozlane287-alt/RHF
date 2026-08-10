import { Router } from 'express';
import { z } from 'zod';
import { q } from '../lib/db.js';
import { exigerAuth, exigerMdpChange, exigerRole, portee } from '../lib/auth.js';
import { journaliser } from '../lib/audit.js';
import {
  chargerParametres, viderCacheParametres, calculerDroitsConge, periodeReference,
  plafondHeuresSuppMensuel, tauxMajorations, param,
} from '../lib/parametres.js';

const r = Router();
r.use(exigerAuth, exigerMdpChange);

// ---------- Paramètres légaux ----------
r.get('/parametres', async (_req, res) => {
  const { rows } = await q('SELECT * FROM parametres ORDER BY cle');
  res.json(rows);
});

r.put('/parametres/:cle', exigerRole('rh'), async (req, res) => {
  const cle = String(req.params.cle).slice(0, 100);
  if (req.body?.valeur === undefined) return res.status(400).json({ erreur: 'Valeur manquante.' });
  const existant = (await q('SELECT * FROM parametres WHERE cle=$1', [cle])).rows[0];
  if (!existant) return res.status(404).json({ erreur: 'Paramètre inconnu.' });

  const { rows } = await q(
    'UPDATE parametres SET valeur=$1, modifie_le=now(), modifie_par=$2 WHERE cle=$3 RETURNING *',
    [JSON.stringify(req.body.valeur), req.compte.email, cle]);
  viderCacheParametres();
  // Traçabilité : un changement de règle légale doit être auditable.
  await journaliser(req, 'modification_parametre_legal', `parametre:${cle}`,
    { avant: existant.valeur, apres: req.body.valeur });
  res.json(rows[0]);
});

// ---------- Jours fériés ----------
r.get('/jours-feries', async (req, res) => {
  const annee = Number(req.query.annee) || new Date().getFullYear();
  const { rows } = await q(
    `SELECT id, to_char(date,'YYYY-MM-DD') AS date, libelle, type, chome_paye
     FROM jours_feries WHERE extract(year from date) = $1 ORDER BY date`, [annee]);
  res.json(rows);
});

const schemaFerie = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  libelle: z.string().trim().min(1).max(200),
  type: z.enum(['Civil', 'Religieux']).default('Religieux'),
  chomePaye: z.boolean().default(true),
});

r.post('/jours-feries', exigerRole('rh'), async (req, res) => {
  const p = schemaFerie.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Jour férié invalide.' });
  try {
    const { rows } = await q(
      `INSERT INTO jours_feries (date, libelle, type, chome_paye) VALUES ($1,$2,$3,$4)
       RETURNING id, to_char(date,'YYYY-MM-DD') AS date, libelle, type, chome_paye`,
      [p.data.date, p.data.libelle, p.data.type, p.data.chomePaye]);
    await journaliser(req, 'creation', `jour_ferie:${p.data.date}`, { libelle: p.data.libelle });
    res.status(201).json(rows[0]);
  } catch { res.status(409).json({ erreur: 'Un jour férié existe déjà à cette date.' }); }
});

r.delete('/jours-feries/:id', exigerRole('rh'), async (req, res) => {
  await q('DELETE FROM jours_feries WHERE id=$1', [req.params.id]);
  await journaliser(req, 'suppression', `jour_ferie:${req.params.id}`);
  res.json({ ok: true });
});

// ---------- Codes de pointage ----------
r.get('/codes-pointage', async (_req, res) => {
  const { rows } = await q('SELECT * FROM codes_pointage WHERE actif ORDER BY ordre');
  res.json(rows);
});

const schemaCode = z.object({
  code: z.string().trim().min(1).max(5),
  libelle: z.string().trim().min(1).max(100),
  compteTravaille: z.boolean(),
  couleur: z.string().max(100).default('bg-muted text-muted-foreground'),
  couleurImpression: z.string().max(20).default('#ececec'),
});

r.post('/codes-pointage', exigerRole('rh'), async (req, res) => {
  const p = schemaCode.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Code de pointage invalide.' });
  try {
    const { rows } = await q(
      `INSERT INTO codes_pointage (code, libelle, compte_travaille, couleur, couleur_impression)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [p.data.code.toUpperCase(), p.data.libelle, p.data.compteTravaille, p.data.couleur, p.data.couleurImpression]);
    await journaliser(req, 'creation', `code_pointage:${p.data.code}`);
    res.status(201).json(rows[0]);
  } catch { res.status(409).json({ erreur: 'Ce code existe déjà.' }); }
});

// ---------- Types de congé ----------
r.get('/types-conge', async (_req, res) => {
  const { rows } = await q('SELECT * FROM types_conge WHERE actif ORDER BY ordre, libelle');
  res.json(rows);
});

const schemaType = z.object({
  libelle: z.string().trim().min(1).max(100),
  codePointage: z.string().trim().min(1).max(5),
  joursLegaux: z.number().int().min(0).max(400).nullable().optional(),
  decompteSolde: z.boolean(),
  remunere: z.boolean(),
  justificatifRequis: z.boolean(),
  referenceLegale: z.string().max(200).default(''),
});

r.post('/types-conge', exigerRole('rh'), async (req, res) => {
  const p = schemaType.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Type de congé invalide.' });
  try {
    const { rows } = await q(
      `INSERT INTO types_conge (libelle, code_pointage, jours_legaux, decompte_solde, remunere, justificatif_requis, reference_legale)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [p.data.libelle, p.data.codePointage, p.data.joursLegaux ?? null, p.data.decompteSolde,
       p.data.remunere, p.data.justificatifRequis, p.data.referenceLegale]);
    res.status(201).json(rows[0]);
  } catch { res.status(409).json({ erreur: 'Ce type de congé existe déjà.' }); }
});

r.put('/types-conge/:id', exigerRole('rh'), async (req, res) => {
  const p = schemaType.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Type de congé invalide.' });
  const { rows } = await q(
    `UPDATE types_conge SET libelle=$1, code_pointage=$2, jours_legaux=$3, decompte_solde=$4,
            remunere=$5, justificatif_requis=$6, reference_legale=$7 WHERE id=$8 RETURNING *`,
    [p.data.libelle, p.data.codePointage, p.data.joursLegaux ?? null, p.data.decompteSolde,
     p.data.remunere, p.data.justificatifRequis, p.data.referenceLegale, req.params.id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Type introuvable.' });
  res.json(rows[0]);
});

r.delete('/types-conge/:id', exigerRole('rh'), async (req, res) => {
  await q('UPDATE types_conge SET actif=FALSE WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- Droits à congé (art. 40 à 46) ----------
r.get('/droits-conge', async (req, res) => {
  const p = portee(req.compte);
  const conditions = [];
  const params = [];
  if (!p.tous) {
    if (p.chantierId) { params.push(p.chantierId); conditions.push(`e.chantier_id=$${params.length}`); }
    else { params.push(p.serviceId); conditions.push(`e.service_id=$${params.length}`); }
  }
  const ou = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

  const { rows } = await q(
    `SELECT e.*, COALESCE(NULLIF(ch.wilaya,''), sv.wilaya, '') AS wilaya_travail,
            ch.nom AS chantier, sv.nom AS service
     FROM employes e
     LEFT JOIN chantiers ch ON ch.id = e.chantier_id
     LEFT JOIN services sv ON sv.id = e.service_id
     ${ou ? ou + ' AND e.actif' : ' WHERE e.actif'}
     ORDER BY e.nom`, params);

  const periode = await periodeReference();
  const droits = [];
  for (const e of rows) {
    const d = await calculerDroitsConge(e, e.wilaya_travail, periode);
    droits.push({
      employeId: e.id, nom: e.nom, prenom: e.prenom, poste: e.poste,
      service: e.service, chantier: e.chantier, wilaya: d.wilaya, estSud: d.estSud,
      moisTravailles: d.moisTravailles, joursPrincipal: d.joursPrincipal,
      joursSud: d.joursSud, joursAnciennete: d.joursAnciennete,
      droitsTotal: d.total, soldeActuel: Number(e.solde_conges),
      ecart: Math.round((d.total - Number(e.solde_conges)) * 2) / 2,
    });
  }
  res.json({ periode, droits });
});

/** Applique les droits calculés au solde des employés (opération RH, tracée). */
r.post('/droits-conge/appliquer', exigerRole('rh'), async (req, res) => {
  const periode = await periodeReference();
  const { rows } = await q(
    `SELECT e.*, COALESCE(NULLIF(ch.wilaya,''), sv.wilaya, '') AS wilaya_travail
     FROM employes e
     LEFT JOIN chantiers ch ON ch.id = e.chantier_id
     LEFT JOIN services sv ON sv.id = e.service_id
     WHERE e.actif`);

  let appliques = 0;
  for (const e of rows) {
    const d = await calculerDroitsConge(e, e.wilaya_travail, periode);
    await q(
      `INSERT INTO acquisitions_conge (employe_id, periode_debut, periode_fin, mois_travailles, jours_principal, jours_sud, jours_anciennete, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (employe_id, periode_debut) DO UPDATE
         SET mois_travailles=$4, jours_principal=$5, jours_sud=$6, jours_anciennete=$7, total=$8, calcule_le=now()`,
      [e.id, periode.debut, periode.fin, d.moisTravailles, d.joursPrincipal, d.joursSud, d.joursAnciennete, d.total]);
    await q('UPDATE employes SET solde_conges=$1, dernier_calcul_droits=CURRENT_DATE WHERE id=$2', [d.total, e.id]);
    appliques += 1;
  }
  await journaliser(req, 'application_droits_conge', 'employes', { periode, appliques });
  res.json({ ok: true, appliques, periode });
});

// ---------- Contrôles légaux (tableau de conformité) ----------
r.get('/conformite', exigerRole('rh', 'direction'), async (_req, res) => {
  const p = await chargerParametres();
  const plafondHS = await plafondHeuresSuppMensuel();
  const taux = await tauxMajorations();
  const anneeCourante = new Date().getFullYear();

  const [feries, sansWilaya, hsDepassement, essaiDepasse, contratsExpires] = await Promise.all([
    q('SELECT count(*)::int AS n FROM jours_feries WHERE extract(year from date)=$1', [anneeCourante]),
    q(`SELECT count(*)::int AS n FROM employes e
       LEFT JOIN chantiers ch ON ch.id=e.chantier_id
       LEFT JOIN services sv ON sv.id=e.service_id
       WHERE e.actif AND COALESCE(NULLIF(ch.wilaya,''), sv.wilaya, '') = ''`),
    q(`SELECT count(*)::int AS n FROM lignes_pointage WHERE heures_supp > $1`, [plafondHS]),
    q(`SELECT count(*)::int AS n FROM employes
       WHERE actif AND fin_periode_essai IS NOT NULL AND fin_periode_essai < CURRENT_DATE`),
    q(`SELECT count(*)::int AS n FROM employes
       WHERE actif AND type_contrat='CDD' AND fin_contrat IS NOT NULL AND fin_contrat < CURRENT_DATE`),
  ]);

  res.json({
    parametres: {
      repos: p.jours_repos_hebdomadaire, dureeHebdo: p.duree_legale_hebdomadaire,
      congeParMois: p.conge_jours_par_mois, plafondConge: p.conge_plafond_annuel,
      congeSud: p.conge_sud_jours, plafondHeuresSuppMensuel: plafondHS, majorations: taux,
    },
    controles: [
      { cle: 'feries_annee', libelle: `Jours fériés saisis pour ${anneeCourante}`, valeur: feries.rows[0].n,
        conforme: feries.rows[0].n >= 5,
        message: feries.rows[0].n >= 5 ? '' : 'Ajoutez les fêtes religieuses de l\'année (dates variables).' },
      { cle: 'wilaya_manquante', libelle: 'Employés sans wilaya de travail renseignée', valeur: sansWilaya.rows[0].n,
        conforme: sansWilaya.rows[0].n === 0,
        message: sansWilaya.rows[0].n === 0 ? '' : 'Sans wilaya, le congé supplémentaire du Sud (art. 42) ne peut pas être calculé.' },
      { cle: 'hs_plafond', libelle: `Lignes dépassant le plafond légal d'heures supp. (${plafondHS} h/mois)`, valeur: hsDepassement.rows[0].n,
        conforme: hsDepassement.rows[0].n === 0,
        message: hsDepassement.rows[0].n === 0 ? '' : 'Art. 31 : les heures supplémentaires ne peuvent excéder 20 % de la durée légale, sauf cas dérogatoires.' },
      { cle: 'periode_essai', libelle: 'Périodes d\'essai échues à confirmer', valeur: essaiDepasse.rows[0].n,
        conforme: essaiDepasse.rows[0].n === 0, message: essaiDepasse.rows[0].n === 0 ? '' : 'Confirmez ou rompez ces périodes d\'essai.' },
      { cle: 'cdd_expires', libelle: 'CDD expirés non renouvelés', valeur: contratsExpires.rows[0].n,
        conforme: contratsExpires.rows[0].n === 0,
        message: contratsExpires.rows[0].n === 0 ? '' : 'Un CDD poursuivi au-delà du terme peut être requalifié en CDI (art. 14).' },
    ],
  });
});

export default r;
