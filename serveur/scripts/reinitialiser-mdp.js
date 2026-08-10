/**
 * Réinitialisation d'un mot de passe en ligne de commande (dépannage).
 * Usage : node scripts/reinitialiser-mdp.js utilisateur@aifg.dz
 * Génère un mot de passe temporaire, révoque les sessions ouvertes et impose
 * un changement à la prochaine connexion.
 */
import bcrypt from 'bcryptjs';
import { pool, q } from '../src/lib/db.js';

const email = process.argv[2];
if (!email) { console.error('Usage : node scripts/reinitialiser-mdp.js <email>'); process.exit(1); }

const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const temporaire = Array.from({ length: 14 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');

const r = await q(
  `UPDATE comptes SET mdp_hash=$1, doit_changer_mdp=TRUE, jeton_version=jeton_version+1,
          echecs_connexion=0, verrou_jusqua=NULL
   WHERE lower(email)=lower($2) AND actif RETURNING nom, email`,
  [bcrypt.hashSync(temporaire, 12), email]
);

if (!r.rows[0]) { console.error(`Aucun compte actif pour ${email}.`); await pool.end(); process.exit(1); }

await q(
  `INSERT INTO journal_audit (compte_email, action, ressource, details)
   VALUES ($1, 'reinitialisation_mdp_console', $2, '{"origine":"ligne de commande"}')`,
  ['console', `compte:${r.rows[0].email}`]
);

console.log(`\nCompte  : ${r.rows[0].nom} <${r.rows[0].email}>`);
console.log(`Nouveau mot de passe temporaire : ${temporaire}`);
console.log(`\nTransmettez-le a l'utilisateur : il devra le changer a la prochaine connexion.`);
console.log('Toutes ses sessions ouvertes ont ete revoquees.\n');
await pool.end();
