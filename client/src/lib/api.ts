/**
 * Client de l'API Registre RH.
 * Le jeton JWT est conservé en mémoire (pas de localStorage : il serait
 * lisible par tout script injecté). Il est perdu au rechargement de page,
 * ce qui impose une reconnexion — comportement volontaire et plus sûr.
 */
const BASE = (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL || '/api';

let jeton: string | null = null;
export const definirJeton = (t: string | null) => { jeton = t; };
export const jetonActuel = () => jeton;

export class ErreurApi extends Error {
  statut: number;
  constructor(statut: number, message: string) { super(message); this.statut = statut; }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function appel<T>(chemin: string, options: RequestInit = {}, essai = 0): Promise<T> {
  const entetes: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (!(options.body instanceof FormData)) entetes['Content-Type'] = 'application/json';
  if (jeton) entetes['Authorization'] = `Bearer ${jeton}`;

  // Délai maximal : sur une liaison satellite de chantier, une requête peut traîner
  // indéfiniment ; mieux vaut échouer proprement et réessayer.
  const minuteur = new AbortController();
  const delai = setTimeout(() => minuteur.abort(), 30000);

  let rep: Response;
  try {
    rep = await fetch(`${BASE}${chemin}`, {
      ...options, headers: entetes, credentials: 'include', signal: minuteur.signal,
    });
  } catch {
    clearTimeout(delai);
    // Réessai automatique (2 fois) sur coupure réseau, uniquement pour les lectures :
    // rejouer une écriture pourrait la dupliquer.
    const estLecture = !options.method || options.method === 'GET';
    if (estLecture && essai < 2) { await attendre(1000 * (essai + 1)); return appel<T>(chemin, options, essai + 1); }
    throw new ErreurApi(0, "Serveur injoignable. Vérifiez votre connexion, puis réessayez.");
  } finally { clearTimeout(delai); }

  if (rep.status === 204) return undefined as T;

  const type = rep.headers.get('content-type') || '';
  if (type.includes('spreadsheetml')) return (await rep.blob()) as unknown as T;

  const corps = type.includes('application/json') ? await rep.json() : {};

  // Jeton expiré : on tente une seule fois de renouveler la session via le cookie httpOnly.
  if (rep.status === 401 && !chemin.startsWith('/auth/') && essai === 0) {
    const renouvele = await rafraichirSession();
    if (renouvele) return appel<T>(chemin, options, essai + 1);
  }

  if (!rep.ok) throw new ErreurApi(rep.status, corps.erreur || `Erreur ${rep.status}.`);
  return corps as T;
}

/** Renouvelle la session à partir du cookie httpOnly (rechargement de page, jeton expiré). */
export async function rafraichirSession(): Promise<CompteSession | null> {
  try {
    const rep = await fetch(`${BASE}/auth/rafraichir`, { method: 'POST', credentials: 'include' });
    if (!rep.ok) return null;
    const d = await rep.json();
    definirJeton(d.token);
    return d.compte as CompteSession;
  } catch { return null; }
}

export const api = {
  // --- Authentification ---
  connexion: (email: string, motDePasse: string) =>
    appel<{ token: string; compte: CompteSession }>('/auth/connexion', {
      method: 'POST', body: JSON.stringify({ email, motDePasse }),
    }),
  changerMotDePasse: (ancien: string, nouveau: string) =>
    appel<{ ok: true }>('/auth/changer-mot-de-passe', { method: 'POST', body: JSON.stringify({ ancien, nouveau }) }),
  moi: () => appel<CompteSession>('/auth/moi'),
  deconnexion: () => appel('/auth/deconnexion', { method: 'POST' }),

  // --- Référentiel ---
  referentiel: () => appel<Referentiel>('/referentiel'),
  creerSociete: (d: unknown) => appel('/societes', { method: 'POST', body: JSON.stringify(d) }),
  modifierSociete: (id: number, d: unknown) => appel(`/societes/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  supprimerSociete: (id: number) => appel(`/societes/${id}`, { method: 'DELETE' }),
  creerService: (d: unknown) => appel('/services', { method: 'POST', body: JSON.stringify(d) }),
  modifierService: (id: number, d: unknown) => appel(`/services/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  supprimerService: (id: number) => appel(`/services/${id}`, { method: 'DELETE' }),
  creerChantier: (d: unknown) => appel('/chantiers', { method: 'POST', body: JSON.stringify(d) }),
  modifierChantier: (id: number, d: unknown) => appel(`/chantiers/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  supprimerChantier: (id: number) => appel(`/chantiers/${id}`, { method: 'DELETE' }),
  creerRotation: (d: unknown) => appel('/rotations', { method: 'POST', body: JSON.stringify(d) }),
  modifierRotation: (id: number, d: unknown) => appel(`/rotations/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  supprimerRotation: (id: number) => appel(`/rotations/${id}`, { method: 'DELETE' }),

  // --- Comptes ---
  comptes: () => appel<CompteApi[]>('/comptes'),
  creerCompte: (d: unknown) => appel<CompteApi>('/comptes', { method: 'POST', body: JSON.stringify(d) }),
  modifierCompte: (id: number, d: unknown) => appel<CompteApi>(`/comptes/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  supprimerCompte: (id: number) => appel(`/comptes/${id}`, { method: 'DELETE' }),

  // --- Employés ---
  employes: (params?: { recherche?: string; societeId?: number; page?: number; limite?: number; inclureSortis?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.recherche) qs.set('recherche', params.recherche);
    if (params?.societeId) qs.set('societeId', String(params.societeId));
    if (params?.page) qs.set('page', String(params.page));
    if (params?.inclureSortis) qs.set('inclureSortis', '1');
    qs.set('limite', String(params?.limite ?? 1000));
    return appel<{ employes: EmployeApi[]; total: number; page: number; limite: number }>(`/employes?${qs}`);
  },
  creerEmploye: (d: unknown) => appel<EmployeApi>('/employes', { method: 'POST', body: JSON.stringify(d) }),
  modifierEmploye: (id: number, d: unknown) => appel<EmployeApi>(`/employes/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  sortirEffectif: (id: number, motif: string, dateSortie: string) =>
    appel<{ ok: true; mode: string; historiqueConserve?: { pointages: number; conges: number } }>(
      `/employes/${id}`, { method: 'DELETE', body: JSON.stringify({ motif, dateSortie }) }),
  reintegrerEmploye: (id: number) => appel(`/employes/${id}/reintegrer`, { method: 'POST' }),
  importerEmployes: (fichier: File) => {
    const fd = new FormData(); fd.append('fichier', fichier);
    return appel<RapportImport>('/employes/import', { method: 'POST', body: fd });
  },
  exporterEmployes: () => appel<Blob>('/employes/export.xlsx'),

  // --- Feuilles de pointage ---
  feuilles: () => appel<FeuilleApi[]>('/feuilles'),
  creerFeuille: (serviceId: number, chantierId: number | null, mois: string) =>
    appel<FeuilleApi>('/feuilles', { method: 'POST', body: JSON.stringify({ serviceId, chantierId, mois }) }),
  enregistrerLignes: (id: number, lignes: { employeId: number; jours: string[]; heuresSupp: number }[], version?: number) =>
    appel<FeuilleApi>(`/feuilles/${id}/lignes`, { method: 'PUT', body: JSON.stringify({ lignes, version }) }),
  changerStatutFeuille: (id: number, statut: string) =>
    appel<FeuilleApi>(`/feuilles/${id}/statut`, { method: 'POST', body: JSON.stringify({ statut }) }),
  exporterPaie: (id: number) => appel<Blob>(`/feuilles/${id}/paie.xlsx`),

  // --- Congés ---
  conges: () => appel<CongeApi[]>('/conges'),
  creerConge: (d: unknown) => appel<CongeApi>('/conges', { method: 'POST', body: JSON.stringify(d) }),
  deciderConge: (id: number, decision: 'valider' | 'refuser', observation?: string) =>
    appel<CongeApi>(`/conges/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision, observation }) }),

  // --- Pièces jointes ---
  documents: (p: { employeId?: number; societeId?: number; congeId?: number }) => {
    const qs = new URLSearchParams();
    if (p.employeId) qs.set('employeId', String(p.employeId));
    if (p.societeId) qs.set('societeId', String(p.societeId));
    if (p.congeId) qs.set('congeId', String(p.congeId));
    return appel<DocumentApi[]>(`/documents?${qs}`);
  },
  deposerDocument: (fichier: File, meta: {
    categorie: string; employeId?: number; societeId?: number; congeId?: number;
    dateDocument?: string; dateExpiration?: string; description?: string;
  }) => {
    const fd = new FormData();
    fd.append('fichier', fichier);
    Object.entries(meta).forEach(([k, v]) => { if (v !== undefined && v !== '') fd.append(k, String(v)); });
    return appel<DocumentApi>('/documents', { method: 'POST', body: fd });
  },
  supprimerDocument: (id: number) => appel(`/documents/${id}`, { method: 'DELETE' }),
  documentsExpirants: (jours = 60) => appel<DocumentExpirantApi[]>(`/documents-expirants?jours=${jours}`),

  // --- Cadre légal ---
  parametresLegaux: () => appel<ParametreLegalApi[]>('/parametres'),
  majParametreLegal: (cle: string, valeur: unknown) =>
    appel<ParametreLegalApi>(`/parametres/${encodeURIComponent(cle)}`, { method: 'PUT', body: JSON.stringify({ valeur }) }),
  joursFeries: (annee: number) => appel<FerieApi[]>(`/jours-feries?annee=${annee}`),
  ajouterJourFerie: (date: string, libelle: string) =>
    appel<FerieApi>('/jours-feries', { method: 'POST', body: JSON.stringify({ date, libelle, type: 'Religieux' }) }),
  supprimerJourFerie: (id: number) => appel(`/jours-feries/${id}`, { method: 'DELETE' }),
  typesConge: () => appel<TypeCongeApi[]>('/types-conge'),
  codesPointage: () => appel<CodePointageApi[]>('/codes-pointage'),
  droitsConge: () => appel<{ periode: { debut: string; fin: string }; droits: DroitApi[] }>('/droits-conge'),
  appliquerDroitsConge: () => appel<{ ok: true; appliques: number }>('/droits-conge/appliquer', { method: 'POST' }),
  conformite: () => appel<{ parametres: Record<string, unknown>; controles: ControleApi[] }>('/conformite'),

  // --- Divers ---
  notifications: () => appel<NotificationApi[]>('/notifications'),
  marquerNotificationsLues: () => appel('/notifications/lues', { method: 'POST' }),
  envois: () => appel<EnvoiApi[]>('/envois'),
  rappel: (employeId: number, type: 'visite' | 'contrat') =>
    appel('/rappels', { method: 'POST', body: JSON.stringify({ employeId, type }) }),
  audit: () => appel<AuditApi[]>('/audit'),
};

/**
 * URL d'accès au fichier d'un document.
 * Le jeton est transmis en paramètre car les balises <img> et les liens directs
 * ne peuvent pas porter d'en-tête Authorization. Le serveur l'accepte uniquement
 * sur cette route, et l'accès reste soumis au contrôle de périmètre.
 */
export const urlFichierDocument = (id: number) =>
  `${BASE}/documents/${id}/fichier${jeton ? `?jeton=${encodeURIComponent(jeton)}` : ''}`;

/** Télécharge un Blob renvoyé par l'API. */
export function telechargerBlob(blob: Blob, nomFichier: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomFichier;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ===== Types renvoyés par l'API (colonnes SQL en snake_case) =====
export type RoleApi = 'rh' | 'direction' | 'chef_service' | 'chef_chantier' | 'superviseur';

export interface CompteSession {
  id: number; nom: string; email: string; role: RoleApi;
  serviceId: number | null; chantierId: number | null; doitChangerMdp: boolean;
}
export interface CompteApi {
  id: number; nom: string; email: string; telephone?: string; fonction?: string; role: RoleApi;
  service_id: number | null; chantier_id: number | null; doit_changer_mdp: boolean; actif: boolean;
}
export interface SocieteApi {
  id: number; nom: string; type: 'Principale' | 'Sous-traitance';
  forme_juridique?: string; contact: string; telephone: string; email?: string;
  adresse?: string; wilaya?: string; nif: string; nis?: string;
  registre_commerce?: string; article_imposition?: string; num_cnas_employeur?: string;
  objet_prestation?: string; contrat_reference?: string;
  contrat_debut?: string | null; contrat_fin?: string | null;
}
export interface ServiceApi { id: number; nom: string; code?: string; wilaya?: string; description?: string; }
export interface ChantierApi {
  id: number; nom: string; service_id: number; code?: string; lieu: string; wilaya?: string;
  client?: string; date_ouverture?: string | null; date_fermeture?: string | null; actif?: boolean;
}
export interface RotationApi { id: number; nom: string; jours_travail: number; jours_repos: number; }
export interface Referentiel { societes: SocieteApi[]; services: ServiceApi[]; chantiers: ChantierApi[]; rotations: RotationApi[]; }
export interface EmployeApi {
  id: number; prenom: string; nom: string; poste: string;
  societe_id: number; service_id: number; chantier_id: number | null;
  categorie: 'Chantier' | 'Administratif'; rotation_id: number | null; debut_cycle: string | null;
  email: string; telephone: string; date_embauche: string; solde_conges: string | number;
  type_contrat: 'CDI' | 'CDD'; fin_contrat: string | null; prochaine_visite_medicale: string | null;
  actif?: boolean; date_sortie?: string | null; motif_sortie?: string | null;
  matricule?: string | null; date_naissance?: string | null; lieu_naissance?: string; sexe?: 'M' | 'F';
  num_identite?: string; num_cnas?: string; situation_familiale?: string; enfants_a_charge?: number;
  adresse?: string; wilaya_residence?: string;
  urgence_nom?: string; urgence_lien?: string; urgence_telephone?: string; groupe_sanguin?: string;
  salaire_base?: string | number; categorie_conventionnelle?: string; rib?: string;
  niveau_qualification?: string; fin_periode_essai?: string | null; observations?: string;
}
export interface LigneApi { feuille_id: number; employe_id: number; jours: string[]; heures_supp: string | number; }
export interface FeuilleApi {
  id: number; version: number; service_id: number; chantier_id: number | null; mois: string;
  statut: 'En préparation' | 'Chez le chef de service' | 'Chez RH' | 'Archivée';
  prepare_par: string; valide_service_le: string | null; valide_rh_le: string | null; lignes: LigneApi[];
}
export interface CongeApi {
  id: number; employe_id: number; type: string; debut: string; fin: string;
  jours: number; statut: string; motif: string;
  justificatif_reference?: string; adresse_pendant_conge?: string;
  observation_decision?: string; decide_par?: string;
}
export interface NotificationApi { id: number; cible: string; texte: string; date: string; lue: boolean; }
export interface EnvoiApi {
  id: number; canal: 'email' | 'whatsapp'; destinataire: string; contact: string;
  sujet: string; message: string; statut: string; erreur: string | null; lien: string; date: string;
}
export interface AuditApi {
  id: number; compte_email: string; action: string; ressource: string;
  details: Record<string, unknown>; ip: string; date: string;
}
export interface RapportImport {
  importes: number; societesCreees: string[]; servicesCrees: string[];
  chantiersCrees: string[]; ignores: { ligne: number; raison: string }[];
}


export interface ParametreLegalApi {
  cle: string; valeur: unknown; libelle: string; reference_legale: string;
  modifie_le: string; modifie_par: string;
}
export interface FerieApi { id: number; date: string; libelle: string; type: string; chome_paye: boolean }
export interface TypeCongeApi {
  id: number; libelle: string; code_pointage: string; jours_legaux: number | null;
  decompte_solde: boolean; remunere: boolean; justificatif_requis: boolean; reference_legale: string;
}
export interface CodePointageApi {
  code: string; libelle: string; compte_travaille: boolean;
  couleur: string; couleur_impression: string; ordre: number;
}
export interface DroitApi {
  employeId: number; nom: string; prenom: string; wilaya: string; estSud: boolean;
  moisTravailles: number; joursPrincipal: number; joursSud: number; joursAnciennete: number;
  droitsTotal: number; soldeActuel: number; ecart: number;
}
export interface ControleApi { cle: string; libelle: string; valeur: number; conforme: boolean; message: string }


export interface DocumentApi {
  id: number; categorie: string; nom_original: string; type_mime: string;
  taille_octets: number; empreinte_sha256: string;
  date_document: string | null; date_expiration: string | null;
  description: string; ajoute_par: string; ajoute_le: string;
}
export interface DocumentExpirantApi {
  id: number; categorie: string; nom_original: string; date_expiration: string;
  employe_id: number | null; nom: string | null; prenom: string | null; matricule: string | null;
}
