import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q } from '../lib/db.js';
import { exigerAuth, exigerRole, exigerMdpChange } from '../lib/auth.js';
import { journaliser } from '../lib/audit.js';
import { envoyer } from '../lib/messagerie.js';

const r = Router();
r.use(exigerAuth, exigerMdpChange);

// ---------- Lecture du référentiel (tous rôles) ----------
r.get('/referentiel', async (_req, res) => {
  const [soc, srv, ch, rot] = await Promise.all([
    q('SELECT * FROM societes ORDER BY type, nom'),
    q('SELECT * FROM services ORDER BY nom'),
    q('SELECT * FROM chantiers ORDER BY nom'),
    q('SELECT * FROM rotations ORDER BY id'),
  ]);
  res.json({ societes: soc.rows, services: srv.rows, chantiers: ch.rows, rotations: rot.rows });
});

// ---------- Sociétés (RH) ----------
const txt = (max) => z.string().trim().max(max).default('');
const dateOpt = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const schemaSociete = z.object({
  nom: z.string().trim().min(1).max(200),
  formeJuridique: txt(50),          // SARL, EURL, SPA, ETS…
  contact: txt(200), telephone: txt(50), email: txt(200),
  adresse: txt(300), wilaya: txt(60),
  nif: txt(30),                     // numéro d'identification fiscale
  nis: txt(30),                     // numéro d'identification statistique
  registreCommerce: txt(40),        // n° RC
  articleImposition: txt(40),
  numCnasEmployeur: txt(30),
  objetPrestation: txt(300),
  contratReference: txt(60),
  contratDebut: dateOpt, contratFin: dateOpt,
});

const COLS_SOC = `nom,forme_juridique,contact,telephone,email,adresse,wilaya,nif,nis,
  registre_commerce,article_imposition,num_cnas_employeur,objet_prestation,contrat_reference,contrat_debut,contrat_fin`;
const valsSoc = (d) => [d.nom, d.formeJuridique, d.contact, d.telephone, d.email, d.adresse, d.wilaya,
  d.nif, d.nis, d.registreCommerce, d.articleImposition, d.numCnasEmployeur, d.objetPrestation,
  d.contratReference, d.contratDebut ?? null, d.contratFin ?? null];

r.post('/societes', exigerRole('rh'), async (req, res) => {
  const p = schemaSociete.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Données de société invalides.' });
  try {
    const { rows } = await q(
      `INSERT INTO societes (${COLS_SOC},type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'Sous-traitance') RETURNING *`,
      valsSoc(p.data));
    await journaliser(req, 'creation', `societe:${rows[0].id}`, { nom: p.data.nom });
    res.status(201).json(rows[0]);
  } catch { res.status(409).json({ erreur: 'Une société porte déjà ce nom.' }); }
});

