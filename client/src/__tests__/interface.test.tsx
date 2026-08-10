import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import React from 'react';
import Dashboard from '@/views/Dashboard';
import Suivi from '@/views/Suivi';
import Organigramme from '@/views/Organigramme';
import Envois from '@/views/Envois';
import Login from '@/views/Login';
import type { Chantier, Conge, Employe, Feuille, Service, Societe, CompteChef, Envoi } from '@/data';

afterEach(cleanup);

const socVide = {
  formeJuridique: '', contact: '', telephone: '', email: '', adresse: '', wilaya: '',
  nif: '', nis: '', registreCommerce: '', articleImposition: '', numCnasEmployeur: '',
  objetPrestation: '', contratReference: '', contratDebut: '', contratFin: '',
};
const societes: Societe[] = [
  { id: 1, nom: 'AIFG', type: 'Principale', ...socVide },
  { id: 2, nom: 'SARL Sahara', type: 'Sous-traitance', ...socVide },
];
const services: Service[] = [
  { id: 1, nom: 'Administration', code: 'ADM', wilaya: 'Ouargla', description: '' },
  { id: 2, nom: 'Forage Nord', code: 'FN', wilaya: 'Ouargla', description: '' },
];
const chantiers: Chantier[] = [{ id: 1, nom: 'Puits HBK-12', serviceId: 2, code: 'HBK12', lieu: 'Hassi Berkine', wilaya: 'Ouargla', client: 'SONATRACH', dateOuverture: '', dateFermeture: '', actif: true }];

const employe = (o: Partial<Employe>): Employe => ({
  id: 1, prenom: 'Riad', nom: 'Belkacem', poste: 'Foreur',
  societeId: 2, serviceId: 2, chantierId: 1, categorie: 'Chantier',
  rotationId: null, debutCycle: '', email: '', telephone: '0556 41 52 63',
  dateEmbauche: '2020-01-01', soldeConges: 10, typeContrat: 'CDI',
  finContrat: '', prochaineVisiteMedicale: '',
  matricule: 'AIFG-0001', dateNaissance: '', lieuNaissance: '', sexe: 'M',
  numIdentite: '', numCnas: '', situationFamiliale: 'Célibataire',
  enfantsACharge: 0, groupeSanguin: '', adresse: '', wilayaResidence: '',
  urgenceNom: '', urgenceLien: '', urgenceTelephone: '',
  salaireBase: 0, categorieConventionnelle: '', rib: '',
  niveauQualification: '', finPeriodeEssai: '', observations: '', ...o,
});

describe('Interface — accessibilité de l’écran de connexion', () => {
  it('les champs ont des libellés associés et le bouton est accessible au clavier', () => {
    render(React.createElement(Login, { onConnexion: vi.fn() }));
    expect(screen.getByLabelText('Adresse e-mail')).toBeTruthy();
    expect(screen.getByLabelText('Mot de passe')).toBeTruthy();
    const bouton = screen.getByRole('button', { name: /se connecter/i });
    expect(bouton).toBeTruthy();
    expect((bouton as HTMLButtonElement).disabled).toBe(false);
  });

  it('les champs utilisent les bons types (clavier adapté sur téléphone, gestionnaire de mots de passe)', () => {
    render(React.createElement(Login, { onConnexion: vi.fn() }));
    expect(screen.getByLabelText('Adresse e-mail').getAttribute('type')).toBe('email');
    expect(screen.getByLabelText('Mot de passe').getAttribute('type')).toBe('password');
    expect(screen.getByLabelText('Adresse e-mail').getAttribute('autocomplete')).toBe('username');
  });

  it('n’affiche plus les mots de passe de démonstration', () => {
    render(React.createElement(Login, { onConnexion: vi.fn() }));
    expect(screen.queryByText(/demo1234|temp2026|rh2026/i)).toBeNull();
  });
});

describe('Interface — le tableau de bord s’adapte au rôle', () => {
  const commun = {
    employes: [employe({}), employe({ id: 2, societeId: 1, categorie: 'Administratif', serviceId: 1, chantierId: null })],
    conges: [] as Conge[], feuilles: [] as Feuille[], societes, services, chantiers,
    allerA: vi.fn(),
  };

  it('le RH voit les indicateurs de pilotage global', () => {
    render(React.createElement(Dashboard, { ...commun, role: 'rh', nomPerimetre: 'Tous services' }));
    expect(screen.getByText('Effectif total')).toBeTruthy();
    expect(screen.getByText('Sociétés de sous-traitance')).toBeTruthy();
    expect(screen.getByText('Pointages chez RH')).toBeTruthy();
  });

  it('le chef de chantier voit SES indicateurs, pas ceux du RH', () => {
    render(React.createElement(Dashboard, { ...commun, role: 'chef_chantier', nomPerimetre: 'Puits HBK-12' }));
    expect(screen.getByText('Mon effectif')).toBeTruthy();
    expect(screen.getByText('Puits HBK-12')).toBeTruthy();
    expect(screen.queryByText('Sociétés de sous-traitance')).toBeNull();
    expect(screen.queryByText('Alertes RH')).toBeNull();
  });

  it('affiche un état vide explicite au lieu d’une zone blanche', () => {
    render(React.createElement(Dashboard, { ...commun, role: 'rh', nomPerimetre: '' }));
    expect(screen.getByText(/aucune demande de congé/i)).toBeTruthy();
  });

  it('les indicateurs sont des boutons cliquables (navigation au clavier possible)', () => {
    render(React.createElement(Dashboard, { ...commun, role: 'rh', nomPerimetre: '' }));
    const boutons = screen.getAllByRole('button');
    expect(boutons.length).toBeGreaterThanOrEqual(4);
  });
});

