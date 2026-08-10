import pg from 'pg';

// Les colonnes DATE (OID 1082) doivent rester des chaînes 'AAAA-MM-JJ'
// et non des objets Date (sinon décalage de fuseau et parsing cassé).
pg.types.setTypeParser(1082, (v) => v);

const chaine = process.env.DATABASE_URL || 'postgresql://aifg:aifg_dev@localhost:5432/aifg_rh';

/**
 * Les bases PostgreSQL hébergées (Neon, Supabase, Render...) imposent une connexion
 * chiffrée. Leur certificat est signé par une autorité que Node ne connaît pas toujours :
 * on active TLS sans exiger la vérification de la chaîne, ce qui reste sûr ici car la
 * connexion se fait vers un hôte nommé explicitement dans DATABASE_URL.
 * En local (localhost), aucun TLS n'est requis.
 */
const exigeTls = /sslmode=require|sslmode=verify/.test(chaine)
  || (process.env.DB_SSL === 'true')
  || (!/localhost|127\.0\.0\.1/.test(chaine) && process.env.NODE_ENV === 'production');

export const pool = new pg.Pool({
  connectionString: chaine,
  ssl: exigeTls ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (e) => console.error('Erreur du pool PostgreSQL :', e.message));

/** Requête paramétrée (jamais de concaténation SQL). */
export const q = (texte, params = []) => pool.query(texte, params);
