import { Router } from 'express';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { q } from '../lib/db.js';
import { exigerAuth, exigerMdpChange, exigerRole, portee } from '../lib/auth.js';
import { journaliser } from '../lib/audit.js';
import { envoyer, notifier } from '../lib/messagerie.js';
import { CODES, CODES_TRAVAILLES, codeTheorique, nbJoursMois, transitionFeuilleAutorisee } from '../lib/metier.js';
import { param, plafondHeuresSuppMensuel, tauxMajorations, joursFeries } from '../lib/parametres.js';

const r = Router();
r.use(exigerAuth, exigerMdpChange);

const EMAIL_RH = process.env.EMAIL_RH || 'rh@aifg.dz';

const peutToucher = (compte, feuille) => {
  if (compte.role === 'rh') return true;
  if (compte.role === 'direction') return false;
  if (compte.serviceId !== feuille.service_id) return false;
  if (compte.role === 'chef_service') return true;
  return compte.chantierId === feuille.chantier_id; // chef_chantier / superviseur
};

async function chargerFeuille(id) {
  const f = (await q('SELECT * FROM feuilles WHERE id=$1', [id])).rows[0];
  if (!f) return null;
  const lignes = (await q('SELECT * FROM lignes_pointage WHERE feuille_id=$1 ORDER BY employe_id', [id])).rows;
  return { ...f, lignes };
}

// ---------- Lecture ----------
r.get('/', async (req, res) => {
  const p = portee(req.compte);
  let sql = 'SELECT * FROM feuilles'; const params = [];
  if (!p.tous) {
    if (p.chantierId) { sql += ' WHERE service_id=$1 AND chantier_id=$2'; params.push(p.serviceId, p.chantierId); }
    else { sql += ' WHERE service_id=$1'; params.push(p.serviceId); }
  }
  sql += ' ORDER BY mois DESC, id DESC';
  const feuilles = (await q(sql, params)).rows;
  const ids = feuilles.map((f) => f.id);
  const lignes = ids.length
    ? (await q('SELECT * FROM lignes_pointage WHERE feuille_id = ANY($1)', [ids])).rows
    : [];
  res.json(feuilles.map((f) => ({ ...f, lignes: lignes.filter((l) => l.feuille_id === f.id) })));
});

// ---------- Création pré-remplie ----------
const schemaCreation = z.object({
  serviceId: z.number().int().positive(),
  chantierId: z.number().int().positive().nullable(),
  mois: z.string().regex(/^\d{4}-\d{2}$/),
});

r.post('/', async (req, res) => {
  const p = schemaCreation.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Périmètre ou mois invalide.' });
  const { serviceId, chantierId, mois } = p.data;
  if (!peutToucher(req.compte, { service_id: serviceId, chantier_id: chantierId }))
    return res.status(403).json({ erreur: 'Vous ne pouvez pas créer de feuille pour ce périmètre.' });

  const employes = chantierId
    ? (await q('SELECT * FROM employes WHERE chantier_id=$1 AND actif ORDER BY nom', [chantierId])).rows
    : (await q(`SELECT * FROM employes WHERE service_id=$1 AND categorie='Administratif' AND actif ORDER BY nom`, [serviceId])).rows;
  if (employes.length === 0) return res.status(400).json({ erreur: 'Aucun employé dans ce périmètre.' });

  const rotations = (await q('SELECT * FROM rotations')).rows;
  const nb = nbJoursMois(mois);
  const [a, m] = mois.split('-');
  const reposHebdo = await param('jours_repos_hebdomadaire', [5, 6]);

  try {
    const ins = await q(
      'INSERT INTO feuilles (service_id, chantier_id, mois, prepare_par) VALUES ($1,$2,$3,$4) RETURNING *',
      [serviceId, chantierId, mois, req.compte.nom]);
    const feuille = ins.rows[0];
    for (const e of employes) {
      const rot = rotations.find((x) => x.id === e.rotation_id) || null;
      const jours = Array.from({ length: nb }, (_, i) =>
        codeTheorique(e, rot, `${a}-${m}-${String(i + 1).padStart(2, '0')}`, reposHebdo));
      await q('INSERT INTO lignes_pointage (feuille_id, employe_id, jours) VALUES ($1,$2,$3)', [feuille.id, e.id, jours]);
    }
    await journaliser(req, 'creation', `feuille:${feuille.id}`, { serviceId, chantierId, mois });
    res.status(201).json(await chargerFeuille(feuille.id));
  } catch (e) {
    if (String(e.message).includes('duplicate') || String(e.message).includes('uq_feuille'))
      return res.status(409).json({ erreur: 'Une feuille existe déjà pour ce périmètre et ce mois.' });
    res.status(400).json({ erreur: 'Création impossible.' });
  }
});

