-- ============================================================
-- Registre RH AIFG — Schéma PostgreSQL
-- ============================================================

CREATE TABLE IF NOT EXISTS societes (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('Principale','Sous-traitance')),
  contact TEXT NOT NULL DEFAULT '',
  telephone TEXT NOT NULL DEFAULT '',
  nif TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS chantiers (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  lieu TEXT NOT NULL DEFAULT '',
  UNIQUE (nom, service_id)
);

CREATE TABLE IF NOT EXISTS rotations (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE,
  jours_travail INTEGER NOT NULL CHECK (jours_travail >= 1),
  jours_repos INTEGER NOT NULL CHECK (jours_repos >= 0)
);

CREATE TABLE IF NOT EXISTS employes (
  id SERIAL PRIMARY KEY,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  poste TEXT NOT NULL DEFAULT '',
  societe_id INTEGER NOT NULL REFERENCES societes(id) ON DELETE RESTRICT,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  chantier_id INTEGER REFERENCES chantiers(id) ON DELETE RESTRICT,
  categorie TEXT NOT NULL CHECK (categorie IN ('Chantier','Administratif')),
  rotation_id INTEGER REFERENCES rotations(id) ON DELETE SET NULL,
  debut_cycle DATE,
  email TEXT NOT NULL DEFAULT '',
  telephone TEXT NOT NULL DEFAULT '',
  date_embauche DATE NOT NULL,
  solde_conges NUMERIC(5,1) NOT NULL DEFAULT 0 CHECK (solde_conges >= 0),
  type_contrat TEXT NOT NULL CHECK (type_contrat IN ('CDI','CDD')),
  fin_contrat DATE,
  prochaine_visite_medicale DATE,
  CONSTRAINT chantier_si_categorie CHECK (
    (categorie = 'Chantier' AND chantier_id IS NOT NULL) OR
    (categorie = 'Administratif' AND chantier_id IS NULL)
  ),
  CONSTRAINT fin_si_cdd CHECK (type_contrat = 'CDI' OR fin_contrat IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_employes_service ON employes(service_id);
CREATE INDEX IF NOT EXISTS idx_employes_chantier ON employes(chantier_id);

CREATE TABLE IF NOT EXISTS comptes (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  mdp_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('rh','direction','chef_service','chef_chantier','superviseur')),
  service_id INTEGER REFERENCES services(id) ON DELETE RESTRICT,
  chantier_id INTEGER REFERENCES chantiers(id) ON DELETE RESTRICT,
  doit_changer_mdp BOOLEAN NOT NULL DEFAULT TRUE,
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  echecs_connexion INTEGER NOT NULL DEFAULT 0,
  verrou_jusqua TIMESTAMPTZ,
  CONSTRAINT portee_role CHECK (
    (role IN ('rh','direction') AND service_id IS NULL AND chantier_id IS NULL) OR
    (role = 'chef_service' AND service_id IS NOT NULL AND chantier_id IS NULL) OR
    (role IN ('chef_chantier','superviseur') AND service_id IS NOT NULL AND chantier_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS feuilles (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  chantier_id INTEGER REFERENCES chantiers(id) ON DELETE RESTRICT,
  mois CHAR(7) NOT NULL CHECK (mois ~ '^[0-9]{4}-[0-9]{2}$'),
  statut TEXT NOT NULL DEFAULT 'En préparation'
    CHECK (statut IN ('En préparation','Chez le chef de service','Chez RH','Archivée')),
  prepare_par TEXT NOT NULL DEFAULT '',
  valide_service_le DATE,
  valide_rh_le DATE,
  version INTEGER NOT NULL DEFAULT 1,
  modifie_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, chantier_id, mois)
);
-- l'unicité NULL de chantier_id (feuille administrative) :
CREATE UNIQUE INDEX IF NOT EXISTS uq_feuille_admin
  ON feuilles(service_id, mois) WHERE chantier_id IS NULL;

CREATE TABLE IF NOT EXISTS lignes_pointage (
  feuille_id INTEGER NOT NULL REFERENCES feuilles(id) ON DELETE CASCADE,
  -- RESTRICT et non CASCADE : l'historique de pointage est une piece justificative
  -- de paie. Un employe qui quitte l'entreprise est desactive, jamais supprime.
  employe_id INTEGER NOT NULL REFERENCES employes(id) ON DELETE RESTRICT,
  jours TEXT[] NOT NULL,
  heures_supp NUMERIC(5,1) NOT NULL DEFAULT 0 CHECK (heures_supp >= 0),
  PRIMARY KEY (feuille_id, employe_id)
);

CREATE TABLE IF NOT EXISTS conges (
  id SERIAL PRIMARY KEY,
  employe_id INTEGER NOT NULL REFERENCES employes(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN (
    'Congé annuel','Congé de récupération','Congé exceptionnel','Congé maladie',
    'Congé maternité','Congé sans solde','Événement familial')),
  debut DATE NOT NULL,
  fin DATE NOT NULL CHECK (fin >= debut),
  jours INTEGER NOT NULL CHECK (jours > 0),
  statut TEXT NOT NULL DEFAULT 'En attente (chef de service)'
    CHECK (statut IN ('En attente (chef de service)','En attente (RH)','Approuvé','Refusé')),
  motif TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  cible TEXT NOT NULL,             -- 'rh' | 'direction' | 'service:<id>'
  texte TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  lue BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_notifications_cible ON notifications(cible, lue);

CREATE TABLE IF NOT EXISTS envois (
  id SERIAL PRIMARY KEY,
  canal TEXT NOT NULL CHECK (canal IN ('email','whatsapp')),
  destinataire TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  sujet TEXT NOT NULL,
  message TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','envoye','echec','lien')),
  erreur TEXT,
  lien TEXT NOT NULL DEFAULT '',
  date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_audit (
  id SERIAL PRIMARY KEY,
  compte_id INTEGER,
  compte_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  ressource TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  date TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_date ON journal_audit(date);

-- Index de performance (ajoutes apres audit)
CREATE INDEX IF NOT EXISTS idx_feuilles_recherche ON feuilles(service_id, mois);
CREATE INDEX IF NOT EXISTS idx_conges_employe ON conges(employe_id, statut);
CREATE INDEX IF NOT EXISTS idx_employes_nom ON employes(lower(nom), lower(prenom));
CREATE INDEX IF NOT EXISTS idx_employes_contrat ON employes(type_contrat, fin_contrat) WHERE type_contrat = 'CDD';
CREATE INDEX IF NOT EXISTS idx_employes_visite ON employes(prochaine_visite_medicale);
CREATE INDEX IF NOT EXISTS idx_envois_date ON envois(date DESC);

-- Migrations idempotentes (colonnes ajoutees apres la premiere mise en service)
ALTER TABLE feuilles ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE feuilles ADD COLUMN IF NOT EXISTS modifie_le TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS derniere_connexion TIMESTAMPTZ;
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS jeton_version INTEGER NOT NULL DEFAULT 1;

-- Sortie d'effectif (remplace la suppression) + fuseau horaire
ALTER TABLE employes ADD COLUMN IF NOT EXISTS actif BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE employes ADD COLUMN IF NOT EXISTS date_sortie DATE;
ALTER TABLE employes ADD COLUMN IF NOT EXISTS motif_sortie TEXT;
CREATE INDEX IF NOT EXISTS idx_employes_actif ON employes(actif) WHERE actif;

-- Correction retroactive des cascades destructrices (bases deja en service)
DO $$
BEGIN
  ALTER TABLE lignes_pointage DROP CONSTRAINT IF EXISTS lignes_pointage_employe_id_fkey;
  ALTER TABLE lignes_pointage ADD CONSTRAINT lignes_pointage_employe_id_fkey
    FOREIGN KEY (employe_id) REFERENCES employes(id) ON DELETE RESTRICT;
  ALTER TABLE conges DROP CONSTRAINT IF EXISTS conges_employe_id_fkey;
  ALTER TABLE conges ADD CONSTRAINT conges_employe_id_fkey
    FOREIGN KEY (employe_id) REFERENCES employes(id) ON DELETE RESTRICT;
END $$;

-- ============================================================
-- CADRE LÉGAL PARAMÉTRABLE (droit algérien — loi 90-11 modifiée)
-- Tout est en base : aucune règle légale n'est figée dans le code.
-- ============================================================

CREATE TABLE IF NOT EXISTS parametres (
  cle TEXT PRIMARY KEY,
  valeur JSONB NOT NULL,
  libelle TEXT NOT NULL DEFAULT '',
  reference_legale TEXT NOT NULL DEFAULT '',
  modifie_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  modifie_par TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS jours_feries (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  libelle TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Civil' CHECK (type IN ('Civil','Religieux')),
  chome_paye BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_feries_date ON jours_feries(date);

CREATE TABLE IF NOT EXISTS types_conge (
  id SERIAL PRIMARY KEY,
  libelle TEXT NOT NULL UNIQUE,
  code_pointage TEXT NOT NULL DEFAULT 'CA',
  jours_legaux INTEGER,                 -- durée fixée par la loi (NULL = libre)
  decompte_solde BOOLEAN NOT NULL DEFAULT TRUE,
  remunere BOOLEAN NOT NULL DEFAULT TRUE,
  justificatif_requis BOOLEAN NOT NULL DEFAULT FALSE,
  reference_legale TEXT NOT NULL DEFAULT '',
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  ordre INTEGER NOT NULL DEFAULT 100
);

-- Wilaya du chantier : détermine le droit au congé supplémentaire Sud (art. 42)
ALTER TABLE chantiers ADD COLUMN IF NOT EXISTS wilaya TEXT NOT NULL DEFAULT '';
ALTER TABLE services  ADD COLUMN IF NOT EXISTS wilaya TEXT NOT NULL DEFAULT '';

-- Période d'essai et suivi des droits à congé
ALTER TABLE employes ADD COLUMN IF NOT EXISTS fin_periode_essai DATE;
ALTER TABLE employes ADD COLUMN IF NOT EXISTS solde_reporte NUMERIC(5,1) NOT NULL DEFAULT 0;
ALTER TABLE employes ADD COLUMN IF NOT EXISTS dernier_calcul_droits DATE;

-- Historique des acquisitions de congé (traçabilité pour l'inspection du travail)
CREATE TABLE IF NOT EXISTS acquisitions_conge (
  id SERIAL PRIMARY KEY,
  employe_id INTEGER NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
  periode_debut DATE NOT NULL,
  periode_fin DATE NOT NULL,
  mois_travailles NUMERIC(4,1) NOT NULL,
  jours_principal NUMERIC(5,1) NOT NULL,
  jours_sud NUMERIC(5,1) NOT NULL DEFAULT 0,
  jours_anciennete NUMERIC(5,1) NOT NULL DEFAULT 0,
  total NUMERIC(5,1) NOT NULL,
  calcule_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employe_id, periode_debut)
);

-- Types de congé conformes au droit algérien (modifiables par le RH)
INSERT INTO types_conge (libelle, code_pointage, jours_legaux, decompte_solde, remunere, justificatif_requis, reference_legale, ordre) VALUES
  ('Congé annuel',              'CA',  NULL, TRUE,  TRUE,  FALSE, 'Art. 39 à 46 loi 90-11', 10),
  ('Congé de récupération',     'CR',  NULL, TRUE,  TRUE,  FALSE, 'Accord d''entreprise', 20),
  ('Congé exceptionnel',        'CE',  3,    FALSE, TRUE,  TRUE,  'Art. 54 loi 90-11 (événements familiaux)', 30),
  ('Congé de maladie',          'M',   NULL, FALSE, TRUE,  TRUE,  'Art. 47 loi 90-11 / CNAS', 40),
  ('Congé de maternité',        'M',   98,   FALSE, TRUE,  TRUE,  'Loi 83-11 (14 semaines)', 50),
  ('Congé sans solde',          'CSS', NULL, FALSE, FALSE, FALSE, 'Accord d''entreprise', 60),
  ('Congé pour pèlerinage',     'CE',  30,   FALSE, FALSE, TRUE,  'Une fois dans la carrière', 70),
  ('Absence autorisée',         'A',   NULL, FALSE, FALSE, TRUE,  'Art. 54 loi 90-11', 80)
ON CONFLICT (libelle) DO NOTHING;

-- Paramètres légaux par défaut (droit algérien en vigueur, modifiables sans redéploiement)
INSERT INTO parametres (cle, valeur, libelle, reference_legale) VALUES
  ('jours_repos_hebdomadaire', '[5,6]', 'Jours de repos hebdomadaire (0=dimanche … 6=samedi)', 'Art. 33 loi 90-11 : vendredi au minimum'),
  ('duree_legale_hebdomadaire', '40', 'Durée légale du travail (heures/semaine)', 'Ordonnance 97-03'),
  ('conge_jours_par_mois', '2.5', 'Jours de congé annuel acquis par mois de travail', 'Art. 41 loi 90-11'),
  ('conge_plafond_annuel', '30', 'Plafond du congé annuel (jours calendaires/an)', 'Art. 41 loi 90-11'),
  ('conge_sud_jours', '10', 'Congé supplémentaire annuel — wilayas du Sud', 'Art. 42 loi 90-11 : 10 jours minimum'),
  ('wilayas_sud', '["Adrar","Tamanrasset","Illizi","Tindouf","Béchar","Ouargla","Ghardaïa","El Oued","Laghouat","Biskra","Djelfa","El Bayadh","Naâma","Timimoun","Bordj Badji Mokhtar","Ouled Djellal","Béni Abbès","In Salah","In Guezzam","Touggourt","Djanet","El Meniaa"]', 'Wilayas ouvrant droit au congé supplémentaire du Sud', 'Art. 42 loi 90-11'),
  ('periode_reference_debut', '"07-01"', 'Début de la période de référence des congés (MM-JJ)', 'Art. 40 loi 90-11 : 1er juillet'),
  ('conge_anciennete', '[]', 'Jours supplémentaires par tranche d''ancienneté (convention collective)', 'Convention collective / accord d''entreprise'),
  ('hs_majoration_pourcent', '50', 'Majoration minimale des heures supplémentaires (%)', 'Art. 32 loi 90-11 : 50 % minimum'),
  ('hs_plafond_pourcent_duree_legale', '20', 'Plafond des heures supplémentaires (% de la durée légale)', 'Art. 31 loi 90-11 : 20 %'),
  ('hs_majoration_repos_pourcent', '75', 'Majoration des heures effectuées un jour de repos hebdomadaire (%)', 'Convention collective (usage secteur)'),
  ('hs_majoration_ferie_pourcent', '100', 'Majoration des heures effectuées un jour férié (%)', 'Convention collective (usage secteur)'),
  ('hs_majoration_nuit_pourcent', '25', 'Majoration du travail de nuit (%)', 'Art. 27-30 loi 90-11'),
  ('periode_essai_mois', '6', 'Durée maximale de la période d''essai (mois)', 'Art. 18 loi 90-11 : 6 mois'),
  ('periode_essai_mois_cadres', '12', 'Période d''essai — postes de haute qualification (mois)', 'Art. 18 loi 90-11 : 12 mois'),
  ('preavis_jours', '30', 'Durée du préavis (jours)', 'Art. 73-3 loi 90-11 / convention collective'),
  ('alerte_fin_contrat_jours', '60', 'Seuil d''alerte avant fin de CDD (jours)', 'Paramètre interne'),
  ('alerte_visite_medicale_jours', '30', 'Seuil d''alerte avant visite médicale (jours)', 'Décret 93-120 (médecine du travail)'),
  ('visite_medicale_periodicite_mois', '12', 'Périodicité de la visite médicale (mois)', 'Décret 93-120 : annuelle, semestrielle pour postes à risque'),
  ('conge_maternite_jours', '98', 'Durée du congé de maternité (jours)', 'Loi 83-11 : 14 semaines'),
  ('nom_entreprise', '"AIFG"', 'Raison sociale figurant sur les documents', ''),
  ('devise', '"DZD"', 'Devise utilisée', '')
ON CONFLICT (cle) DO NOTHING;

-- Jours fériés légaux (dates civiles fixes + religieuses à saisir chaque année)
INSERT INTO jours_feries (date, libelle, type) VALUES
  ('2026-01-01','Jour de l''An','Civil'),
  ('2026-01-12','Yennayer (Nouvel An amazigh)','Civil'),
  ('2026-05-01','Fête du Travail','Civil'),
  ('2026-07-05','Fête de l''Indépendance','Civil'),
  ('2026-11-01','Fête de la Révolution','Civil'),
  ('2027-01-01','Jour de l''An','Civil'),
  ('2027-01-12','Yennayer (Nouvel An amazigh)','Civil'),
  ('2027-05-01','Fête du Travail','Civil'),
  ('2027-07-05','Fête de l''Indépendance','Civil'),
  ('2027-11-01','Fête de la Révolution','Civil')
ON CONFLICT (date) DO NOTHING;

-- ============================================================
-- Levée des verrous figés (audit de paramétrabilité)
-- Les types de congé étaient contraints par une liste écrite dans le schéma :
-- ajouter un type via l'interface provoquait une erreur. La validation se fait
-- désormais applicativement contre la table `types_conge`, qui est modifiable.
-- ============================================================
ALTER TABLE conges DROP CONSTRAINT IF EXISTS conges_type_check;

-- Les codes de pointage suivent la même logique : table de référence, pas de liste figée.
CREATE TABLE IF NOT EXISTS codes_pointage (
  code TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  compte_travaille BOOLEAN NOT NULL DEFAULT FALSE,
  couleur TEXT NOT NULL DEFAULT 'bg-muted text-muted-foreground',
  couleur_impression TEXT NOT NULL DEFAULT '#ececec',
  ordre INTEGER NOT NULL DEFAULT 100,
  actif BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO codes_pointage (code, libelle, compte_travaille, couleur, couleur_impression, ordre) VALUES
  ('P',   'On base',               TRUE,  'bg-primary/15 text-primary',         '#e2efe8', 10),
  ('IZ',  'On chantier',           TRUE,  'bg-teal-100 text-teal-800',          '#d5ece8', 20),
  ('CR',  'Congé de récupération', FALSE, 'bg-muted text-muted-foreground',     '#ececec', 30),
  ('CA',  'Congé annuel',          FALSE, 'bg-amber-100 text-amber-800',        '#fdeeca', 40),
  ('CE',  'Congé exceptionnel',    FALSE, 'bg-violet-100 text-violet-800',      '#e9e0f5', 50),
  ('M',   'Maladie',               FALSE, 'bg-sky-100 text-sky-800',            '#dcecf7', 60),
  ('A',   'Absence',               FALSE, 'bg-destructive/15 text-destructive', '#f6dcd6', 70),
  ('S',   'Suspension',            FALSE, 'bg-orange-100 text-orange-800',      '#fbe3cf', 80),
  ('CSS', 'Congé sans solde',      FALSE, 'bg-stone-200 text-stone-700',        '#e4e0da', 90),
  ('MAP', 'Mise à pied',           FALSE, 'bg-rose-200 text-rose-900',          '#f5cfd4', 100)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- COMPLÉTUDE DES DOSSIERS (registre du personnel, CNAS, paie)
-- ============================================================

-- --- Employés : dossier du personnel complet ---
ALTER TABLE employes ADD COLUMN IF NOT EXISTS matricule TEXT;
ALTER TABLE employes ADD COLUMN IF NOT EXISTS date_naissance DATE;
ALTER TABLE employes ADD COLUMN IF NOT EXISTS lieu_naissance TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS sexe TEXT NOT NULL DEFAULT 'M' CHECK (sexe IN ('M','F'));
ALTER TABLE employes ADD COLUMN IF NOT EXISTS num_identite TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS num_cnas TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS situation_familiale TEXT NOT NULL DEFAULT 'Célibataire'
  CHECK (situation_familiale IN ('Célibataire','Marié(e)','Divorcé(e)','Veuf/Veuve'));
ALTER TABLE employes ADD COLUMN IF NOT EXISTS enfants_a_charge INTEGER NOT NULL DEFAULT 0 CHECK (enfants_a_charge >= 0);
ALTER TABLE employes ADD COLUMN IF NOT EXISTS adresse TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS wilaya_residence TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS urgence_nom TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS urgence_lien TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS urgence_telephone TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS groupe_sanguin TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS salaire_base NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (salaire_base >= 0);
ALTER TABLE employes ADD COLUMN IF NOT EXISTS categorie_conventionnelle TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS rib TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS niveau_qualification TEXT NOT NULL DEFAULT '';
ALTER TABLE employes ADD COLUMN IF NOT EXISTS observations TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_employes_matricule ON employes(matricule) WHERE matricule IS NOT NULL AND matricule <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_employes_cnas ON employes(num_cnas) WHERE num_cnas <> '';

-- --- Sociétés : identification légale complète ---
ALTER TABLE societes ADD COLUMN IF NOT EXISTS forme_juridique TEXT NOT NULL DEFAULT '';
ALTER TABLE societes ADD COLUMN IF NOT EXISTS registre_commerce TEXT NOT NULL DEFAULT '';
ALTER TABLE societes ADD COLUMN IF NOT EXISTS nis TEXT NOT NULL DEFAULT '';
ALTER TABLE societes ADD COLUMN IF NOT EXISTS article_imposition TEXT NOT NULL DEFAULT '';
ALTER TABLE societes ADD COLUMN IF NOT EXISTS num_cnas_employeur TEXT NOT NULL DEFAULT '';
ALTER TABLE societes ADD COLUMN IF NOT EXISTS adresse TEXT NOT NULL DEFAULT '';
ALTER TABLE societes ADD COLUMN IF NOT EXISTS wilaya TEXT NOT NULL DEFAULT '';
ALTER TABLE societes ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE societes ADD COLUMN IF NOT EXISTS objet_prestation TEXT NOT NULL DEFAULT '';
ALTER TABLE societes ADD COLUMN IF NOT EXISTS contrat_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE societes ADD COLUMN IF NOT EXISTS contrat_debut DATE;
ALTER TABLE societes ADD COLUMN IF NOT EXISTS contrat_fin DATE;
ALTER TABLE societes ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- --- Services : code analytique et responsable ---
ALTER TABLE services ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';
ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- --- Chantiers : identification et cycle de vie ---
ALTER TABLE chantiers ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';
ALTER TABLE chantiers ADD COLUMN IF NOT EXISTS client TEXT NOT NULL DEFAULT '';
ALTER TABLE chantiers ADD COLUMN IF NOT EXISTS date_ouverture DATE;
ALTER TABLE chantiers ADD COLUMN IF NOT EXISTS date_fermeture DATE;
ALTER TABLE chantiers ADD COLUMN IF NOT EXISTS actif BOOLEAN NOT NULL DEFAULT TRUE;

-- --- Comptes : joignabilité ---
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS telephone TEXT NOT NULL DEFAULT '';
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS fonction TEXT NOT NULL DEFAULT '';

-- --- Congés : justificatif et traçabilité de la décision ---
ALTER TABLE conges ADD COLUMN IF NOT EXISTS justificatif_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE conges ADD COLUMN IF NOT EXISTS adresse_pendant_conge TEXT NOT NULL DEFAULT '';
ALTER TABLE conges ADD COLUMN IF NOT EXISTS remplacant_id INTEGER REFERENCES employes(id) ON DELETE SET NULL;
ALTER TABLE conges ADD COLUMN IF NOT EXISTS observation_decision TEXT NOT NULL DEFAULT '';
ALTER TABLE conges ADD COLUMN IF NOT EXISTS decide_par TEXT NOT NULL DEFAULT '';
ALTER TABLE conges ADD COLUMN IF NOT EXISTS decide_le TIMESTAMPTZ;

-- Numérotation automatique des matricules (format AIFG-0001)
CREATE SEQUENCE IF NOT EXISTS seq_matricule START 1;

-- ============================================================
-- PIÈCES JOINTES (photos, contrats signés, certificats)
-- Les fichiers sont stockés hors du dossier web, sous un nom aléatoire.
-- La base ne conserve que les métadonnées et les droits d'accès.
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  employe_id INTEGER REFERENCES employes(id) ON DELETE CASCADE,
  societe_id INTEGER REFERENCES societes(id) ON DELETE CASCADE,
  conge_id INTEGER REFERENCES conges(id) ON DELETE CASCADE,
  categorie TEXT NOT NULL CHECK (categorie IN (
    'Photo','Contrat de travail','Pièce d''identité','Diplôme','Certificat médical',
    'Attestation de travail','Habilitation','Contrat de sous-traitance','Justificatif de congé','Autre')),
  nom_original TEXT NOT NULL,
  nom_stockage TEXT NOT NULL UNIQUE,
  type_mime TEXT NOT NULL,
  taille_octets INTEGER NOT NULL CHECK (taille_octets > 0),
  empreinte_sha256 TEXT NOT NULL DEFAULT '',
  date_document DATE,
  date_expiration DATE,
  description TEXT NOT NULL DEFAULT '',
  ajoute_par TEXT NOT NULL DEFAULT '',
  ajoute_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rattachement_unique CHECK (
    (employe_id IS NOT NULL)::int + (societe_id IS NOT NULL)::int + (conge_id IS NOT NULL)::int = 1
  )
);
CREATE INDEX IF NOT EXISTS idx_documents_employe ON documents(employe_id);
CREATE INDEX IF NOT EXISTS idx_documents_societe ON documents(societe_id);
CREATE INDEX IF NOT EXISTS idx_documents_conge ON documents(conge_id);
CREATE INDEX IF NOT EXISTS idx_documents_expiration ON documents(date_expiration) WHERE date_expiration IS NOT NULL;

-- Une seule photo par employé
CREATE UNIQUE INDEX IF NOT EXISTS uq_photo_employe ON documents(employe_id) WHERE categorie = 'Photo';
