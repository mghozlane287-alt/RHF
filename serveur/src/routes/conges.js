import { Router } from 'express';
import { z } from 'zod';
import { q } from '../lib/db.js';
import { exigerAuth, exigerMdpChange, portee } from '../lib/auth.js';
import { journaliser } from '../lib/audit.js';
import { envoyer, notifier } from '../lib/messagerie.js';
import { joursOuvresLegaux, param } from '../lib/parametres.js';

const r = Router();
r.use(exigerAuth, exigerMdpChange);
const EMAIL_RH = process.env.EMAIL_RH || 'rh@aifg.dz';
const fr = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

r.get('/', async (req, res) => {
  const p = portee(req.compte);
  let sql = `SELECT c.* FROM conges c JOIN employes e ON e.id=c.employe_id`;
  const params = [];
  if (!p.tous) { sql += ' WHERE e.service_id=$1'; params.push(p.serviceId); }
  sql += ' ORDER BY c.id DESC';
  res.json((await q(sql, params)).rows);
});

const schemaConge = z.object({
  employeId: z.number().int().positive(),
  type: z.string().trim().min(1).max(100), // validé contre la table types_conge (paramétrable)
  debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  motif: z.string().max(1000).default(''),
  justificatifReference: z.string().trim().max(100).default(''),
  adressePendantConge: z.string().trim().max(300).default(''),
  remplacantId: z.number().int().positive().nullable().optional(),
});