// ---------- Édition des codes et heures supp ----------
// Les codes valides sont lus en base (table codes_pointage) : ajouter un code
// ne demande aucune modification du code source.
const schemaLignes = z.object({
  lignes: z.array(z.object({
    employeId: z.number().int().positive(),
    jours: z.array(z.string().min(1).max(5)).min(28).max(31),
    heuresSupp: z.number().min(0).max(400),
  })).min(1).max(500),
});

r.put('/:id/lignes', async (req, res) => {
  const feuille = (await q('SELECT * FROM feuilles WHERE id=$1', [req.params.id])).rows[0];
  if (!feuille) return res.status(404).json({ erreur: 'Feuille introuvable.' });
  const editableParChefChantier = feuille.statut === 'En préparation';
  const editableParChefService = ['En préparation', 'Chez le chef de service'].includes(feuille.statut);
  const ok =
    (req.compte.role === 'rh' && feuille.statut !== 'Archivée') ||
    (req.compte.role === 'chef_service' && peutToucher(req.compte, feuille) && editableParChefService) ||
    (['chef_chantier', 'superviseur'].includes(req.compte.role) && peutToucher(req.compte, feuille) && editableParChefChantier);
  if (!ok) return res.status(403).json({ erreur: `Cette feuille (${feuille.statut}) n'est pas modifiable par votre rôle.` });

  const p = schemaLignes.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Lignes de pointage invalides.' });

  const codesValides = new Set((await q('SELECT code FROM codes_pointage WHERE actif')).rows.map((r) => r.code));
  const inconnus = [...new Set(p.data.lignes.flatMap((l) => l.jours))].filter((c) => !codesValides.has(c));
  if (inconnus.length > 0) {
    return res.status(400).json({ erreur: `Code(s) de pointage inconnu(s) : ${inconnus.join(', ')}. Codes autorisés : ${[...codesValides].join(', ')}.` });
  }

  // Verrou optimiste : si quelqu'un d'autre a modifié la feuille entre-temps, on refuse
  // plutôt que d'écraser silencieusement son travail.
  if (typeof req.body?.version === 'number' && req.body.version !== feuille.version) {
    return res.status(409).json({
      erreur: "Cette feuille a été modifiée par quelqu'un d'autre entre-temps. Rechargez la page pour voir la version à jour avant d'enregistrer.",
      version: feuille.version,
    });
  }
  const nb = nbJoursMois(feuille.mois);
  const plafondHS = await plafondHeuresSuppMensuel();
  const depassements = p.data.lignes.filter((l) => l.heuresSupp > plafondHS);
  if (depassements.length > 0 && req.body?.forcerDepassementHS !== true) {
    return res.status(422).json({
      erreur: `Plafond légal d'heures supplémentaires dépassé (${plafondHS} h/mois, art. 31 loi 90-11) pour ${depassements.length} employé(s). Les cas dérogatoires (accident imminent, travaux à achever) doivent être justifiés et l'inspection du travail informée.`,
      plafond: plafondHS,
      employesConcernes: depassements.map((l) => l.employeId),
      confirmationRequise: true,
    });
  }
  for (const l of p.data.lignes) {
    if (l.jours.length !== nb) return res.status(400).json({ erreur: `Chaque ligne doit contenir ${nb} jours pour ${feuille.mois}.` });
    const maj = await q(
      'UPDATE lignes_pointage SET jours=$1, heures_supp=$2 WHERE feuille_id=$3 AND employe_id=$4',
      [l.jours, l.heuresSupp, feuille.id, l.employeId]);
    if (maj.rowCount === 0) return res.status(400).json({ erreur: `L'employé ${l.employeId} n'appartient pas à cette feuille.` });
  }
  await q('UPDATE feuilles SET version = version + 1, modifie_le = now() WHERE id=$1', [feuille.id]);
  await journaliser(req, 'modification_lignes', `feuille:${feuille.id}`, { version: feuille.version + 1 });
  res.json(await chargerFeuille(feuille.id));
});