r.put('/societes/:id', exigerRole('rh'), async (req, res) => {
  const p = schemaSociete.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Données de société invalides.' });
  const affect = COLS_SOC.split(',').map((c, i) => `${c.trim()}=$${i + 1}`).join(',');
  const { rows } = await q(`UPDATE societes SET ${affect} WHERE id=$17 RETURNING *`,
    [...valsSoc(p.data), req.params.id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Société introuvable.' });
  await journaliser(req, 'modification', `societe:${rows[0].id}`);
  res.json(rows[0]);
});

r.delete('/societes/:id', exigerRole('rh'), async (req, res) => {
  const s = await q('SELECT type FROM societes WHERE id=$1', [req.params.id]);
  if (!s.rows[0]) return res.status(404).json({ erreur: 'Société introuvable.' });
  if (s.rows[0].type === 'Principale') return res.status(400).json({ erreur: 'La société principale ne peut pas être supprimée.' });
  const n = await q('SELECT count(*)::int AS n FROM employes WHERE societe_id=$1', [req.params.id]);
  if (n.rows[0].n > 0) return res.status(409).json({ erreur: `${n.rows[0].n} employé(s) sont encore affectés à cette société.` });
  await q('DELETE FROM societes WHERE id=$1', [req.params.id]);
  await journaliser(req, 'suppression', `societe:${req.params.id}`);
  res.json({ ok: true });
});

// ---------- Services (RH) ----------
const schemaService = z.object({
  nom: z.string().trim().min(1).max(200),
  code: txt(20),
  wilaya: txt(60),          // détermine le congé du Sud pour le personnel administratif
  description: txt(300),
});

r.post('/services', exigerRole('rh'), async (req, res) => {
  const p = schemaService.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Données de service invalides.' });
  try {
    const { rows } = await q(
      'INSERT INTO services (nom, code, wilaya, description) VALUES ($1,$2,$3,$4) RETURNING *',
      [p.data.nom, p.data.code, p.data.wilaya, p.data.description]);
    await journaliser(req, 'creation', `service:${rows[0].id}`, { nom: p.data.nom });
    res.status(201).json(rows[0]);
  } catch { res.status(409).json({ erreur: 'Un service porte déjà ce nom.' }); }
});

r.put('/services/:id', exigerRole('rh'), async (req, res) => {
  const p = schemaService.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Données de service invalides.' });
  const { rows } = await q(
    'UPDATE services SET nom=$1, code=$2, wilaya=$3, description=$4 WHERE id=$5 RETURNING *',
    [p.data.nom, p.data.code, p.data.wilaya, p.data.description, req.params.id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Service introuvable.' });
  res.json(rows[0]);
});

r.delete('/services/:id', exigerRole('rh'), async (req, res) => {
  const [ne, nc] = await Promise.all([
    q('SELECT count(*)::int AS n FROM employes WHERE service_id=$1', [req.params.id]),
    q('SELECT count(*)::int AS n FROM chantiers WHERE service_id=$1', [req.params.id]),
  ]);
  if (ne.rows[0].n > 0) return res.status(409).json({ erreur: `${ne.rows[0].n} employé(s) sont affectés à ce service.` });
  if (nc.rows[0].n > 0) return res.status(409).json({ erreur: `${nc.rows[0].n} chantier(s) sont rattachés à ce service.` });
  await q('DELETE FROM comptes WHERE service_id=$1', [req.params.id]);
  await q('DELETE FROM services WHERE id=$1', [req.params.id]);
  await journaliser(req, 'suppression', `service:${req.params.id}`);
  res.json({ ok: true });
});

// ---------- Chantiers (RH) ----------
const schemaChantier = z.object({
  nom: z.string().trim().min(1).max(200),
  serviceId: z.number().int().positive(),
  code: txt(20),
  lieu: txt(200),
  wilaya: txt(60),          // détermine le congé supplémentaire du Sud (art. 42)
  client: txt(200),         // maître d'ouvrage
  dateOuverture: dateOpt,
  dateFermeture: dateOpt,
  actif: z.boolean().default(true),
});

const COLS_CH = 'nom,service_id,code,lieu,wilaya,client,date_ouverture,date_fermeture,actif';
const valsCh = (d) => [d.nom, d.serviceId, d.code, d.lieu, d.wilaya, d.client,
  d.dateOuverture ?? null, d.dateFermeture ?? null, d.actif];

r.post('/chantiers', exigerRole('rh'), async (req, res) => {
  const p = schemaChantier.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Données de chantier invalides.' });
  try {
    const { rows } = await q(
      `INSERT INTO chantiers (${COLS_CH}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, valsCh(p.data));
    await journaliser(req, 'creation', `chantier:${rows[0].id}`, { nom: p.data.nom });
    res.status(201).json(rows[0]);
  } catch { res.status(409).json({ erreur: 'Chantier en double ou service inexistant.' }); }
});

r.put('/chantiers/:id', exigerRole('rh'), async (req, res) => {
  const p = schemaChantier.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Données de chantier invalides.' });
  const affectCh = COLS_CH.split(',').map((c, i) => `${c.trim()}=$${i + 1}`).join(',');
  const { rows } = await q(`UPDATE chantiers SET ${affectCh} WHERE id=$10 RETURNING *`,
    [...valsCh(p.data), req.params.id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Chantier introuvable.' });
  res.json(rows[0]);
});

r.delete('/chantiers/:id', exigerRole('rh'), async (req, res) => {
  const n = await q('SELECT count(*)::int AS n FROM employes WHERE chantier_id=$1', [req.params.id]);
  if (n.rows[0].n > 0) return res.status(409).json({ erreur: `${n.rows[0].n} employé(s) sont affectés à ce chantier.` });
  await q('DELETE FROM comptes WHERE chantier_id=$1', [req.params.id]);
  await q('DELETE FROM chantiers WHERE id=$1', [req.params.id]);
  await journaliser(req, 'suppression', `chantier:${req.params.id}`);
  res.json({ ok: true });
});

// ---------- Rotations (RH) ----------
const schemaRotation = z.object({
  nom: z.string().trim().min(1).max(200),
  joursTravail: z.number().int().min(1).max(365),
  joursRepos: z.number().int().min(0).max(365),
});

r.post('/rotations', exigerRole('rh'), async (req, res) => {
  const p = schemaRotation.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Données de rotation invalides.' });
  try {
    const { rows } = await q('INSERT INTO rotations (nom, jours_travail, jours_repos) VALUES ($1,$2,$3) RETURNING *',
      [p.data.nom, p.data.joursTravail, p.data.joursRepos]);
    res.status(201).json(rows[0]);
  } catch { res.status(409).json({ erreur: 'Une rotation porte déjà ce nom.' }); }
});

r.put('/rotations/:id', exigerRole('rh'), async (req, res) => {
  const p = schemaRotation.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Données de rotation invalides.' });
  const { rows } = await q('UPDATE rotations SET nom=$1, jours_travail=$2, jours_repos=$3 WHERE id=$4 RETURNING *',
    [p.data.nom, p.data.joursTravail, p.data.joursRepos, req.params.id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Rotation introuvable.' });
  res.json(rows[0]);
});

r.delete('/rotations/:id', exigerRole('rh'), async (req, res) => {
  const n = await q('SELECT count(*)::int AS n FROM employes WHERE rotation_id=$1', [req.params.id]);
  if (n.rows[0].n > 0) return res.status(409).json({ erreur: `${n.rows[0].n} employé(s) suivent cette rotation.` });
  await q('DELETE FROM rotations WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- Comptes (RH) ----------
r.get('/comptes', exigerRole('rh', 'direction'), async (_req, res) => {
  const { rows } = await q('SELECT id,nom,email,telephone,fonction,role,service_id,chantier_id,doit_changer_mdp,actif FROM comptes ORDER BY nom');
  res.json(rows);
});

const schemaCompte = z.object({
  nom: z.string().trim().min(1).max(200),
  email: z.string().email().max(200),
  telephone: txt(30),
  fonction: txt(120),
  motDePasse: z.string().min(8).max(200).optional(),
  role: z.enum(['chef_service', 'chef_chantier', 'superviseur']),
  serviceId: z.number().int().positive().nullable().optional(),
  chantierId: z.number().int().positive().nullable().optional(),
});

async function resoudrePortee(data) {
  if (data.role === 'chef_service') {
    if (!data.serviceId) throw new Error('Un chef de service doit être rattaché à un service.');
    return { serviceId: data.serviceId, chantierId: null };
  }
  if (!data.chantierId) throw new Error('Un chef de chantier / superviseur doit être rattaché à un chantier.');
  const { rows } = await q('SELECT service_id FROM chantiers WHERE id=$1', [data.chantierId]);
  if (!rows[0]) throw new Error('Chantier introuvable.');
  return { serviceId: rows[0].service_id, chantierId: data.chantierId };
}

r.post('/comptes', exigerRole('rh'), async (req, res) => {
  const p = schemaCompte.safeParse(req.body);
  if (!p.success || !p.data.motDePasse) return res.status(400).json({ erreur: 'Données de compte invalides (mot de passe : 8 caractères minimum).' });
  try {
    const portee = await resoudrePortee(p.data);
    const { rows } = await q(
      `INSERT INTO comptes (nom,email,telephone,fonction,mdp_hash,role,service_id,chantier_id,doit_changer_mdp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
       RETURNING id,nom,email,telephone,fonction,role,service_id,chantier_id,doit_changer_mdp,actif`,
      [p.data.nom, p.data.email, p.data.telephone, p.data.fonction,
       bcrypt.hashSync(p.data.motDePasse, 12), p.data.role, portee.serviceId, portee.chantierId]);
    await journaliser(req, 'creation', `compte:${rows[0].id}`, { email: p.data.email, role: p.data.role });
    await envoyer('email', p.data.nom, p.data.email,
      'Votre compte AIFG Registre RH a été créé',
      `Bonjour ${p.data.nom},\n\nUn compte (${p.data.role.replace('_', ' ')}) vous a été créé sur l'application Registre RH d'AIFG.\n\nIdentifiant : ${p.data.email}\nMot de passe temporaire : ${p.data.motDePasse}\n\nPar sécurité, vous devrez choisir un nouveau mot de passe lors de votre première connexion.`);
    res.status(201).json(rows[0]);
  } catch (e) {
    const msg = String(e.message || '');
    if (msg.includes('duplicate')) return res.status(409).json({ erreur: 'Un compte existe déjà avec cet e-mail.' });
    res.status(400).json({ erreur: msg || 'Création impossible.' });
  }
});

r.put('/comptes/:id', exigerRole('rh'), async (req, res) => {
  const p = schemaCompte.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Données de compte invalides.' });
  const existant = (await q('SELECT * FROM comptes WHERE id=$1', [req.params.id])).rows[0];
  if (!existant) return res.status(404).json({ erreur: 'Compte introuvable.' });
  if (['rh', 'direction'].includes(existant.role)) return res.status(400).json({ erreur: 'Les comptes RH et Direction se gèrent hors de cette interface.' });
  try {
    const portee = await resoudrePortee(p.data);
    const mdpChange = !!p.data.motDePasse;
    const { rows } = await q(
      `UPDATE comptes SET nom=$1,email=$2,role=$3,service_id=$4,chantier_id=$5,telephone=$7,fonction=$8
         ${mdpChange ? ', mdp_hash=$9, doit_changer_mdp=TRUE' : ''}
       WHERE id=$6 RETURNING id,nom,email,telephone,fonction,role,service_id,chantier_id,doit_changer_mdp,actif`,
      mdpChange
        ? [p.data.nom, p.data.email, p.data.role, portee.serviceId, portee.chantierId, req.params.id, p.data.telephone, p.data.fonction, bcrypt.hashSync(p.data.motDePasse, 12)]
        : [p.data.nom, p.data.email, p.data.role, portee.serviceId, portee.chantierId, req.params.id, p.data.telephone, p.data.fonction]);
    await journaliser(req, 'modification', `compte:${req.params.id}`, { mdpChange });
    if (mdpChange) {
      await envoyer('email', p.data.nom, p.data.email,
        'Votre mot de passe a été réinitialisé — AIFG Registre RH',
        `Bonjour ${p.data.nom},\n\nVotre mot de passe a été réinitialisé par le service RH.\n\nIdentifiant : ${p.data.email}\nMot de passe temporaire : ${p.data.motDePasse}\n\nVous devrez le changer à votre prochaine connexion.`);
    }
    res.json(rows[0]);
  } catch (e) { res.status(400).json({ erreur: String(e.message || 'Modification impossible.') }); }
});

r.delete('/comptes/:id', exigerRole('rh'), async (req, res) => {
  const existant = (await q('SELECT role FROM comptes WHERE id=$1', [req.params.id])).rows[0];
  if (!existant) return res.status(404).json({ erreur: 'Compte introuvable.' });
  if (['rh', 'direction'].includes(existant.role)) return res.status(400).json({ erreur: 'Ce compte ne peut pas être supprimé.' });
  await q('UPDATE comptes SET actif=FALSE WHERE id=$1', [req.params.id]); // désactivation (traçabilité)
  await journaliser(req, 'desactivation', `compte:${req.params.id}`);
  res.json({ ok: true });
});

export default r;
