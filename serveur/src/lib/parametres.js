/**
 * Cadre légal paramétrable.
 *
 * PRINCIPE : aucune règle de droit du travail n'est écrite en dur dans le code.
 * Tout (jours de repos, taux, plafonds, wilayas du Sud, durées légales) vient de
 * la table `parametres` et se modifie depuis l'interface RH — sans redéploiement.
 * La loi 90-11 est en cours de modification (projet déposé en 2025) : cette
 * conception permet d'absorber les changements sans réécrire l'application.
 */
import { q } from './db.js';

let cache = null;
let cacheExpire = 0;
const DUREE_CACHE_MS = 60_000;

export async function chargerParametres(forcer = false) {
  if (!forcer && cache && Date.now() < cacheExpire) return cache;
  const { rows } = await q('SELECT cle, valeur FROM parametres');
  cache = Object.fromEntries(rows.map((r) => [r.cle, r.valeur]));
  cacheExpire = Date.now() + DUREE_CACHE_MS;
  return cache;
}

export const viderCacheParametres = () => { cache = null; cacheExpire = 0; };

export async function param(cle, defaut = null) {
  const p = await chargerParametres();
  return p[cle] !== undefined ? p[cle] : defaut;
}

// ---------- Jours fériés ----------
export async function joursFeries(anneeDebut, anneeFin) {
  const { rows } = await q(
    `SELECT to_char(date,'YYYY-MM-DD') AS date, libelle, chome_paye
     FROM jours_feries WHERE date >= $1 AND date <= $2 ORDER BY date`,
    [`${anneeDebut}-01-01`, `${anneeFin}-12-31`]
  );
  return rows;
}

export async function estJourFerie(dateISO) {
  const { rows } = await q('SELECT 1 FROM jours_feries WHERE date = $1 AND chome_paye', [dateISO]);
  return rows.length > 0;
}

// ---------- Calendrier ----------
/** Jours ouvrés entre deux dates : repos hebdomadaire et jours fériés exclus (paramétrables). */
export async function joursOuvresLegaux(debut, fin) {
  const repos = await param('jours_repos_hebdomadaire', [5, 6]);
  const d = new Date(debut + 'T00:00:00Z');
  const f = new Date(fin + 'T00:00:00Z');
  if (isNaN(d) || isNaN(f) || f < d) return 0;

  const { rows } = await q(
    'SELECT to_char(date,\'YYYY-MM-DD\') AS date FROM jours_feries WHERE date BETWEEN $1 AND $2 AND chome_paye',
    [debut, fin]
  );
  const feries = new Set(rows.map((r) => r.date));

  let n = 0;
  const cur = new Date(d);
  while (cur <= f) {
    const iso = cur.toISOString().slice(0, 10);
    if (!repos.includes(cur.getUTCDay()) && !feries.has(iso)) n++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

// ---------- Droits à congé (art. 40 à 46 loi 90-11) ----------
/** Période de référence en cours : du 1er juillet (paramétrable) au 30 juin suivant. */
export async function periodeReference(dateRef = new Date()) {
  const mmjj = String(await param('periode_reference_debut', '07-01'));
  const [mois, jour] = mmjj.split('-').map(Number);
  const annee = dateRef.getUTCFullYear();
  const debutCetteAnnee = new Date(Date.UTC(annee, mois - 1, jour));
  const debut = dateRef >= debutCetteAnnee ? debutCetteAnnee : new Date(Date.UTC(annee - 1, mois - 1, jour));
  const fin = new Date(debut); fin.setUTCFullYear(fin.getUTCFullYear() + 1); fin.setUTCDate(fin.getUTCDate() - 1);
  return { debut: debut.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

/**
 * Calcule les droits à congé d'un employé pour une période de référence.
 * - Congé principal : 2,5 jours par mois travaillé, plafonné à 30 jours (art. 41)
 * - Congé du Sud : au moins 10 jours si le lieu de travail est une wilaya du Sud (art. 42)
 * - Ancienneté : selon la convention collective (paramétrable, vide par défaut)
 */
export async function calculerDroitsConge(employe, wilayaTravail, periode) {
  const parMois = Number(await param('conge_jours_par_mois', 2.5));
  const plafond = Number(await param('conge_plafond_annuel', 30));
  const joursSud = Number(await param('conge_sud_jours', 10));
  const wilayasSud = await param('wilayas_sud', []);
  const trancheAnciennete = await param('conge_anciennete', []);

  // Mois travaillés dans la période (l'embauche en cours de période est prise en compte)
  const debut = new Date(periode.debut + 'T00:00:00Z');
  const fin = new Date(periode.fin + 'T00:00:00Z');
  const embauche = new Date(String(employe.date_embauche).slice(0, 10) + 'T00:00:00Z');
  const depart = embauche > debut ? embauche : debut;
  const aujourdhui = new Date();
  const arret = fin < aujourdhui ? fin : aujourdhui;
  if (arret < depart) {
    return { moisTravailles: 0, joursPrincipal: 0, joursSud: 0, joursAnciennete: 0, total: 0, wilaya: wilayaTravail, estSud: false };
  }

  // Art. 44 : au-delà de 15 jours ouvrables, le premier mois compte pour un mois entier.
  const joursEcoules = Math.floor((arret - depart) / 86400000) + 1;
  const moisTravailles = Math.min(12, Math.round((joursEcoules / 30.44) * 2) / 2);

  const joursPrincipal = Math.min(plafond, Math.round(moisTravailles * parMois * 2) / 2);

  const estSud = !!wilayaTravail && wilayasSud.some((w) => w.toLowerCase() === String(wilayaTravail).toLowerCase());
  const sud = estSud ? Math.round((joursSud * (moisTravailles / 12)) * 2) / 2 : 0;

  // Ancienneté : [{ ansMin: 10, jours: 2 }, ...] défini par la convention collective
  const anciennete = Math.floor((aujourdhui - embauche) / (365.25 * 86400000));
  const bonus = (Array.isArray(trancheAnciennete) ? trancheAnciennete : [])
    .filter((t) => anciennete >= Number(t.ansMin))
    .reduce((max, t) => Math.max(max, Number(t.jours) || 0), 0);

  return {
    moisTravailles,
    joursPrincipal,
    joursSud: sud,
    joursAnciennete: bonus,
    total: Math.round((joursPrincipal + sud + bonus) * 2) / 2,
    wilaya: wilayaTravail || '',
    estSud,
  };
}

// ---------- Heures supplémentaires (art. 31 et 32) ----------
/** Plafond légal d'heures supplémentaires sur un mois (20 % de la durée légale). */
export async function plafondHeuresSuppMensuel() {
  const dureeHebdo = Number(await param('duree_legale_hebdomadaire', 40));
  const pourcent = Number(await param('hs_plafond_pourcent_duree_legale', 20));
  return Math.round(dureeHebdo * (pourcent / 100) * 4.33 * 10) / 10; // ≈ 4,33 semaines par mois
}

/** Majorations applicables, exprimées en pourcentage. */
export async function tauxMajorations() {
  return {
    normale: Number(await param('hs_majoration_pourcent', 50)),
    repos: Number(await param('hs_majoration_repos_pourcent', 75)),
    ferie: Number(await param('hs_majoration_ferie_pourcent', 100)),
    nuit: Number(await param('hs_majoration_nuit_pourcent', 25)),
  };
}
