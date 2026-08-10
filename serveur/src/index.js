import 'dotenv/config';   // charge .env quel que soit le systeme (Windows comme Linux)
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import auth from './routes/auth.js';
import referentiel from './routes/referentiel.js';
import employes from './routes/employes.js';
import feuilles from './routes/feuilles.js';
import conges from './routes/conges.js';
import divers from './routes/divers.js';
import legal from './routes/legal.js';
import documents from './routes/documents.js';
import { migrer, semer } from './lib/migrate.js';
import { pool, q } from './lib/db.js';

export const VERSION = '1.2.0';

/**
 * Garde-fou de demarrage : en production, l'application REFUSE de demarrer si un
 * secret par defaut ou une configuration dangereuse est detectee. Mieux vaut un
 * service qui ne demarre pas qu'un service qui tourne avec un secret public.
 */
export function verifierConfiguration() {
  const problemes = [];
  const production = process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_SECRET || '';

  if (!secret || secret.includes('CHANGER')) problemes.push("JWT_SECRET absent ou laisse a sa valeur par defaut.");
  else if (secret.length < 32) problemes.push('JWT_SECRET trop court (32 caracteres minimum).');
  if (!process.env.DATABASE_URL) problemes.push('DATABASE_URL absent : le fichier .env est introuvable ou vide.');
  else if (/:(aifg_dev|postgres|motdepasse|password)@/i.test(process.env.DATABASE_URL))
    problemes.push('DATABASE_URL contient un mot de passe de demonstration.');
  if (production && !process.env.ORIGINE_FRONTEND) problemes.push('ORIGINE_FRONTEND absent : CORS serait ouvert a tous.');

  if (problemes.length && production) {
    if (process.env.MODE_DEMONSTRATION === 'true') {
      console.warn('\n[MODE DEMONSTRATION] Configuration non conforme a la production :');
      problemes.forEach((p) => console.warn('  - ' + p));
      console.warn('  N UTILISEZ AUCUNE DONNEE REELLE DU PERSONNEL DANS CE MODE.\n');
    } else {
    console.error('\n*** DEMARRAGE REFUSE — configuration non securisee ***');
    problemes.forEach((p) => console.error('  - ' + p));
    console.error('\nCorrigez le fichier .env (voir .env.example) puis redemarrez le service.\n');
    process.exit(1);
    }
  }
  if (problemes.length) problemes.forEach((p) => console.warn('[AVERTISSEMENT] ' + p));
}

export function creerApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: process.env.ORIGINE_FRONTEND || true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

  // Journal d'acces (sans donnees personnelles : ni corps de requete, ni identifiants)
  app.use((req, res, suite) => {
    const debut = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/sante') return;
      // On journalise le chemin sans la chaîne de requête : elle peut contenir un jeton.
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - debut}ms`);
    });
    suite();
  });

  app.get('/api/sante', async (_req, res) => {
    try { await q('SELECT 1'); res.json({ ok: true, base: 'accessible', version: VERSION }); }
    catch { res.status(503).json({ ok: false, base: 'injoignable' }); }
  });
  app.use('/api/auth', auth);
  app.use('/api', referentiel);
  app.use('/api/employes', employes);
  app.use('/api/feuilles', feuilles);
  app.use('/api/conges', conges);
  app.use('/api', divers);
  app.use('/api', legal);
  app.use('/api', documents);

  // Frontend statique (build Vite) + repli SPA
  const dossierClient = process.env.DOSSIER_CLIENT || path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
  app.use(express.static(dossierClient, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api).*/, (_req, res, suite) => {
    res.sendFile(path.join(dossierClient, 'index.html'), (err) => err && suite());
  });

  app.use((_req, res) => res.status(404).json({ erreur: 'Route inconnue.' }));
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ erreur: 'Erreur interne du serveur.' }); // jamais de détails techniques au client
  });
  return app;
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  const PORT = Number(process.env.PORT || 3001);
  const HOTE = process.env.HOTE || '127.0.0.1'; // jamais expose directement : passer par IIS
  verifierConfiguration();
  migrer().then(semer).then(() => {
    const serveur = creerApp().listen(PORT, HOTE, () =>
      console.log(`[${new Date().toISOString()}] API Registre RH v${VERSION} sur ${HOTE}:${PORT}`));

    let arretEnCours = false;
    const arreter = (signal) => {
      if (arretEnCours) return;
      arretEnCours = true;
      console.log(`[${new Date().toISOString()}] Signal ${signal} - arret en cours...`);
      serveur.close(async () => { await pool.end(); process.exit(0); });
      setTimeout(() => process.exit(1), 15000).unref();
    };
    ['SIGTERM', 'SIGINT', 'SIGBREAK'].forEach((sg) => process.on(sg, () => arreter(sg)));
    process.on('unhandledRejection', (e) => console.error('Rejet non gere :', e));
    process.on('uncaughtException', (e) => { console.error('Exception non geree :', e); arreter('exception'); });
  }).catch((e) => { console.error('Demarrage impossible :', e); process.exit(1); });
}