// ---------- Transitions du circuit ----------
r.post('/:id/statut', async (req, res) => {
  const cible = z.enum(['En préparation', 'Chez le chef de service', 'Chez RH', 'Archivée']).safeParse(req.body?.statut);
  if (!cible.success) return res.status(400).json({ erreur: 'Statut cible invalide.' });
  const feuille = (await q('SELECT * FROM feuilles WHERE id=$1', [req.params.id])).rows[0];
  if (!feuille) return res.status(404).json({ erreur: 'Feuille introuvable.' });
  if (!peutToucher(req.compte, feuille) && req.compte.role !== 'rh')
    return res.status(403).json({ erreur: 'Cette feuille ne relève pas de votre périmètre.' });
  if (!transitionFeuilleAutorisee(feuille.statut, cible.data, req.compte.role))
    return res.status(403).json({ erreur: `Transition « ${feuille.statut} → ${cible.data} » non autorisée pour votre rôle.` });

  const maj = { 'Chez RH': ', valide_service_le = CURRENT_DATE', 'Archivée': ', valide_rh_le = CURRENT_DATE' }[cible.data] || '';
  await q(`UPDATE feuilles SET statut=$1, version=version+1, modifie_le=now() ${maj} WHERE id=$2`, [cible.data, feuille.id]);
  await journaliser(req, 'transition', `feuille:${feuille.id}`, { de: feuille.statut, vers: cible.data });

  // Notifications + messages automatiques
  const srv = (await q('SELECT nom FROM services WHERE id=$1', [feuille.service_id])).rows[0]?.nom ?? '?';
  const ch = feuille.chantier_id
    ? (await q('SELECT nom FROM chantiers WHERE id=$1', [feuille.chantier_id])).rows[0]?.nom ?? '?'
    : 'Personnel administratif';
  const libelle = `${srv} / ${ch} — ${feuille.mois}`;

  if (cible.data === 'Chez le chef de service') {
    await notifier(`service:${feuille.service_id}`, `Feuille de pointage « ${libelle} » soumise par le chantier — à valider.`);
    const chef = (await q(`SELECT nom,email FROM comptes WHERE role='chef_service' AND service_id=$1 AND actif`, [feuille.service_id])).rows[0];
    if (chef) await envoyer('email', chef.nom, chef.email,
      `[Pointage à valider] ${libelle}`,
      `Bonjour ${chef.nom},\n\nLa feuille de pointage « ${libelle} » vient d'être soumise par ${req.compte.nom}.\nMerci de la vérifier puis de la transmettre au service RH depuis l'application.`);
  }
  if (cible.data === 'Chez RH') {
    await notifier('rh', `Feuille de pointage « ${libelle} » transmise par le chef de service.`);
    await envoyer('email', 'Service RH — AIFG', EMAIL_RH,
      `[Pointage transmis] ${libelle}`,
      `La feuille de pointage « ${libelle} » a été validée par ${req.compte.nom} et transmise au service RH.\nMerci de la vérifier, la valider, l'imprimer et l'archiver.`);
  }
  if (cible.data === 'Archivée') {
    await notifier(`service:${feuille.service_id}`, `Feuille de pointage « ${libelle} » vérifiée, validée et archivée par le RH.`);
    await notifier('direction', `Pointage archivé : ${libelle}.`);
  }
  if (cible.data === 'En préparation') {
    await notifier(`service:${feuille.service_id}`, `Feuille de pointage « ${libelle} » renvoyée pour correction.`);
  }

  res.json(await chargerFeuille(feuille.id));
});

