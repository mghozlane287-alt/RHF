// ===== Modèle de données — AIFG RH =====
export type Categorie = 'Chantier' | 'Administratif';
export type CodePointage = 'P' | 'IZ' | 'CR' | 'CA' | 'CE' | 'M' | 'A' | 'S' | 'CSS' | 'MAP';
export type StatutConge = 'En attente (chef de service)' | 'En attente (RH)' | 'Approuvé' | 'Refusé';
export type StatutFeuille = 'En préparation' | 'Chez le chef de service' | 'Chez RH' | 'Archivée';
export type RoleCompte = 'Chef de service' | 'Chef de chantier' | 'Superviseur';
export type TypeConge = 'Congé annuel' | 'Congé de récupération' | 'Congé exceptionnel' | 'Congé maladie' | 'Congé maternité' | 'Congé sans solde' | 'Événement familial';
export type TypeContrat = 'CDI' | 'CDD';

export const CODES: { code: CodePointage; libelle: string; couleur: string; print: string }[] = [
  { code: 'P',   libelle: 'On base',              couleur: 'bg-primary/15 text-primary',        print: '#e2efe8' },
  { code: 'IZ',  libelle: 'On chantier',          couleur: 'bg-teal-100 text-teal-800',         print: '#d5ece8' },
  { code: 'CR',  libelle: 'Congé de récupération',couleur: 'bg-muted text-muted-foreground',    print: '#ececec' },
  { code: 'CA',  libelle: 'Congé annuel',         couleur: 'bg-amber-100 text-amber-800',       print: '#fdeeca' },
  { code: 'CE',  libelle: 'Congé exceptionnel',   couleur: 'bg-violet-100 text-violet-800',     print: '#e9e0f5' },
  { code: 'M',   libelle: 'Maladie',              couleur: 'bg-sky-100 text-sky-800',           print: '#dcecf7' },
  { code: 'A',   libelle: 'Absence',              couleur: 'bg-destructive/15 text-destructive',print: '#f6dcd6' },
  { code: 'S',   libelle: 'Suspension',           couleur: 'bg-orange-100 text-orange-800',     print: '#fbe3cf' },
  { code: 'CSS', libelle: 'Congé sans solde',     couleur: 'bg-stone-200 text-stone-700',       print: '#e4e0da' },
  { code: 'MAP', libelle: 'Mise à pied',          couleur: 'bg-rose-200 text-rose-900',         print: '#f5cfd4' },
];
export const CODES_TRAVAILLES: CodePointage[] = ['P', 'IZ'];

export interface Societe {
  id: number; nom: string; type: 'Principale' | 'Sous-traitance';
  formeJuridique: string; contact: string; telephone: string; email: string;
  adresse: string; wilaya: string;
  nif: string; nis: string; registreCommerce: string; articleImposition: string; numCnasEmployeur: string;
  objetPrestation: string; contratReference: string; contratDebut: string; contratFin: string;
}
export interface Service { id: number; nom: string; code: string; wilaya: string; description: string; }
export interface Chantier {
  id: number; nom: string; serviceId: number; code: string; lieu: string; wilaya: string;
  client: string; dateOuverture: string; dateFermeture: string; actif: boolean;
}
export interface CompteChef {
  id: number; nom: string; email: string; motDePasse: string; serviceId: number;
  chantierId: number | null; // renseigné pour chef de chantier / superviseur
  role: RoleCompte; doitChangerMdp: boolean;
}
export interface Envoi {
  id: number; canal: 'email' | 'whatsapp'; destinataire: string; contact: string;
  sujet: string; message: string; date: string; lien: string;
  statut?: string; erreur?: string | null;
}
export interface Rotation { id: number; nom: string; joursTravail: number; joursRepos: number; }

export interface Employe {
  id: number; prenom: string; nom: string; poste: string;
  societeId: number; serviceId: number; chantierId: number | null; categorie: Categorie;
  rotationId: number | null; debutCycle: string;
  email: string; telephone: string; dateEmbauche: string; soldeConges: number;
  typeContrat: TypeContrat; finContrat: string;            // fin de contrat pour CDD (ISO)
  prochaineVisiteMedicale: string;                          // date de la prochaine visite (ISO)
}

export interface LignePointage { employeId: number; jours: CodePointage[]; heuresSupp: number; }
export interface Feuille {
  id: number; version: number; serviceId: number; chantierId: number | null; mois: string; // null = personnel administratif du service
  lignes: LignePointage[]; statut: StatutFeuille;
  preparePar: string; valideServiceLe?: string; valideRHLe?: string;
}