describe('Interface — suivi des alertes', () => {
  const base = { societes, services, monServiceId: null, rappeler: vi.fn(), peutNotifier: true };

  it('n’affiche le bouton WhatsApp que pour les alertes réellement urgentes', () => {
    const proche = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const lointain = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10);
    render(React.createElement(Suivi, {
      ...base,
      employes: [
        employe({ id: 1, nom: 'Urgent', typeContrat: 'CDD', finContrat: proche }),
        employe({ id: 2, nom: 'Lointain', typeContrat: 'CDD', finContrat: lointain }),
      ],
    }));
    expect(screen.getAllByRole('button', { name: /whatsapp/i }).length).toBe(1);
  });

  it('masque les boutons d’action pour un utilisateur sans droit de notifier', () => {
    const proche = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    render(React.createElement(Suivi, {
      ...base, peutNotifier: false,
      employes: [employe({ typeContrat: 'CDD', finContrat: proche })],
    }));
    expect(screen.queryByRole('button', { name: /whatsapp/i })).toBeNull();
  });

  it('affiche un état vide utile quand il n’y a rien à surveiller', () => {
    render(React.createElement(Suivi, { ...base, employes: [employe({ typeContrat: 'CDI', prochaineVisiteMedicale: '' })] }));
    expect(screen.getByText(/aucun cdd à suivre/i)).toBeTruthy();
    expect(screen.getByText(/aucune visite médicale planifiée/i)).toBeTruthy();
  });
});

describe('Interface — organigramme', () => {
  const comptes: CompteChef[] = [
    { id: 1, nom: 'Yacine Bouzid', email: 'y@a.dz', motDePasse: '', serviceId: 2, chantierId: null,
      telephone: '', fonction: '', role: 'Chef de service', doitChangerMdp: false },
  ];

  it('signale visiblement un chantier sans responsable désigné', () => {
    render(React.createElement(Organigramme, {
      services, chantiers, comptes, societes,
      employes: [employe({})],
    }));
    expect(screen.getByText(/chef de chantier \/ superviseur à désigner/i)).toBeTruthy();
  });

  it('signale un service sans compte responsable', () => {
    render(React.createElement(Organigramme, {
      services, chantiers, comptes: [], societes, employes: [employe({})],
    }));
    expect(screen.getAllByText(/compte à créer/i).length).toBeGreaterThan(0);
  });

  it('distingue les effectifs AIFG et sous-traitance à chaque niveau', () => {
    render(React.createElement(Organigramme, {
      services, chantiers, comptes, societes,
      employes: [employe({ id: 1, societeId: 1 }), employe({ id: 2, societeId: 2 })],
    }));
    expect(screen.getAllByText(/AIFG ·.*sous-traitance/i).length).toBeGreaterThan(0);
  });
});

describe('Interface — journal des envois', () => {
  const envoi = (o: Partial<Envoi>): Envoi => ({
    id: 1, canal: 'whatsapp', destinataire: 'Riad Belkacem', contact: '0556415263',
    sujet: 'Congé approuvé', message: 'Bonjour', date: '2026-08-01',
    lien: 'https://wa.me/213556415263?text=x', ...o,
  });

  it('affiche clairement le statut d’envoi (envoyé, échec, à ouvrir)', () => {
    render(React.createElement(Envois, {
      envois: [
        envoi({ id: 1, statut: 'envoye' }),
        envoi({ id: 2, statut: 'echec', erreur: 'Numéro invalide' }),
        envoi({ id: 3, statut: 'lien' }),
      ],
    }));
    expect(screen.getByText('Envoyé')).toBeTruthy();
    expect(screen.getByText('Échec')).toBeTruthy();
    expect(screen.getByText('À ouvrir')).toBeTruthy();
    expect(screen.getByText(/numéro invalide/i)).toBeTruthy();
  });

  it('les liens externes s’ouvrent en sécurité (noopener)', () => {
    render(React.createElement(Envois, { envois: [envoi({ statut: 'lien' })] }));
    const lien = screen.getByRole('link', { name: /ouvrir dans whatsapp/i });
    expect(lien.getAttribute('rel')).toContain('noopener');
    expect(lien.getAttribute('target')).toBe('_blank');
  });

  it('affiche un état vide plutôt qu’une page blanche', () => {
    render(React.createElement(Envois, { envois: [] }));
    expect(screen.getByText(/aucun envoi pour le moment/i)).toBeTruthy();
  });
});
