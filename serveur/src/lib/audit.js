import { q } from './db.js';

export async function journaliser(req, action, ressource, details = {}) {
  const c = req.compte || {};
  await q(
    'INSERT INTO journal_audit (compte_id, compte_email, action, ressource, details, ip) VALUES ($1,$2,$3,$4,$5,$6)',
    [c.id ?? null, c.email ?? '', action, ressource, JSON.stringify(details), req.ip || '']
  );
}
