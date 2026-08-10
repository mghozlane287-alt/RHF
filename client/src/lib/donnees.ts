import { useCallback, useEffect, useState } from 'react';
import { api, ErreurApi, telechargerBlob } from '@/lib/api';
import type { CompteSession } from '@/lib/api';
import type { Chantier, CompteChef, Conge, Employe, Envoi, Feuille, Notification, Rotation, Service, Societe, CodePointage, RoleCompte, StatutConge, StatutFeuille, TypeConge } from '@/data';

// ===== Conversion API (snake_case) → types du frontend (camelCase) =====
const jour = (v: string | null) => (v ? String(v).slice(0, 10) : '');

const ROLE_VERS_LIBELLE: Record<string, RoleCompte> = {
  chef_service: 'Chef de service', chef_chantier: 'Chef de chantier', superviseur: 'Superviseur',
};
export const LIBELLE_VERS_ROLE: Record<RoleCompte, string> = {
  'Chef de service': 'chef_service', 'Chef de chantier': 'chef_chantier', 'Superviseur': 'superviseur',
};

export function useDonnees(session: CompteSession | null, onErreur: (m: string) => void) {
  const [societes, setSocietes] = useState<Societe[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [rotations, setRotations] = useState<Rotation[]>([]);
  const [comptes, setComptes] = useState<CompteChef[]>([]);
  const [employes, setEmployes] = useState<Employe[]>([]);
  const [feuilles, setFeuilles] = useState<Feuille[]>([]);
  const [conges, setConges] = useState<Conge[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [envois, setEnvois] = useState<Envoi[]>([]);
  const [chargement, setChargement] = useState(true);

  const gerer = useCallback(async <T,>(p: Promise<T>): Promise<T | null> => {
    try { return await p; }
    catch (e) { onErreur(e instanceof ErreurApi ? e.message : 'Une erreur est survenue.'); return null; }
  }, [onErreur]);

  const recharger = useCallback(async () => {
    if (!session) return;
    setChargement(true);
    try {
      const [ref, emp, feu, cg, notif] = await Promise.all([
        api.referentiel(), api.employes({ inclureSortis: true }), api.feuilles(), api.conges(), api.notifications(),
      ]);
      setSocietes(ref.societes.map((s) => ({
        id: s.id, nom: s.nom, type: s.type, formeJuridique: s.forme_juridique ?? '',
        contact: s.contact, telephone: s.telephone, email: s.email ?? '',
        adresse: s.adresse ?? '', wilaya: s.wilaya ?? '', nif: s.nif, nis: s.nis ?? '',
        registreCommerce: s.registre_commerce ?? '', articleImposition: s.article_imposition ?? '',
        numCnasEmployeur: s.num_cnas_employeur ?? '', objetPrestation: s.objet_prestation ?? '',
        contratReference: s.contrat_reference ?? '', contratDebut: jour(s.contrat_debut),
        contratFin: jour(s.contrat_fin),
      })));
      setServices(ref.services.map((s) => ({
        id: s.id, nom: s.nom, code: s.code ?? '', wilaya: s.wilaya ?? '', description: s.description ?? '',
      })));
      setChantiers(ref.chantiers.map((c) => ({
        id: c.id, nom: c.nom, serviceId: c.service_id, code: c.code ?? '', lieu: c.lieu,
        wilaya: c.wilaya ?? '', client: c.client ?? '',
        dateOuverture: jour(c.date_ouverture), dateFermeture: jour(c.date_fermeture),
        actif: c.actif ?? true,
      })));
      setRotations(ref.rotations.map((r) => ({ id: r.id, nom: r.nom, joursTravail: r.jours_travail, joursRepos: r.jours_repos })));
      setEmployes(emp.employes.map((e) => ({
        id: e.id, prenom: e.prenom, nom: e.nom, poste: e.poste,
        societeId: e.societe_id, serviceId: e.service_id, chantierId: e.chantier_id,
        categorie: e.categorie, rotationId: e.rotation_id, debutCycle: jour(e.debut_cycle),
        email: e.email, telephone: e.telephone, dateEmbauche: jour(e.date_embauche),
        soldeConges: Number(e.solde_conges), typeContrat: e.type_contrat,
        finContrat: jour(e.fin_contrat), prochaineVisiteMedicale: jour(e.prochaine_visite_medicale),
        matricule: e.matricule ?? '', dateNaissance: jour(e.date_naissance),
        lieuNaissance: e.lieu_naissance ?? '', sexe: e.sexe ?? 'M',
        numIdentite: e.num_identite ?? '', numCnas: e.num_cnas ?? '',
        situationFamiliale: e.situation_familiale ?? 'Célibataire',
        enfantsACharge: e.enfants_a_charge ?? 0, groupeSanguin: e.groupe_sanguin ?? '',
        adresse: e.adresse ?? '', wilayaResidence: e.wilaya_residence ?? '',
        urgenceNom: e.urgence_nom ?? '', urgenceLien: e.urgence_lien ?? '',
        urgenceTelephone: e.urgence_telephone ?? '',
        salaireBase: Number(e.salaire_base ?? 0),
        categorieConventionnelle: e.categorie_conventionnelle ?? '', rib: e.rib ?? '',
        niveauQualification: e.niveau_qualification ?? '',
        finPeriodeEssai: jour(e.fin_periode_essai), observations: e.observations ?? '',
        actif: e.actif ?? true, dateSortie: jour(e.date_sortie), motifSortie: e.motif_sortie ?? '',
      })));
      setFeuilles(feu.map((f) => ({
        id: f.id, version: f.version, serviceId: f.service_id, chantierId: f.chantier_id, mois: f.mois,
        statut: f.statut as StatutFeuille, preparePar: f.prepare_par,
        valideServiceLe: jour(f.valide_service_le) || undefined,
        valideRHLe: jour(f.valide_rh_le) || undefined,
        lignes: f.lignes.map((l) => ({ employeId: l.employe_id, jours: l.jours as CodePointage[], heuresSupp: Number(l.heures_supp) })),
      })));
      setConges(cg.map((c) => ({
        id: c.id, employeId: c.employe_id, type: c.type as TypeConge,
        debut: jour(c.debut), fin: jour(c.fin), jours: c.jours,
        statut: c.statut as StatutConge, motif: c.motif,
        justificatifReference: c.justificatif_reference ?? '',
        adressePendantConge: c.adresse_pendant_conge ?? '',
        observationDecision: c.observation_decision ?? '', decidePar: c.decide_par ?? '',
      })));
      setNotifications(notif.map((n) => ({ id: n.id, pour: 'rh', texte: n.texte, date: jour(n.date), lue: n.lue })));

      if (session.role === 'rh' || session.role === 'direction') {
        const cpt = await api.comptes();
        setComptes(cpt.filter((c) => c.actif && ROLE_VERS_LIBELLE[c.role]).map((c) => ({
          id: c.id, nom: c.nom, email: c.email, motDePasse: '',
          serviceId: c.service_id ?? 0, chantierId: c.chantier_id,
          telephone: c.telephone ?? '', fonction: c.fonction ?? '',
          role: ROLE_VERS_LIBELLE[c.role], doitChangerMdp: c.doit_changer_mdp,
        })));
      }
      if (session.role === 'rh') setEnvois((await api.envois()).map((e) => ({
        id: e.id, canal: e.canal, destinataire: e.destinataire, contact: e.contact,
        sujet: e.sujet, message: e.message, date: jour(e.date), lien: e.lien,
        statut: e.statut, erreur: e.erreur,
      })) as Envoi[]);
    } catch (e) {
      onErreur(e instanceof ErreurApi ? e.message : 'Chargement impossible.');
    } finally { setChargement(false); }
  }, [session, onErreur]);

  useEffect(() => { recharger(); }, [recharger]);

  const apres = async <T,>(p: Promise<T>) => { const r = await gerer(p); if (r !== null) await recharger(); return r; };

  const actions = {
    recharger,
    // Sociétés
    creerSociete: (d: unknown) => apres(api.creerSociete(d)),
    modifierSociete: (id: number, d: unknown) => apres(api.modifierSociete(id, d)),
    supprimerSociete: (id: number) => apres(api.supprimerSociete(id)),
    // Services
    creerService: (d: unknown) => apres(api.creerService(d)),
    modifierService: (id: number, d: unknown) => apres(api.modifierService(id, d)),
    supprimerService: (id: number) => apres(api.supprimerService(id)),
    // Chantiers
    creerChantier: (d: unknown) => apres(api.creerChantier(d)),
    modifierChantier: (id: number, d: unknown) => apres(api.modifierChantier(id, d)),
    supprimerChantier: (id: number) => apres(api.supprimerChantier(id)),
    // Rotations
    creerRotation: (d: unknown) => apres(api.creerRotation(d)),
    modifierRotation: (id: number, d: unknown) => apres(api.modifierRotation(id, d)),
    supprimerRotation: (id: number) => apres(api.supprimerRotation(id)),
    // Comptes
    creerCompte: (d: unknown) => apres(api.creerCompte(d)),
    modifierCompte: (id: number, d: unknown) => apres(api.modifierCompte(id, d)),
    supprimerCompte: (id: number) => apres(api.supprimerCompte(id)),
    // Employés
    creerEmploye: (d: unknown) => apres(api.creerEmploye(d)),
    modifierEmploye: (id: number, d: unknown) => apres(api.modifierEmploye(id, d)),
    sortirEffectif: (id: number, motif: string, dateSortie: string) => apres(api.sortirEffectif(id, motif, dateSortie)),
    reintegrerEmploye: (id: number) => apres(api.reintegrerEmploye(id)),
    importerEmployes: async (f: File) => { const r = await gerer(api.importerEmployes(f)); if (r) await recharger(); return r; },
    exporterEmployes: async () => { const b = await gerer(api.exporterEmployes()); if (b) telechargerBlob(b, 'employes_aifg.xlsx'); },
    // Feuilles
    creerFeuille: (s: number, c: number | null, m: string) => apres(api.creerFeuille(s, c, m)),
    enregistrerLignes: (id: number, lignes: { employeId: number; jours: string[]; heuresSupp: number }[], version?: number) =>
      apres(api.enregistrerLignes(id, lignes, version)),
    changerStatutFeuille: (id: number, statut: string) => apres(api.changerStatutFeuille(id, statut)),
    exporterPaie: async (id: number, nom: string) => { const b = await gerer(api.exporterPaie(id)); if (b) telechargerBlob(b, nom); },
    // Congés
    creerConge: (d: unknown) => apres(api.creerConge(d)),
    deciderConge: (id: number, d: 'valider' | 'refuser', observation?: string) => apres(api.deciderConge(id, d, observation)),
    // Divers
    rappel: (employeId: number, type: 'visite' | 'contrat') => apres(api.rappel(employeId, type)),
    marquerNotificationsLues: async () => { await gerer(api.marquerNotificationsLues()); await recharger(); },
  };

  return {
    societes, services, chantiers, rotations, comptes, employes, feuilles, conges,
    notifications, envois, chargement, actions,
  };
}

export type Actions = ReturnType<typeof useDonnees>['actions'];
