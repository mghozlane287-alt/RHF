import jwt from 'jsonwebtoken';
import { q } from './db.js';

export const SECRET = process.env.JWT_SECRET || 'CHANGER-CE-SECRET-EN-PRODUCTION';
const SECRET_RAFRAICHISSEMENT = process.env.JWT_SECRET_RAFRAICHISSEMENT || SECRET + '-rafraichissement';
const NOM_COOKIE = 'aifg_session';
const DUREE_COOKIE_MS = 12 * 60 * 60 * 1000; // 12 h
const DUREE = process.env.JWT_DUREE || '8h';

export const signerToken = (compte) =>
  jwt.sign(
    { id: compte.id, role: compte.role, serviceId: compte.service_id, chantierId: compte.chantier_id, nom: compte.nom, email: compte.email },
    SECRET, { expiresIn: DUREE }
  );

/** Middleware : exige un JWT valide, charge req.compte. */
export function exigerAuth(req, res, next) {
  const h = req.headers.authorization || '';
  // Le jeton en paramètre d'URL n'est accepté que pour l'affichage d'un fichier
  // (les balises <img> et les liens ne peuvent pas porter d'en-tête Authorization).
  // Ces URL ne sont jamais journalisées et l'accès reste soumis au contrôle de périmètre.
  const jetonUrl = /\/documents\/\d+\/fichier$/.test(req.path) ? req.query.jeton : null;
  const token = h.startsWith('Bearer ') ? h.slice(7) : (jetonUrl || null);
  if (!token) return res.status(401).json({ erreur: 'Authentification requise.' });
  try {
    req.compte = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ erreur: 'Session expirée ou invalide. Reconnectez-vous.' });
  }
}

/** Middleware : exige un des rôles listés. */
export const exigerRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.compte.role)) return res.status(403).json({ erreur: 'Accès refusé pour votre rôle.' });
  next();
};

/** Middleware : refuse tant que le mot de passe temporaire n'a pas été changé. */
export async function exigerMdpChange(req, res, next) {
  const { rows } = await q('SELECT doit_changer_mdp FROM comptes WHERE id=$1 AND actif', [req.compte.id]);
  if (!rows[0]) return res.status(401).json({ erreur: 'Compte introuvable ou désactivé.' });
  if (rows[0].doit_changer_mdp) return res.status(428).json({ erreur: 'Vous devez d\'abord changer votre mot de passe.' });
  next();
}

/** Portée de lecture selon le rôle : renvoie {tous:boolean, serviceId, chantierId}. */
export function portee(compte) {
  if (compte.role === 'rh' || compte.role === 'direction') return { tous: true, serviceId: null, chantierId: null };
  if (compte.role === 'chef_service') return { tous: false, serviceId: compte.serviceId, chantierId: null };
  return { tous: false, serviceId: compte.serviceId, chantierId: compte.chantierId };
}


/**
 * Cookie de rafraîchissement : httpOnly (illisible par un script), Secure en HTTPS,
 * SameSite=Strict (protection CSRF). Il permet de rester connecté après un
 * rechargement de page sans jamais exposer de jeton au JavaScript de la page.
 */
export function poserCookieRafraichissement(res, compte) {
  const jetonR = jwt.sign({ id: compte.id, v: compte.jeton_version ?? 1 }, SECRET_RAFRAICHISSEMENT, { expiresIn: '12h' });
  res.cookie(NOM_COOKIE, jetonR, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: DUREE_COOKIE_MS,
    path: '/api/auth',
  });
}

export function lireCookieRafraichissement(req) {
  const brut = req.cookies?.[NOM_COOKIE];
  if (!brut) return null;
  try { return jwt.verify(brut, SECRET_RAFRAICHISSEMENT); } catch { return null; }
}

export function effacerCookieRafraichissement(res) {
  res.clearCookie(NOM_COOKIE, { path: '/api/auth' });
}