// ---------- Export paie ----------
r.get('/:id/paie.xlsx', exigerRole('rh'), async (req, res) => {
  const feuille = await chargerFeuille(req.params.id);
  if (!feuille) return res.status(404).json({ erreur: 'Feuille introuvable.' });
  if (!['Chez RH', 'Archivée'].includes(feuille.statut))
    return res.status(400).json({ erreur: 'La feuille doit être transmise au RH ou archivée avant export.' });

  const emp = (await q('SELECT e.*, s.nom AS societe FROM employes e JOIN societes s ON s.id=e.societe_id')).rows;
  const codesRef = (await q('SELECT * FROM codes_pointage WHERE actif ORDER BY ordre')).rows;
  const codesTravailles = codesRef.filter((c) => c.compte_travaille).map((c) => c.code);
  const srv = (await q('SELECT nom FROM services WHERE id=$1', [feuille.service_id])).rows[0]?.nom ?? '';
  const ch = feuille.chantier_id ? (await q('SELECT nom FROM chantiers WHERE id=$1', [feuille.chantier_id])).rows[0]?.nom ?? '' : 'Personnel administratif';
  const proteger = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
  const taux = await tauxMajorations();
  const feriesMois = (await joursFeries(feuille.mois.slice(0, 4), feuille.mois.slice(0, 4)))
    .filter((f) => f.date.startsWith(feuille.mois)).map((f) => Number(f.date.slice(8, 10)));
  const reposHebdo = await param('jours_repos_hebdomadaire', [5, 6]);
  const [anP, moP] = feuille.mois.split('-').map(Number);

  const lignes = feuille.lignes.map((l) => {
    const e = emp.find((x) => x.id === l.employe_id) || {};
    const compte = Object.fromEntries(codesRef.map((c) => [c.code, l.jours.filter((j) => j === c.code).length]));
    const base = {
      'Matricule': l.employe_id, 'Nom': e.nom ?? '?', 'Prénom': e.prenom ?? '', 'Poste': e.poste ?? '',
      'Société': e.societe ?? '', 'Service': srv, 'Chantier': ch,
      ...Object.fromEntries(codesRef.map((c) => [`${c.code} (${c.libelle})`, compte[c.code] ?? 0])),
      'Jours travaillés': l.jours.filter((j) => codesTravailles.includes(j)).length,
      'Jours fériés travaillés': l.jours.filter((j, i) => codesTravailles.includes(j) && feriesMois.includes(i + 1)).length,
      'Jours repos hebdo. travaillés': l.jours.filter((j, i) =>
        codesTravailles.includes(j) && reposHebdo.includes(new Date(Date.UTC(anP, moP - 1, i + 1)).getUTCDay())).length,
      'Heures supplémentaires': Number(l.heures_supp),
      [`Majoration HS (%)`]: taux.normale,
      [`Majoration jour de repos (%)`]: taux.repos,
      [`Majoration jour férié (%)`]: taux.ferie,
    };
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, proteger(v)]));
  });
  const ws = XLSX.utils.json_to_sheet(lignes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Paie');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  await journaliser(req, 'export_paie', `feuille:${feuille.id}`);
  res.setHeader('Content-Disposition', `attachment; filename="paie_${feuille.mois}.xlsx"`);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
});

export default r;