r.post('/', async (req, res) => {
  if (req.compte.role === 'direction') return res.status(403).json({ erreur: 'La Direction consulte, elle ne dépose pas de demandes.' });
  const p = schemaConge.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Demande invalide.' });
  const typeConnu = (await q('SELECT 1 FROM types_conge WHERE libelle=$1 AND actif', [p.data.type])).rows[0];
  if (!typeConnu) return res.status(400).json({ erreur: 'Type de congé inconnu ou désactivé.' });
  const e = (await q('SELECT * FROM employes WHERE id=$1', [p.data.employeId])).rows[0];
  if (!e) return res.status(404).json({ erreur: 'Employé introuvable.' });
  if (!e.actif) {
    return res.status(400).json({
      erreur: `${e.prenom} ${e.nom} est sorti de l'effectif${e.date_sortie ? ' le ' + String(e.date_sortie).slice(0, 10) : ''}. Réintégrez-le avant d'enregistrer une demande de congé.`,
    });
  }
  const sc = portee(req.compte);
  if (!sc.tous && e.service_id !== sc.serviceId) return res.status(403).json({ erreur: 'Cet employé ne relève pas de votre service.' });
  if (!e.actif) return res.status(400).json({ erreur: "Cet employé est sorti de l'effectif : aucune demande de congé n'est possible." });


  // Jours ouvrés selon le cadre légal paramétré : repos hebdomadaire + jours fériés exclus.
  const jours = await joursOuvresLegaux(p.data.debut, p.data.fin);
  if (jours === 0) return res.status(400).json({ erreur: 'La période ne contient aucun jour ouvré (repos hebdomadaire et jours fériés exclus).' });

  // Contrôle de la durée légale du type de congé (ex. congé exceptionnel = 3 jours, art. 54).
  const regle = (await q('SELECT * FROM types_conge WHERE libelle=$1 AND actif', [p.data.type])).rows[0];
  if (regle?.jours_legaux && jours > regle.jours_legaux) {
    return res.status(400).json({
      erreur: `${p.data.type} : la durée légale est de ${regle.jours_legaux} jour(s) (${regle.reference_legale || 'loi 90-11'}). Vous demandez ${jours} jours.`,
    });
  }

  // Chevauchement : deux congés simultanés pour le même employé fausseraient la paie.
  const conflit = await q(
    `SELECT id, type, debut, fin FROM conges
     WHERE employe_id=$1 AND statut <> 'Refusé'
       AND debut <= $3::date AND fin >= $2::date LIMIT 1`,
    [e.id, p.data.debut, p.data.fin]);
  if (conflit.rows[0]) {
    const c = conflit.rows[0];
    return res.status(409).json({
      erreur: `Cet employé a déjà une demande de ${c.type} du ${String(c.debut).slice(0, 10)} au ${String(c.fin).slice(0, 10)} qui chevauche cette période.`,
    });
  }

  if (regle?.justificatif_requis && !p.data.justificatifReference.trim()) {
    return res.status(400).json({
      erreur: `${p.data.type} : un justificatif est requis (certificat médical, acte, convocation…). Indiquez sa référence.`,
    });
  }

  if (regle?.decompte_solde && Number(e.solde_conges) < jours) {
    return res.status(400).json({
      erreur: `Solde insuffisant : ${Number(e.solde_conges)} jour(s) disponible(s) pour ${jours} jour(s) demandé(s). Utilisez un congé sans solde si nécessaire.`,
    });
  }

  const { rows } = await q(
    `INSERT INTO conges (employe_id,type,debut,fin,jours,motif,justificatif_reference,adresse_pendant_conge,remplacant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [e.id, p.data.type, p.data.debut, p.data.fin, jours, p.data.motif.trim(),
     p.data.justificatifReference, p.data.adressePendantConge, p.data.remplacantId ?? null]);
  await journaliser(req, 'creation', `conge:${rows[0].id}`, { employe: e.id });

  await notifier(`service:${e.service_id}`, `Nouvelle demande de congé de ${e.prenom} ${e.nom} (${p.data.type}) à valider.`);
  await envoyer('whatsapp', `${e.prenom} ${e.nom}`, e.telephone,
    'Demande de congé enregistrée',
    `Bonjour ${e.prenom}, votre demande de ${p.data.type} du ${fr(p.data.debut)} au ${fr(p.data.fin)} (${jours} j) a bien été enregistrée. Elle est en attente de validation de votre chef de service.`);
  const chef = (await q(`SELECT nom,email FROM comptes WHERE role='chef_service' AND service_id=$1 AND actif`, [e.service_id])).rows[0];
  if (chef) await envoyer('email', chef.nom, chef.email,
    `[Congé à valider] ${e.prenom} ${e.nom}`,
    `Bonjour ${chef.nom},\n\n${e.prenom} ${e.nom} (${e.poste}) a déposé une demande de ${p.data.type} du ${fr(p.data.debut)} au ${fr(p.data.fin)} (${jours} jours ouvrés).\nMerci de la traiter dans l'application.`);
  res.status(201).json(rows[0]);
});

const TRANSITIONS = {
  'En attente (chef de service)': { valider: 'En attente (RH)', refuser: 'Refusé', roles: ['chef_service'] },
  'En attente (RH)': { valider: 'Approuvé', refuser: 'Refusé', roles: ['rh'] },
};

r.post('/:id/decision', async (req, res) => {
  const decision = z.enum(['valider', 'refuser']).safeParse(req.body?.decision);
  const observation = String(req.body?.observation ?? '').trim().slice(0, 500);
  if (!decision.success) return res.status(400).json({ erreur: 'Décision invalide (valider/refuser).' });
  const c = (await q('SELECT * FROM conges WHERE id=$1', [req.params.id])).rows[0];
  if (!c) return res.status(404).json({ erreur: 'Demande introuvable.' });
  const e = (await q('SELECT * FROM employes WHERE id=$1', [c.employe_id])).rows[0];
  const regle = TRANSITIONS[c.statut];
  if (!regle) return res.status(400).json({ erreur: 'Cette demande est déjà décidée.' });
  if (!regle.roles.includes(req.compte.role)) return res.status(403).json({ erreur: 'Décision non autorisée pour votre rôle à cette étape.' });
  if (req.compte.role === 'chef_service' && e.service_id !== req.compte.serviceId)
    return res.status(403).json({ erreur: 'Cet employé ne relève pas de votre service.' });

  const nouveau = decision.data === 'valider' ? regle.valider : regle.refuser;
  await q(
    `UPDATE conges SET statut=$1, observation_decision=CASE WHEN $2 <> '' THEN $2 ELSE observation_decision END,
            decide_par=$3, decide_le=now() WHERE id=$4`,
    [nouveau, observation, req.compte.nom, c.id]);
  await journaliser(req, 'decision', `conge:${c.id}`, { de: c.statut, vers: nouveau });

  if (nouveau === 'En attente (RH)') {
    await notifier('rh', `Demande de congé de ${e.prenom} ${e.nom} validée par le chef de service — validation RH attendue.`);
    await envoyer('email', 'Service RH — AIFG', EMAIL_RH,
      `[Congé — validation RH] ${e.prenom} ${e.nom}`,
      `La demande de ${c.type} de ${e.prenom} ${e.nom} (du ${fr(c.debut)} au ${fr(c.fin)}, ${c.jours} j) a été validée par le chef de service et attend la validation finale du RH.`);
    await envoyer('whatsapp', `${e.prenom} ${e.nom}`, e.telephone,
      'Demande transmise au RH',
      `Bonjour ${e.prenom}, votre demande de ${c.type} a été validée par votre chef de service et transmise au service RH pour décision finale.`);
  }
  if (nouveau === 'Approuvé') {
    // Le décompte du solde dépend du paramétrage du type (table types_conge), pas d'une liste figée.
    const regle = (await q('SELECT decompte_solde FROM types_conge WHERE libelle=$1', [c.type])).rows[0];
    if (regle?.decompte_solde) {
      await q('UPDATE employes SET solde_conges = GREATEST(0, solde_conges - $1) WHERE id=$2', [c.jours, e.id]);
    }
    await notifier(`service:${e.service_id}`, `Congé de ${e.prenom} ${e.nom} approuvé par le RH.`);
    await envoyer('whatsapp', `${e.prenom} ${e.nom}`, e.telephone,
      'Congé approuvé ✅',
      `Bonjour ${e.prenom}, votre demande de ${c.type} du ${fr(c.debut)} au ${fr(c.fin)} a été APPROUVÉE par le service RH. Le titre de congé est disponible auprès du service RH.`);
  }
  if (nouveau === 'Refusé') {
    await notifier(req.compte.role === 'rh' ? `service:${e.service_id}` : 'rh',
      `Congé de ${e.prenom} ${e.nom} refusé par ${req.compte.role === 'rh' ? 'le RH' : 'le chef de service'}.`);
    await envoyer('whatsapp', `${e.prenom} ${e.nom}`, e.telephone,
      'Congé refusé',
      `Bonjour ${e.prenom}, votre demande de ${c.type} du ${fr(c.debut)} au ${fr(c.fin)} a été refusée. Rapprochez-vous de votre hiérarchie pour plus de détails.`);
  }
  res.json((await q('SELECT * FROM conges WHERE id=$1', [c.id])).rows[0]);
});

export default r;
