import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import bcrypt from 'bcryptjs';
import { pool, q } from './db.js';

const ici = path.dirname(fileURLToPath(import.meta.url));

export async function migrer() {
  const schema = readFileSync(path.join(ici, '../../sql/schema.sql'), 'utf8');
  await q(schema);
}

export async function semer() {
  const { rows } = await q('SELECT count(*)::int AS n FROM societes');
  if (rows[0].n > 0) return;

  await q(`INSERT INTO societes (nom, type, contact, telephone, nif) VALUES
    ('AIFG','Principale','Direction générale','029 00 00 00',''),
    ('SARL Sahara Services','Sous-traitance','M. Brahimi','0550 11 22 33',''),
    ('EURL Oasis Travaux','Sous-traitance','Mme Gasmi','0661 44 55 66','')`);

  await q(`INSERT INTO services (nom) VALUES
    ('Administration & Finances'),('Chantier Nord — Forage'),
    ('Chantier Sud — Maintenance'),('Logistique & Transport')`);

  await q(`INSERT INTO chantiers (nom, service_id, lieu, wilaya) VALUES
    ('Puits HBK-12',2,'Hassi Berkine','Ouargla'),
    ('Puits RML-07',2,'Rhourde El Merah','Ouargla'),
    ('Base In Amenas',3,'In Amenas','Illizi'),
    ('Parc roulant Ouargla',4,'Ouargla','Ouargla')`);
  await q(`UPDATE services SET wilaya='Ouargla' WHERE wilaya=''`);

  await q(`INSERT INTO rotations (nom, jours_travail, jours_repos) VALUES
    ('4×4 (28 j travail / 28 j repos)',28,28),('20/10',20,10),('6×2 (6 j travail / 2 j repos)',6,2)`);

  await q(`INSERT INTO employes
    (prenom,nom,poste,societe_id,service_id,chantier_id,categorie,rotation_id,debut_cycle,email,telephone,date_embauche,solde_conges,type_contrat,fin_contrat,prochaine_visite_medicale) VALUES
    ('Amina','Benali','Responsable Administration',1,1,NULL,'Administratif',NULL,NULL,'a.benali@aifg.dz','0550 12 34 56','2018-03-12',18,'CDI',NULL,'2026-11-15'),
    ('Karim','Haddad','Comptable senior',1,1,NULL,'Administratif',NULL,NULL,'k.haddad@aifg.dz','0661 22 87 09','2019-09-02',12,'CDI',NULL,'2026-08-20'),
    ('Imene','Zerrouki','Assistante administrative',2,1,NULL,'Administratif',NULL,NULL,'i.zerrouki@sahara-services.dz','0772 15 26 37','2022-05-30',9,'CDD','2026-09-30','2027-01-10'),
    ('Yacine','Bouzid','Chef de chantier',1,2,1,'Chantier',1,'2026-07-13','y.bouzid@aifg.dz','0555 78 90 11','2016-06-01',22,'CDI',NULL,'2026-07-01'),
    ('Riad','Belkacem','Opérateur de forage',2,2,1,'Chantier',1,'2026-07-13','r.belkacem@sahara-services.dz','0556 41 52 63','2019-12-09',14,'CDD','2026-08-31','2026-12-05'),
    ('Sofiane','Amrani','Soudeur qualifié',3,2,2,'Chantier',2,'2026-08-01','s.amrani@oasis-travaux.dz','0663 90 12 34','2020-08-10',11,'CDD','2026-12-31','2026-09-14'),
    ('Mehdi','Saadi','Électricien industriel',3,3,3,'Chantier',2,'2026-08-01','m.saadi@oasis-travaux.dz','0771 09 88 77','2024-02-19',6,'CDD','2027-02-18','2026-10-02'),
    ('Nadia','Khelifi','Responsable logistique',1,4,NULL,'Administratif',NULL,NULL,'n.khelifi@aifg.dz','0550 66 21 43','2017-04-24',20,'CDI',NULL,'2027-03-22'),
    ('Lina','Cherif','Chargée des achats',1,4,NULL,'Administratif',NULL,NULL,'l.cherif@aifg.dz','0662 33 44 55','2023-11-06',15,'CDI',NULL,'2026-08-28'),
    ('Walid','Mansouri','Chauffeur poids lourd',2,4,4,'Chantier',3,'2026-08-03','w.mansouri@sahara-services.dz','0557 20 31 42','2021-10-04',13,'CDD','2026-10-15','2026-06-18')`);

  const h = (m) => bcrypt.hashSync(m, 12);
  await q(`INSERT INTO comptes (nom,email,mdp_hash,role,service_id,chantier_id,doit_changer_mdp) VALUES
    ('Service RH','rh@aifg.dz',$1,'rh',NULL,NULL,TRUE),
    ('Direction générale','direction@aifg.dz',$2,'direction',NULL,NULL,TRUE),
    ('Amina Benali','a.benali@aifg.dz',$3,'chef_service',1,NULL,TRUE),
    ('Yacine Bouzid','y.bouzid@aifg.dz',$3,'chef_service',2,NULL,TRUE),
    ('Nadia Khelifi','n.khelifi@aifg.dz',$3,'chef_service',4,NULL,TRUE),
    ('Riad Belkacem','r.belkacem@sahara-services.dz',$3,'chef_chantier',2,1,TRUE),
    ('Sofiane Amrani','s.amrani@oasis-travaux.dz',$3,'superviseur',2,2,TRUE)`,
    [h(process.env.MDP_INITIAL_RH || 'ChangerMoi!2026'), h(process.env.MDP_INITIAL_DIRECTION || 'ChangerMoi!2026'), h('ChangerMoi!2026')]);
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  migrer().then(semer).then(() => { console.log('Migration + seed OK'); return pool.end(); });
}