export interface Conge {
  id: number; employeId: number; type: TypeConge; debut: string; fin: string;
  jours: number; statut: StatutConge; motif: string;
  justificatifReference: string; adressePendantConge: string;
  observationDecision: string; decidePar: string;
}

export interface Notification { id: number; pour: 'rh' | 'direction' | number; texte: string; date: string; lue: boolean; }
export type Role = { type: 'rh' } | { type: 'direction' } | { type: 'chef'; compteId: number };

// ===== Données de démonstration =====



export const EMAIL_RH = 'rh@aifg.dz';
export const EMAIL_DIRECTION = 'direction@aifg.dz';





// ===== Utilitaires =====
export const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function libelleMois(mois: string): string {
  const [a, m] = mois.split('-').map(Number);
  return `${MOIS_FR[m - 1]} ${a}`;
}
export function nbJoursMois(mois: string): number {
  const [a, m] = mois.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}
export function initiales(e: { prenom: string; nom: string }): string {
  return ((e.prenom[0] ?? '') + (e.nom[0] ?? '')).toUpperCase();
}
export function joursOuvres(debut: string, fin: string): number {
  const d = new Date(debut + 'T00:00:00'); const f = new Date(fin + 'T00:00:00');
  if (isNaN(d.getTime()) || isNaN(f.getTime()) || f < d) return 0;
  let n = 0; const cur = new Date(d);
  while (cur <= f) { const j = cur.getDay(); if (j !== 5 && j !== 6) n++; cur.setDate(cur.getDate() + 1); }
  return n;
}
export function joursRestants(iso: string): number {
  if (!iso) return Infinity;
  const cible = new Date(iso + 'T00:00:00');
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  return Math.round((cible.getTime() - auj.getTime()) / 86400000);
}

/** Code théorique d'un jour : rotation (chantier) ou week-end vendredi/samedi (administratif). */
export function codeTheorique(e: Employe, rotations: Rotation[], dateISO: string): CodePointage {
  const d = new Date(dateISO + 'T00:00:00');
  if (e.categorie === 'Administratif' || !e.rotationId || !e.debutCycle) {
    const j = d.getDay();
    return j === 5 || j === 6 ? 'CR' : 'P';
  }
  const rot = rotations.find((r) => r.id === e.rotationId);
  if (!rot) return 'IZ';
  const debut = new Date(e.debutCycle + 'T00:00:00');
  const diff = Math.floor((d.getTime() - debut.getTime()) / 86400000);
  const cycle = rot.joursTravail + rot.joursRepos;
  const pos = ((diff % cycle) + cycle) % cycle;
  return pos < rot.joursTravail ? 'IZ' : 'CR';
}

export function prochainCode(c: CodePointage): CodePointage {
  const ordre = CODES.map((x) => x.code);
  return ordre[(ordre.indexOf(c) + 1) % ordre.length];
}


// ===== Messagerie (WhatsApp / e-mail) =====
/** Convertit un numéro algérien (05xx/06xx/07xx...) au format international 213… pour wa.me */
export function telVersWa(tel: string): string {
  const chiffres = (tel || '').replace(/\D/g, '');
  if (!chiffres) return '';
  if (chiffres.startsWith('213')) return chiffres;
  if (chiffres.startsWith('0')) return '213' + chiffres.slice(1);
  return '213' + chiffres;
}
export function lienWhatsApp(tel: string, message: string): string {
  const n = telVersWa(tel);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : '';
}
export function lienEmail(dest: string, sujet: string, corps: string): string {
  return `mailto:${dest}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}

// ===== Listes de référence (droit et administration algériens) =====
export const SITUATIONS_FAMILIALES: SituationFamiliale[] = ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf/Veuve'];
export const GROUPES_SANGUINS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const FORMES_JURIDIQUES = ['SARL', 'EURL', 'SPA', 'SNC', 'ETS', 'Autre'];

/** Les 58 wilayas (découpage administratif en vigueur). */
export const WILAYAS = [
  'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa', 'Biskra', 'Béchar',
  'Blida', 'Bouira', 'Tamanrasset', 'Tébessa', 'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger',
  'Djelfa', 'Jijel', 'Sétif', 'Saïda', 'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma',
  'Constantine', 'Médéa', 'Mostaganem', "M'Sila", 'Mascara', 'Ouargla', 'Oran', 'El Bayadh',
  'Illizi', 'Bordj Bou Arreridj', 'Boumerdès', 'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued',
  'Khenchela', 'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent',
  'Ghardaïa', 'Relizane', 'Timimoun', 'Bordj Badji Mokhtar', 'Ouled Djellal', 'Béni Abbès',
  'In Salah', 'In Guezzam', 'Touggourt', 'Djanet', 'El Meniaa', 'El Menia',
];
