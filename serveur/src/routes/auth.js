import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { q } from '../lib/db.js';
import { signerToken, exigerAuth, poserCookieRafraichissement, lireCookieRafraichissement, effacerCookieRafraichissement } from '../lib/auth.js';
import { journaliser } from '../lib/audit.js';

const r = Router();

/**
 * Limitation de débit sur la connexion.
 * IMPORTANT : la clé est « IP + e-mail », pas l'IP seule. Sur un chantier, tous les
 * utilisateurs partagent une seule connexion (VSAT / 4G) et donc une seule IP publique :
 * limiter par IP seule ferait qu'un utilisateur maladroit bloquerait toute l'équipe.
 * Le verrouillage de compte (5 échecs) reste la protection principale par utilisateur.
 */
const limiteConnexion = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  // ipKeyGenerator normalise l'adresse (indispensable en IPv6 : sans lui, un attaquant
  // change simplement d'adresse dans son prefixe /64 pour contourner la limite).
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email || '').toLowerCase().slice(0, 100)}`,
  message: { erreur: 'Trop de tentatives pour ce compte. Réessayez dans 15 minutes.' },
  standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true, // seules les tentatives échouées comptent
});

const MAX_ECHECS = 5;
const VERROU_MIN = 15;

const schemaConnexion = z.object({
  email: z.string().email().max(200),
  motDePasse: z.string().min(1).max(200),
});

r.post('/connexion', limiteConnexion, async (req, res) => {
  const p = schemaConnexion.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'E-mail ou mot de passe invalide.' });
  const { email, motDePasse } = p.data;

  const { rows } = await q('SELECT * FROM comptes WHERE lower(email)=lower($1) AND actif', [email]);
  const compte = rows[0];
  // Réponse identique que le compte existe ou non (anti-énumération)
  const refus = () => res.status(401).json({ erreur: 'Identifiants incorrects.' });

  if (!compte) { await bcrypt.compare(motDePasse, '$2a$12$invalidesaltinvalidesalt12345678901234567890123456789'); return refus(); }

  if (compte.verrou_jusqua && new Date(compte.verrou_jusqua) > new Date()) {
    return res.status(423).json({ erreur: `Compte temporairement verrouillé suite à des échecs répétés. Réessayez plus tard.` });
  }

  const ok = await bcrypt.compare(motDePasse, compte.mdp_hash);
  if (!ok) {
    const echecs = compte.echecs_connexion + 1;
    const verrou = echecs >= MAX_ECHECS ? `now() + interval '${VERROU_MIN} minutes'` : 'NULL';
    await q(`UPDATE comptes SET echecs_connexion=$1, verrou_jusqua=${verrou} WHERE id=$2`, [echecs >= MAX_ECHECS ? 0 : echecs, compte.id]);
    await journaliser(req, 'connexion_echec', `compte:${compte.id}`, { email });
    return refus();
  }

  await q('UPDATE comptes SET echecs_connexion=0, verrou_jusqua=NULL, derniere_connexion=now() WHERE id=$1', [compte.id]);
  poserCookieRafraichissement(res, compte);
  await journaliser({ ...req, compte: { id: compte.id, email: compte.email } }, 'connexion', `compte:${compte.id}`);
  return res.json({
    token: signerToken(compte),
    compte: {
      id: compte.id, nom: compte.nom, email: compte.email, role: compte.role,
      serviceId: compte.service_id, chantierId: compte.chantier_id,
      doitChangerMdp: compte.doit_changer_mdp,
    },
  });
});

const schemaMdp = z.object({
  ancien: z.string().min(1).max(200),
  nouveau: z.string().min(8).max(200)
    .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Le mot de passe doit contenir des lettres et des chiffres.'),
});

r.post('/changer-mot-de-passe', exigerAuth, async (req, res) => {
  const p = schemaMdp.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ erreur: p.error.issues[0]?.message || 'Mot de passe invalide (8 caractères minimum, lettres et chiffres).' });
  }
  const { ancien, nouveau } = p.data;
  const { rows } = await q('SELECT * FROM comptes WHERE id=$1 AND actif', [req.compte.id]);
  const compte = rows[0];
  if (!compte) return res.status(401).json({ erreur: 'Compte introuvable.' });
  if (!(await bcrypt.compare(ancien, compte.mdp_hash))) return res.status(401).json({ erreur: 'Ancien mot de passe incorrect.' });
  if (await bcrypt.compare(nouveau, compte.mdp_hash)) return res.status(400).json({ erreur: "Le nouveau mot de passe doit être différent de l'ancien." });

  // jeton_version incrémenté : toutes les autres sessions ouvertes sont invalidées.
  const maj = await q(
    'UPDATE comptes SET mdp_hash=$1, doit_changer_mdp=FALSE, jeton_version=jeton_version+1 WHERE id=$2 RETURNING *',
    [bcrypt.hashSync(nouveau, 12), compte.id]);
  poserCookieRafraichissement(res, maj.rows[0]);
  await journaliser(req, 'changement_mdp', `compte:${compte.id}`);
  res.json({ ok: true });
});

/** Rafraîchit la session à partir du cookie httpOnly (rechargement de page). */
r.post('/rafraichir', async (req, res) => {
  const charge = lireCookieRafraichissement(req);
  if (!charge) return res.status(401).json({ erreur: 'Session expirée.' });
  const { rows } = await q('SELECT * FROM comptes WHERE id=$1 AND actif', [charge.id]);
  const compte = rows[0];
  // jeton_version permet de révoquer toutes les sessions d'un compte (changement de mdp, désactivation)
  if (!compte || compte.jeton_version !== charge.v) {
    effacerCookieRafraichissement(res);
    return res.status(401).json({ erreur: 'Session expirée. Reconnectez-vous.' });
  }
  poserCookieRafraichissement(res, compte);
  res.json({
    token: signerToken(compte),
    compte: {
      id: compte.id, nom: compte.nom, email: compte.email, role: compte.role,
      serviceId: compte.service_id, chantierId: compte.chantier_id, doitChangerMdp: compte.doit_changer_mdp,
    },
  });
});

r.post('/deconnexion', (req, res) => { effacerCookieRafraichissement(res); res.json({ ok: true }); });

r.get('/moi', exigerAuth, async (req, res) => {
  const { rows } = await q('SELECT id,nom,email,role,service_id,chantier_id,doit_changer_mdp FROM comptes WHERE id=$1 AND actif', [req.compte.id]);
  if (!rows[0]) return res.status(401).json({ erreur: 'Compte introuvable.' });
  const c = rows[0];
  res.json({ id: c.id, nom: c.nom, email: c.email, role: c.role, serviceId: c.service_id, chantierId: c.chantier_id, doitChangerMdp: c.doit_changer_mdp });
});

export default r;
