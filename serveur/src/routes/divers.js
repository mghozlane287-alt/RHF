import { Router } from 'express';
import { z } from 'zod';
import { q } from '../lib/db.js';
import { exigerAuth, exigerMdpChange, exigerRole } from '../lib/auth.js';
import { envoyer } from '../lib/messagerie.js';
import { journaliser } from '../lib/audit.js';

const r = Router();
r.use(exigerAuth, exigerMdpChange);

const cibleDe = (compte) =>
  compte.role === 'rh' ? 'rh' : compte.role === 'direction' ? 'direction' : `service:${compte.serviceId}`;

r.get('/notifications', async (req, res) => {
  const { rows } = await q('SELECT * FROM notifications WHERE cible=$1 ORDER BY id DESC LIMIT 100', [cibleDe(req.compte)]);
  res.json(rows);
});

r.post('/notifications/lues', async (req, res) => {
  await q('UPDATE notifications SET lue=TRUE WHERE cible=$1', [cibleDe(req.compte)]);
  res.json({ ok: true });
});

r.get('/envois', exigerRole('rh'), async (_req, res) => {
  const { rows } = await q('SELECT * FROM envois ORDER BY id DESC LIMIT 200');
  res.json(rows);
});

// Rappels manuels (visite médicale / renouvellement de contrat)
const schemaRappel = z.object({ employeId: z.number().int().positive(), type: z.enum(['visite', 'contrat']) });
r.post('/rappels', exigerRole('rh'), async (req, res) => {
  const p = schemaRappel.safeParse(req.body);
  if (!p.success) return res.status(400).json({ erreur: 'Rappel invalide.' });
  const e = (await q('SELECT * FROM employes WHERE id=$1 AND actif', [p.data.employeId])).rows[0];
  if (!e) return res.status(404).json({ erreur: 'Employé introuvable ou sorti de l\'effectif.' });
  const fr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  if (p.data.type === 'visite') {
    await envoyer('whatsapp', `${e.prenom} ${e.nom}`, e.telephone,
      'Rappel — visite médicale',
      `Bonjour ${e.prenom}, votre visite médicale du travail est prévue le ${fr(e.prochaine_visite_medicale)}. Merci de vous présenter au service médical avec votre dossier.`);
  } else {
    await envoyer('whatsapp', `${e.prenom} ${e.nom}`, e.telephone,
      'Renouvellement de contrat',
      `Bonjour ${e.prenom}, votre contrat CDD arrive à échéance le ${fr(e.fin_contrat)}. Merci de passer au service RH pour la procédure de renouvellement.`);
  }
  await journaliser(req, 'rappel_' + p.data.type, `employe:${e.id}`);
  res.json({ ok: true });
});

r.get('/audit', exigerRole('rh', 'direction'), async (_req, res) => {
  const { rows } = await q('SELECT * FROM journal_audit ORDER BY id DESC LIMIT 300');
  res.json(rows);
});

export default r;
