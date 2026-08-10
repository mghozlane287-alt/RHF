/** Règles métier partagées (identiques au frontend, testées côté serveur). */
export const CODES = ['P', 'IZ', 'CR', 'CA', 'CE', 'M', 'A', 'S', 'CSS', 'MAP'];
export const CODES_TRAVAILLES = ['P', 'IZ'];

export function nbJoursMois(mois) {
  const [a, m] = mois.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

export function joursOuvres(debut, fin) {
  const d = new Date(debut + 'T00:00:00Z'); const f = new Date(fin + 'T00:00:00Z');
  if (isNaN(d) || isNaN(f) || f < d) return 0;
  let n = 0; const cur = new Date(d);
  while (cur <= f) { const j = cur.getUTCDay(); if (j !== 5 && j !== 6) n++; cur.setUTCDate(cur.getUTCDate() + 1); }
  return n;
}

/** Code théorique d'un jour pour le pré-remplissage. */
export function codeTheorique(employe, rotation, dateISO, joursRepos = [5, 6]) {
  const d = new Date(dateISO + 'T00:00:00Z');
  if (employe.categorie === 'Administratif' || !rotation || !employe.debut_cycle) {
    const j = d.getUTCDay();
    return joursRepos.includes(j) ? 'CR' : 'P';
  }
  const brut = employe.debut_cycle instanceof Date
    ? employe.debut_cycle.toISOString().slice(0, 10)
    : String(employe.debut_cycle).slice(0, 10);
  const debut = new Date(brut + 'T00:00:00Z');
  if (isNaN(debut)) return 'P';
  const diff = Math.floor((d - debut) / 86400000);
  const cycle = rotation.jours_travail + rotation.jours_repos;
  const pos = ((diff % cycle) + cycle) % cycle;
  return pos < rotation.jours_travail ? 'IZ' : 'CR';
}

/** Transitions autorisées du circuit de pointage, selon le rôle. */
export function transitionFeuilleAutorisee(statutActuel, statutCible, role) {
  const t = `${statutActuel} -> ${statutCible}`;
  const regles = {
    'En préparation -> Chez le chef de service': ['chef_chantier', 'superviseur', 'rh'],
    'En préparation -> Chez RH': ['chef_service', 'rh'],
    'Chez le chef de service -> Chez RH': ['chef_service', 'rh'],
    'Chez le chef de service -> En préparation': ['chef_service', 'rh'],
    'Chez RH -> Archivée': ['rh'],
    'Chez RH -> En préparation': ['rh'],
  };
  return (regles[t] || []).includes(role);
}
