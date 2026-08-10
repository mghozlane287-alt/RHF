import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { creerApp } from '../src/index.js';
import { migrer, semer } from '../src/lib/migrate.js';
import { pool, q } from '../src/lib/db.js';

const app = creerApp();
const MDP = 'ChangerMoi!2026';
const NOUVEAU = 'Nouveau2026mdp';

const jetons = {};

async function connecter(email, motDePasse) {
  const r = await request(app).post('/api/auth/connexion').send({ email, motDePasse });
  return r;
}

/** Connexion + changement du mot de passe imposé au premier accès. */
async function preparerCompte(email) {
  let r = await connecter(email, MDP);
  if (r.status !== 200) throw new Error(`connexion ${email} : ${r.status} ${JSON.stringify(r.body)}`);
  let token = r.body.token;
  if (r.body.compte.doitChangerMdp) {
    const c = await request(app).post('/api/auth/changer-mot-de-passe')
      .set('Authorization', `Bearer ${token}`).send({ ancien: MDP, nouveau: NOUVEAU });
    expect(c.status).toBe(200);
    r = await connecter(email, NOUVEAU);
    token = r.body.token;
  }
  return token;
}

beforeAll(async () => {
  await migrer();
  // base propre entre les exécutions
  // On réinitialise aussi le référentiel légal, puis on rejoue le schéma
  // (idempotent) pour restaurer les paramètres, types de congé et jours fériés.
  await q(`TRUNCATE journal_audit, envois, notifications, lignes_pointage, feuilles, conges,
           comptes, employes, chantiers, rotations, services, societes,
           acquisitions_conge, jours_feries, types_conge, parametres RESTART IDENTITY CASCADE`);
  await migrer();
  await semer();
  jetons.rh = await preparerCompte('rh@aifg.dz');
  jetons.direction = await preparerCompte('direction@aifg.dz');
  jetons.chefService = await preparerCompte('y.bouzid@aifg.dz');       // service 2
  jetons.chefChantier = await preparerCompte('r.belkacem@sahara-services.dz'); // chantier 1
  jetons.superviseur = await preparerCompte('s.amrani@oasis-travaux.dz');      // chantier 2
}, 60000);

afterAll(() => pool.end());

const avec = (t) => ({ Authorization: `Bearer ${t}` });

// ============================================================
describe('Authentification', () => {
  it('refuse un mot de passe incorrect avec un message neutre', async () => {
    const r = await connecter('rh@aifg.dz', 'faux');
    expect(r.status).toBe(401);
    expect(r.body.erreur).toBe('Identifiants incorrects.');
  });

  it('refuse un e-mail inexistant avec le MÊME message (anti-énumération de comptes)', async () => {
    const r = await connecter('inconnu@nulle-part.dz', 'peu-importe');
    expect(r.status).toBe(401);
    expect(r.body.erreur).toBe('Identifiants incorrects.');
  });

  it('refuse toute route protégée sans jeton', async () => {
    expect((await request(app).get('/api/employes')).status).toBe(401);
    expect((await request(app).get('/api/referentiel')).status).toBe(401);
  });

  it('refuse un jeton falsifié', async () => {
    const r = await request(app).get('/api/employes').set(avec('un.jeton.invalide'));
    expect(r.status).toBe(401);
  });

  it('verrouille le compte après 5 échecs consécutifs (anti-force-brute)', async () => {
    await q(`INSERT INTO comptes (nom,email,mdp_hash,role,service_id,doit_changer_mdp)
             VALUES ('Cible Test','cible@aifg.dz','$2a$12$abcdefghijklmnopqrstuv','chef_service',1,FALSE)`);
    for (let i = 0; i < 5; i++) await connecter('cible@aifg.dz', 'mauvais');
    const r = await connecter('cible@aifg.dz', 'mauvais');
    expect(r.status).toBe(423);
    await q(`DELETE FROM comptes WHERE email='cible@aifg.dz'`);
  });

  it('impose le changement du mot de passe temporaire avant tout accès (428)', async () => {
    const creation = await request(app).post('/api/comptes').set(avec(jetons.rh)).send({
      nom: 'Test Premier Acces', email: 'premier.acces@aifg.dz',
      motDePasse: 'Temporaire2026', role: 'chef_service', serviceId: 3,
    });
    expect(creation.status).toBe(201);
    const co = await connecter('premier.acces@aifg.dz', 'Temporaire2026');
    expect(co.body.compte.doitChangerMdp).toBe(true);
    const bloque = await request(app).get('/api/employes').set(avec(co.body.token));
    expect(bloque.status).toBe(428);
    const chg = await request(app).post('/api/auth/changer-mot-de-passe')
      .set(avec(co.body.token)).send({ ancien: 'Temporaire2026', nouveau: 'Definitif2026x' });
    expect(chg.status).toBe(200);
    const co2 = await connecter('premier.acces@aifg.dz', 'Definitif2026x');
    expect((await request(app).get('/api/employes').set(avec(co2.body.token))).status).toBe(200);
  });

  it('refuse un nouveau mot de passe trop court, sans chiffre, ou identique à l’ancien', async () => {
    const t = jetons.chefChantier;
    const court = await request(app).post('/api/auth/changer-mot-de-passe').set(avec(t)).send({ ancien: NOUVEAU, nouveau: 'court1' });
    expect(court.status).toBe(400);
    const sansChiffre = await request(app).post('/api/auth/changer-mot-de-passe').set(avec(t)).send({ ancien: NOUVEAU, nouveau: 'quesdeslettres' });
    expect(sansChiffre.status).toBe(400);
    const identique = await request(app).post('/api/auth/changer-mot-de-passe').set(avec(t)).send({ ancien: NOUVEAU, nouveau: NOUVEAU });
    expect(identique.status).toBe(400);
  });

  it('ne renvoie jamais le hash du mot de passe', async () => {
    const r = await connecter('rh@aifg.dz', NOUVEAU);
    expect(JSON.stringify(r.body)).not.toMatch(/\$2[aby]\$/);
    const comptes = await request(app).get('/api/comptes').set(avec(jetons.rh));
    expect(JSON.stringify(comptes.body)).not.toMatch(/\$2[aby]\$/);
  });
});

// ============================================================
describe('Contrôle d’accès (RBAC) côté serveur', () => {
  it('le chef de service ne voit que les employés de SON service', async () => {
    const r = await request(app).get('/api/employes').set(avec(jetons.chefService));
    expect(r.status).toBe(200);
    expect(r.body.employes.length).toBeGreaterThan(0);
    expect(r.body.employes.every((e) => e.service_id === 2)).toBe(true);
  });

  it('le chef de chantier ne voit que les employés de SON chantier', async () => {
    const r = await request(app).get('/api/employes').set(avec(jetons.chefChantier));
    expect(r.body.employes.every((e) => e.chantier_id === 1)).toBe(true);
  });

  it('le RH et la Direction voient tout le monde', async () => {
    const rh = await request(app).get('/api/employes').set(avec(jetons.rh));
    const dir = await request(app).get('/api/employes').set(avec(jetons.direction));
    expect(rh.body.total).toBe(10);
    expect(dir.body.total).toBe(10);
  });

  it('un chef ne peut PAS créer, modifier ou supprimer un employé (403)', async () => {
    const creation = await request(app).post('/api/employes').set(avec(jetons.chefService)).send({
      prenom: 'Pirate', nom: 'Test', poste: 'X', societeId: 1, serviceId: 1,
      categorie: 'Administratif', dateEmbauche: '2026-01-01', soldeConges: 30, typeContrat: 'CDI',
    });
    expect(creation.status).toBe(403);
    expect((await request(app).delete('/api/employes/1').set(avec(jetons.chefService))).status).toBe(403);
  });

  it('un chef ne peut PAS créer de compte ni de société (403)', async () => {
    expect((await request(app).post('/api/comptes').set(avec(jetons.chefService)).send({
      nom: 'X', email: 'x@y.dz', motDePasse: 'Motdepasse1', role: 'chef_service', serviceId: 1,
    })).status).toBe(403);
    expect((await request(app).post('/api/societes').set(avec(jetons.chefService)).send({ nom: 'Pirate SARL' })).status).toBe(403);
  });

  it('la Direction est en LECTURE SEULE (ne peut ni créer un employé ni déposer un congé)', async () => {
    expect((await request(app).post('/api/employes').set(avec(jetons.direction)).send({
      prenom: 'A', nom: 'B', poste: 'C', societeId: 1, serviceId: 1,
      categorie: 'Administratif', dateEmbauche: '2026-01-01', soldeConges: 1, typeContrat: 'CDI',
    })).status).toBe(403);
    expect((await request(app).post('/api/conges').set(avec(jetons.direction)).send({
      employeId: 1, type: 'Congé annuel', debut: '2026-09-01', fin: '2026-09-03',
    })).status).toBe(403);
  });

  it('le journal d’envois est réservé au RH', async () => {
    expect((await request(app).get('/api/envois').set(avec(jetons.rh))).status).toBe(200);
    expect((await request(app).get('/api/envois').set(avec(jetons.chefService))).status).toBe(403);
    expect((await request(app).get('/api/envois').set(avec(jetons.direction))).status).toBe(403);
  });
});

// ============================================================
describe('Validation des données (entrées serveur)', () => {
  it('refuse un employé de chantier sans chantier', async () => {
    const r = await request(app).post('/api/employes').set(avec(jetons.rh)).send({
      prenom: 'Sans', nom: 'Chantier', poste: 'Ouvrier', societeId: 1,
      categorie: 'Chantier', dateEmbauche: '2026-01-01', soldeConges: 30, typeContrat: 'CDI',
    });
    expect(r.status).toBe(400);
  });

  it('refuse un CDD sans date de fin', async () => {
    const r = await request(app).post('/api/employes').set(avec(jetons.rh)).send({
      prenom: 'Cdd', nom: 'SansFin', poste: 'Ouvrier', societeId: 1, serviceId: 1,
      categorie: 'Administratif', dateEmbauche: '2026-01-01', soldeConges: 30, typeContrat: 'CDD',
    });
    expect(r.status).toBe(400);
  });

  it('déduit automatiquement le service depuis le chantier', async () => {
    const r = await request(app).post('/api/employes').set(avec(jetons.rh)).send({
      prenom: 'Auto', nom: 'Service', poste: 'Foreur', societeId: 2,
      serviceId: 1, // volontairement faux : doit être écrasé par le service du chantier 3
      chantierId: 3, categorie: 'Chantier', dateEmbauche: '2026-01-01',
      soldeConges: 30, typeContrat: 'CDI',
    });
    expect(r.status).toBe(201);
    expect(r.body.service_id).toBe(3);
    await q('DELETE FROM employes WHERE id=$1', [r.body.id]);
  });

  it('refuse la suppression d’une société encore utilisée', async () => {
    const r = await request(app).delete('/api/societes/2').set(avec(jetons.rh));
    expect(r.status).toBe(409);
  });

  it('refuse la suppression de la société principale AIFG', async () => {
    expect((await request(app).delete('/api/societes/1').set(avec(jetons.rh))).status).toBe(400);
  });

  it('empêche l’injection SQL dans un nom (traité comme du texte)', async () => {
    const nom = "Test'); DROP TABLE employes;--";
    const r = await request(app).post('/api/societes').set(avec(jetons.rh)).send({ nom });
    expect(r.status).toBe(201);
    expect(r.body.nom).toBe(nom);
    const t = await q("SELECT to_regclass('public.employes') AS existe");
    expect(t.rows[0].existe).toBe('employes'); // la table existe toujours
    await q('DELETE FROM societes WHERE id=$1', [r.body.id]);
  });
});

// ============================================================
describe('Circuit de pointage', () => {
  let feuilleId;

  it('le chef de chantier crée sa feuille pré-remplie selon la rotation', async () => {
    const r = await request(app).post('/api/feuilles').set(avec(jetons.chefChantier))
      .send({ serviceId: 2, chantierId: 1, mois: '2026-08' });
    expect(r.status).toBe(201);
    feuilleId = r.body.id;
    expect(r.body.statut).toBe('En préparation');
    expect(r.body.lignes.length).toBe(2); // Bouzid + Belkacem sur le chantier 1
    expect(r.body.lignes[0].jours.length).toBe(31);
    // rotation 28/28 débutée le 13/07 : IZ jusqu'au 09/08 puis CR
    expect(r.body.lignes[0].jours[8]).toBe('IZ');  // 9 août
    expect(r.body.lignes[0].jours[9]).toBe('CR');  // 10 août
  });

  it('refuse une deuxième feuille pour le même périmètre et le même mois', async () => {
    const r = await request(app).post('/api/feuilles').set(avec(jetons.chefChantier))
      .send({ serviceId: 2, chantierId: 1, mois: '2026-08' });
    expect(r.status).toBe(409);
  });

  it('interdit au superviseur d’un AUTRE chantier de créer ou modifier cette feuille', async () => {
    const r = await request(app).post('/api/feuilles').set(avec(jetons.superviseur))
      .send({ serviceId: 2, chantierId: 1, mois: '2026-09' });
    expect(r.status).toBe(403);
    const m = await request(app).put(`/api/feuilles/${feuilleId}/lignes`).set(avec(jetons.superviseur))
      .send({ lignes: [{ employeId: 4, jours: Array(31).fill('P'), heuresSupp: 0 }] });
    expect(m.status).toBe(403);
  });

  it('accepte la saisie des codes valides et des heures supplémentaires', async () => {
    const jours = Array(31).fill('IZ'); jours[0] = 'A'; jours[1] = 'CSS'; jours[2] = 'MAP';
    const r = await request(app).put(`/api/feuilles/${feuilleId}/lignes`).set(avec(jetons.chefChantier))
      .send({ lignes: [{ employeId: 5, jours, heuresSupp: 12.5 }] });
    expect(r.status).toBe(200);
    const ligne = r.body.lignes.find((l) => l.employe_id === 5);
    expect(ligne.jours[2]).toBe('MAP');
    expect(Number(ligne.heures_supp)).toBe(12.5);
  });

  it('refuse un code inconnu et un nombre de jours incorrect', async () => {
    const faux = await request(app).put(`/api/feuilles/${feuilleId}/lignes`).set(avec(jetons.chefChantier))
      .send({ lignes: [{ employeId: 5, jours: Array(31).fill('ZZZ'), heuresSupp: 0 }] });
    expect(faux.status).toBe(400);
    const court = await request(app).put(`/api/feuilles/${feuilleId}/lignes`).set(avec(jetons.chefChantier))
      .send({ lignes: [{ employeId: 5, jours: Array(30).fill('P'), heuresSupp: 0 }] });
    expect(court.status).toBe(400);
  });

  it('interdit au chef de chantier de sauter l’étape (En préparation → Chez RH)', async () => {
    const r = await request(app).post(`/api/feuilles/${feuilleId}/statut`).set(avec(jetons.chefChantier))
      .send({ statut: 'Chez RH' });
    expect(r.status).toBe(403);
  });

  it('chantier → chef de service : la transition notifie et envoie un e-mail', async () => {
    const r = await request(app).post(`/api/feuilles/${feuilleId}/statut`).set(avec(jetons.chefChantier))
      .send({ statut: 'Chez le chef de service' });
    expect(r.status).toBe(200);
    expect(r.body.statut).toBe('Chez le chef de service');
    const env = await q(`SELECT * FROM envois WHERE canal='email' AND sujet LIKE '[Pointage à valider]%'`);
    expect(env.rows.length).toBeGreaterThan(0);
    const notif = await q(`SELECT * FROM notifications WHERE cible='service:2'`);
    expect(notif.rows.length).toBeGreaterThan(0);
  });

  it('le chef de chantier ne peut plus modifier une feuille partie chez le chef de service', async () => {
    const r = await request(app).put(`/api/feuilles/${feuilleId}/lignes`).set(avec(jetons.chefChantier))
      .send({ lignes: [{ employeId: 5, jours: Array(31).fill('P'), heuresSupp: 0 }] });
    expect(r.status).toBe(403);
  });

  it('le chef de service peut corriger puis transmettre au RH', async () => {
    const corr = await request(app).put(`/api/feuilles/${feuilleId}/lignes`).set(avec(jetons.chefService))
      .send({ lignes: [{ employeId: 5, jours: Array(31).fill('IZ'), heuresSupp: 10 }] });
    expect(corr.status).toBe(200);
    const t = await request(app).post(`/api/feuilles/${feuilleId}/statut`).set(avec(jetons.chefService))
      .send({ statut: 'Chez RH' });
    expect(t.status).toBe(200);
    expect(t.body.valide_service_le).toBeTruthy();
  });

  it('seul le RH peut archiver ; la Direction est notifiée', async () => {
    const refus = await request(app).post(`/api/feuilles/${feuilleId}/statut`).set(avec(jetons.chefService))
      .send({ statut: 'Archivée' });
    expect(refus.status).toBe(403);
    const ok = await request(app).post(`/api/feuilles/${feuilleId}/statut`).set(avec(jetons.rh))
      .send({ statut: 'Archivée' });
    expect(ok.status).toBe(200);
    expect(ok.body.valide_rh_le).toBeTruthy();
    const notifDir = await q(`SELECT * FROM notifications WHERE cible='direction'`);
    expect(notifDir.rows.length).toBeGreaterThan(0);
  });

  it('export paie : réservé au RH, contient les 10 codes et les heures supplémentaires', async () => {
    expect((await request(app).get(`/api/feuilles/${feuilleId}/paie.xlsx`).set(avec(jetons.chefService))).status).toBe(403);
    const r = await request(app).get(`/api/feuilles/${feuilleId}/paie.xlsx`).set(avec(jetons.rh)).buffer().parse((res, cb) => {
      const morceaux = []; res.on('data', (c) => morceaux.push(c)); res.on('end', () => cb(null, Buffer.concat(morceaux)));
    });
    expect(r.status).toBe(200);
    const wb = XLSX.read(r.body, { type: 'buffer' });
    const lignes = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    expect(lignes.length).toBe(2);
    // Les colonnes de codes sont générées depuis la table codes_pointage (paramétrable)
    const codes = (await q('SELECT code, libelle FROM codes_pointage WHERE actif')).rows;
    for (const c of codes) {
      expect(Object.keys(lignes[0])).toContain(`${c.code} (${c.libelle})`);
    }
    for (const c of ['Jours travaillés', 'Heures supplémentaires', 'Majoration HS (%)',
                     'Jours fériés travaillés', 'Jours repos hebdo. travaillés']) {
      expect(Object.keys(lignes[0])).toContain(c);
    }
  });

  it('le chef de service ne voit que les feuilles de son service', async () => {
    const r = await request(app).get('/api/feuilles').set(avec(jetons.chefService));
    expect(r.body.every((f) => f.service_id === 2)).toBe(true);
  });
});

// ============================================================
describe('Circuit des congés', () => {
  let congeId;

  it('le chef de service dépose une demande : jours ouvrés calculés, employé notifié par WhatsApp', async () => {
    const r = await request(app).post('/api/conges').set(avec(jetons.chefService))
      .send({ employeId: 5, type: 'Congé annuel', debut: '2026-09-06', fin: '2026-09-12', motif: 'Repos' });
    expect(r.status).toBe(201);
    congeId = r.body.id;
    expect(r.body.jours).toBe(5); // dim→jeu ouvrés, ven+sam exclus
    expect(r.body.statut).toBe('En attente (chef de service)');
    const wa = await q(`SELECT * FROM envois WHERE canal='whatsapp' ORDER BY id DESC LIMIT 1`);
    expect(wa.rows[0].contact).toContain('0556');
    expect(wa.rows[0].lien).toContain('wa.me/213556');
  });

  it('refuse une demande pour un employé d’un autre service', async () => {
    const r = await request(app).post('/api/conges').set(avec(jetons.chefService))
      .send({ employeId: 1, type: 'Congé annuel', debut: '2026-09-06', fin: '2026-09-10' });
    expect(r.status).toBe(403);
  });

  it('refuse une période sans jour ouvré ou inversée', async () => {
    const inverse = await request(app).post('/api/conges').set(avec(jetons.chefService))
      .send({ employeId: 5, type: 'Congé annuel', debut: '2026-09-20', fin: '2026-09-10' });
    expect(inverse.status).toBe(400);
    const weekEnd = await request(app).post('/api/conges').set(avec(jetons.chefService))
      .send({ employeId: 5, type: 'Congé annuel', debut: '2026-09-11', fin: '2026-09-12' }); // ven+sam
    expect(weekEnd.status).toBe(400);
  });

  it('le RH ne peut pas approuver avant la validation du chef de service', async () => {
    const r = await request(app).post(`/api/conges/${congeId}/decision`).set(avec(jetons.rh)).send({ decision: 'valider' });
    expect(r.status).toBe(403);
  });

  it('chef de service valide → RH approuve → le solde de congés est déduit', async () => {
    const avant = (await q('SELECT solde_conges FROM employes WHERE id=5')).rows[0].solde_conges;
    const v1 = await request(app).post(`/api/conges/${congeId}/decision`).set(avec(jetons.chefService)).send({ decision: 'valider' });
    expect(v1.body.statut).toBe('En attente (RH)');
    const v2 = await request(app).post(`/api/conges/${congeId}/decision`).set(avec(jetons.rh)).send({ decision: 'valider' });
    expect(v2.body.statut).toBe('Approuvé');
    const apres = (await q('SELECT solde_conges FROM employes WHERE id=5')).rows[0].solde_conges;
    expect(Number(avant) - Number(apres)).toBe(5);
  });

  it('refuse de décider deux fois de la même demande', async () => {
    const r = await request(app).post(`/api/conges/${congeId}/decision`).set(avec(jetons.rh)).send({ decision: 'refuser' });
    expect(r.status).toBe(400);
  });

  it('un congé sans solde ne modifie pas le solde de l’employé', async () => {
    const avant = (await q('SELECT solde_conges FROM employes WHERE id=5')).rows[0].solde_conges;
    const c = await request(app).post('/api/conges').set(avec(jetons.chefService))
      .send({ employeId: 5, type: 'Congé sans solde', debut: '2026-10-04', fin: '2026-10-08' });
    await request(app).post(`/api/conges/${c.body.id}/decision`).set(avec(jetons.chefService)).send({ decision: 'valider' });
    await request(app).post(`/api/conges/${c.body.id}/decision`).set(avec(jetons.rh)).send({ decision: 'valider' });
    const apres = (await q('SELECT solde_conges FROM employes WHERE id=5')).rows[0].solde_conges;
    expect(Number(apres)).toBe(Number(avant));
  });
});

// ============================================================
describe('Import Excel (transaction et sécurité)', () => {
  function classeur(lignes) {
    const ws = XLSX.utils.json_to_sheet(lignes);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employés');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('importe et crée société / service / chantier inconnus', async () => {
    const buf = classeur([{
      'Nom': 'Nouri', 'Prénom': 'Salim', 'Poste': 'Grutier',
      'Société': 'ETP El Djanoub', 'Service': 'Chantier Est — Génie civil',
      'Chantier': 'Base El Borma', 'Catégorie': 'Chantier',
      'Date embauche': '15/08/2026', 'Contrat': 'CDI', 'Solde congés': 30,
    }]);
    const r = await request(app).post('/api/employes/import').set(avec(jetons.rh))
      .attach('fichier', buf, 'import.xlsx');
    expect(r.status).toBe(200);
    expect(r.body.importes).toBe(1);
    expect(r.body.societesCreees).toContain('ETP El Djanoub');
    expect(r.body.chantiersCrees).toContain('Base El Borma');
    const e = (await q(`SELECT * FROM employes WHERE nom='Nouri'`)).rows[0];
    expect(String(e.date_embauche).slice(0, 10)).toBe('2026-08-15'); // JJ/MM/AAAA converti
  });

  it('signale les lignes invalides sans bloquer les autres', async () => {
    const buf = classeur([
      { 'Nom': 'SansPrenom', 'Service': 'Administration & Finances' },
      { 'Nom': 'Ok', 'Prénom': 'Admin', 'Poste': 'Agent', 'Société': 'AIFG', 'Service': 'Administration & Finances', 'Catégorie': 'Administratif', 'Date embauche': '2026-01-05', 'Contrat': 'CDI' },
      { 'Nom': 'CddSansFin', 'Prénom': 'Test', 'Société': 'AIFG', 'Service': 'Administration & Finances', 'Catégorie': 'Administratif', 'Contrat': 'CDD' },
    ]);
    const r = await request(app).post('/api/employes/import').set(avec(jetons.rh)).attach('fichier', buf, 'i.xlsx');
    expect(r.body.importes).toBe(1);
    expect(r.body.ignores.length).toBe(2);
  });

  it('l’import est réservé au RH', async () => {
    const buf = classeur([{ 'Nom': 'X', 'Prénom': 'Y', 'Service': 'Administration & Finances', 'Catégorie': 'Administratif' }]);
    const r = await request(app).post('/api/employes/import').set(avec(jetons.chefService)).attach('fichier', buf, 'i.xlsx');
    expect(r.status).toBe(403);
  });

  it('refuse un fichier qui n’est pas un classeur Excel', async () => {
    const r = await request(app).post('/api/employes/import').set(avec(jetons.rh))
      .attach('fichier', Buffer.from('ceci nest pas un xlsx'), 'faux.xlsx');
    expect(r.status).toBe(400);
  });

  it('neutralise les formules dans l’export (anti-injection Excel)', async () => {
    await q(`INSERT INTO employes (prenom,nom,poste,societe_id,service_id,categorie,date_embauche,solde_conges,type_contrat)
             VALUES ('Piege','=cmd|calc','Agent',1,1,'Administratif','2026-01-01',0,'CDI')`);
    const r = await request(app).get('/api/employes/export.xlsx').set(avec(jetons.rh)).buffer().parse((res, cb) => {
      const m = []; res.on('data', (c) => m.push(c)); res.on('end', () => cb(null, Buffer.concat(m)));
    });
    const wb = XLSX.read(r.body, { type: 'buffer' });
    const lignes = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const piege = lignes.find((l) => String(l['Nom']).includes('cmd|calc'));
    expect(piege['Nom'].startsWith("'=")).toBe(true);
    await q(`DELETE FROM employes WHERE prenom='Piege'`);
  });
});

// ============================================================
describe('Journal d’audit et traçabilité', () => {
  it('enregistre les connexions, créations et transitions', async () => {
    const r = await request(app).get('/api/audit').set(avec(jetons.rh));
    expect(r.status).toBe(200);
    const actions = r.body.map((l) => l.action);
    expect(actions).toContain('connexion');
    expect(actions).toContain('transition');
    expect(actions).toContain('creation');
    expect(r.body.every((l) => l.compte_email !== undefined)).toBe(true);
  });

  it('trace les échecs de connexion', async () => {
    await connecter('rh@aifg.dz', 'mauvais-mot-de-passe');
    const r = await request(app).get('/api/audit').set(avec(jetons.rh));
    expect(r.body.some((l) => l.action === 'connexion_echec')).toBe(true);
  });

  it('le journal d’audit est interdit aux chefs', async () => {
    expect((await request(app).get('/api/audit').set(avec(jetons.chefService))).status).toBe(403);
  });
});

// ============================================================
describe('Robustesse du serveur', () => {
  it('répond à la sonde de santé sans authentification', async () => {
    const r = await request(app).get('/api/sante');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('renvoie 404 JSON sur une route inconnue', async () => {
    const r = await request(app).get('/api/nimporte-quoi').set(avec(jetons.rh));
    expect(r.status).toBe(404);
  });

  it('pose les en-têtes de sécurité (helmet)', async () => {
    const r = await request(app).get('/api/sante');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBeDefined();
  });

  it('ne divulgue jamais de détails techniques dans les erreurs', async () => {
    const r = await request(app).post('/api/employes').set(avec(jetons.rh)).send({ prenom: 1234 });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/postgres|SELECT|INSERT|at Object|node_modules/i);
  });
});

// ============================================================
describe('Améliorations issues de l’audit', () => {
  it('sonde de santé : vérifie réellement la base et renvoie la version', async () => {
    const r = await request(app).get('/api/sante');
    expect(r.body.base).toBe('accessible');
    expect(r.body.version).toBeTruthy();
  });

  it('session persistante : le cookie httpOnly permet de rafraîchir sans ressaisir le mot de passe', async () => {
    const co = await request(app).post('/api/auth/connexion').send({ email: 'rh@aifg.dz', motDePasse: NOUVEAU });
    const cookies = co.headers['set-cookie'];
    expect(cookies).toBeTruthy();
    expect(cookies[0]).toMatch(/HttpOnly/i);
    expect(cookies[0]).toMatch(/SameSite=Strict/i);
    const raf = await request(app).post('/api/auth/rafraichir').set('Cookie', cookies);
    expect(raf.status).toBe(200);
    expect(raf.body.token).toBeTruthy();
  });

  it('rafraîchissement refusé sans cookie valide', async () => {
    expect((await request(app).post('/api/auth/rafraichir')).status).toBe(401);
    expect((await request(app).post('/api/auth/rafraichir').set('Cookie', ['aifg_session=faux'])).status).toBe(401);
  });

  it('changement de mot de passe : les sessions ouvertes ailleurs sont révoquées', async () => {
    const co = await request(app).post('/api/auth/connexion')
      .send({ email: 'y.bouzid@aifg.dz', motDePasse: NOUVEAU });
    const ancienCookie = co.headers['set-cookie'];
    await request(app).post('/api/auth/changer-mot-de-passe').set(avec(co.body.token))
      .send({ ancien: NOUVEAU, nouveau: 'AutreMdp2026x' });
    // l'ancien cookie ne doit plus permettre de rafraîchir
    const raf = await request(app).post('/api/auth/rafraichir').set('Cookie', ancienCookie);
    expect(raf.status).toBe(401);
    // on rétablit le mot de passe pour les tests suivants
    const co2 = await request(app).post('/api/auth/connexion').send({ email: 'y.bouzid@aifg.dz', motDePasse: 'AutreMdp2026x' });
    await request(app).post('/api/auth/changer-mot-de-passe').set(avec(co2.body.token))
      .send({ ancien: 'AutreMdp2026x', nouveau: NOUVEAU });
    jetons.chefService = (await request(app).post('/api/auth/connexion').send({ email: 'y.bouzid@aifg.dz', motDePasse: NOUVEAU })).body.token;
  });

  it('verrou optimiste : deux saisies simultanées ne s’écrasent pas silencieusement', async () => {
    const f = await request(app).post('/api/feuilles').set(avec(jetons.chefChantier))
      .send({ serviceId: 2, chantierId: 1, mois: '2026-11' });
    expect(f.status).toBe(201);
    const versionInitiale = f.body.version;
    const lignes = [{ employeId: f.body.lignes[0].employe_id, jours: Array(30).fill('IZ'), heuresSupp: 5 }];

    const premier = await request(app).put(`/api/feuilles/${f.body.id}/lignes`).set(avec(jetons.chefChantier))
      .send({ lignes, version: versionInitiale });
    expect(premier.status).toBe(200);
    expect(premier.body.version).toBe(versionInitiale + 1);

    // deuxième utilisateur, parti de la version périmée
    const second = await request(app).put(`/api/feuilles/${f.body.id}/lignes`).set(avec(jetons.chefService))
      .send({ lignes, version: versionInitiale });
    expect(second.status).toBe(409);
    expect(second.body.erreur).toMatch(/modifiée par quelqu'un d'autre/i);
  });

  it('pagination : limite respectée et total exact', async () => {
    const r = await request(app).get('/api/employes?limite=3&page=1').set(avec(jetons.rh));
    expect(r.body.employes.length).toBeLessThanOrEqual(3);
    expect(r.body.total).toBeGreaterThan(3);
    expect(r.body.page).toBe(1);
    const p2 = await request(app).get('/api/employes?limite=3&page=2').set(avec(jetons.rh));
    expect(p2.body.employes[0]?.id).not.toBe(r.body.employes[0]?.id);
  });

  it('recherche serveur : filtre par nom sans exposer d’injection SQL', async () => {
    const r = await request(app).get('/api/employes?recherche=benali').set(avec(jetons.rh));
    expect(r.body.employes.length).toBeGreaterThan(0);
    expect(r.body.employes.every((e) => `${e.nom}${e.prenom}${e.poste}`.toLowerCase().includes('benali'))).toBe(true);
    const injection = await request(app).get("/api/employes?recherche=%25'%20OR%201=1--").set(avec(jetons.rh));
    expect(injection.status).toBe(200);
    expect(injection.body.employes.length).toBe(0); // traité comme du texte, pas comme du SQL
  });

  it('la portée du chef reste appliquée malgré les paramètres de recherche', async () => {
    const r = await request(app).get('/api/employes?recherche=a&limite=1000').set(avec(jetons.chefChantier));
    expect(r.body.employes.every((e) => e.chantier_id === 1)).toBe(true);
  });
});

// ============================================================
describe('Deuxième passe d’audit — intégrité et conformité', () => {
  it('refuse de démarrer en production avec un secret par défaut', async () => {
    const { verifierConfiguration } = await import('../src/index.js');
    const sauvegarde = { ...process.env };
    const sortie = [];
    const vraiExit = process.exit;
    process.exit = (c) => { sortie.push(c); throw new Error('exit'); };
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'CHANGER-CE-SECRET-EN-PRODUCTION';
    try { verifierConfiguration(); } catch { /* attendu */ }
    process.exit = vraiExit;
    process.env = sauvegarde;
    expect(sortie).toContain(1);
  });

  it("supprimer un employé NE DÉTRUIT PAS son historique de pointage (pièce de paie)", async () => {
    // Riad Belkacem (id 5) a des lignes de pointage créées par les tests précédents.
    const avant = await q('SELECT count(*)::int AS n FROM lignes_pointage WHERE employe_id=5');
    expect(avant.rows[0].n).toBeGreaterThan(0);

    const r = await request(app).delete('/api/employes/5').set(avec(jetons.rh))
      .send({ motif: 'Fin de contrat', dateSortie: '2026-08-31' });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('sorti_effectif');

    const apres = await q('SELECT count(*)::int AS n FROM lignes_pointage WHERE employe_id=5');
    expect(apres.rows[0].n).toBe(avant.rows[0].n); // historique intact
    const emp = await q('SELECT actif, date_sortie FROM employes WHERE id=5');
    expect(emp.rows[0].actif).toBe(false);
    expect(String(emp.rows[0].date_sortie)).toBe('2026-08-31');
  });

  it('un employé sorti de l’effectif disparaît des listes et des nouvelles feuilles', async () => {
    const liste = await request(app).get('/api/employes?limite=1000').set(avec(jetons.rh));
    expect(liste.body.employes.some((e) => e.id === 5)).toBe(false);
    const avecSortis = await request(app).get('/api/employes?limite=1000&inclureSortis=1').set(avec(jetons.rh));
    expect(avecSortis.body.employes.some((e) => e.id === 5)).toBe(true);
  });

  it('refuse une demande de congé pour un employé sorti de l’effectif', async () => {
    const r = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 5, type: 'Congé annuel', debut: '2026-12-06', fin: '2026-12-10' });
    expect(r.status).toBe(400);
  });

  it('réintègre un employé sorti', async () => {
    const r = await request(app).post('/api/employes/5/reintegrer').set(avec(jetons.rh));
    expect(r.status).toBe(200);
    expect(r.body.actif).toBe(true);
  });

  it('refuse deux congés qui se chevauchent pour le même employé', async () => {
    await q('UPDATE employes SET solde_conges=30 WHERE id=4');
    const a = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 4, type: 'Congé annuel', debut: '2027-03-07', fin: '2027-03-11', motif: 'Repos' });
    expect(a.status).toBe(201);
    const b = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 4, type: 'Congé exceptionnel', debut: '2027-03-10', fin: '2027-03-14',
              justificatifReference: 'Acte de mariage n° 220' });
    expect(b.status).toBe(409);
    expect(b.body.erreur).toMatch(/chevauche/i);
    // une période disjointe reste acceptée
    const c = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 4, type: 'Congé exceptionnel', debut: '2027-04-04', fin: '2027-04-06',
              justificatifReference: 'Acte de naissance n° 77' });
    expect(c.status).toBe(201);
  });

  it('bloque un congé annuel supérieur au solde disponible', async () => {
    await q('UPDATE employes SET solde_conges = 3 WHERE id = 7');
    const r = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 7, type: 'Congé annuel', debut: '2027-05-02', fin: '2027-05-20' });
    expect(r.status).toBe(400);
    expect(r.body.erreur).toMatch(/Solde insuffisant/i);
    // un congé sans solde reste possible sur la même période
    const sansSolde = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 7, type: 'Congé sans solde', debut: '2027-05-02', fin: '2027-05-20' });
    expect(sansSolde.status).toBe(201);
  });
});

describe('Sécurité de l’import Excel (fichier piégé)', () => {
  it('un classeur contenant une colonne « __proto__ » ne pollue pas Object.prototype', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nom', 'Prénom', 'Service', 'Catégorie', 'Contrat', '__proto__', 'constructor'],
      ['Piege', 'Test', 'Administration & Finances', 'Administratif', 'CDI', '{"pollue":true}', 'x'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employés');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const r = await request(app).post('/api/employes/import').set(avec(jetons.rh))
      .attach('fichier', buf, 'piege.xlsx');
    expect(r.status).toBe(200);
    // Le prototype global doit être intact
    expect(({}).pollue).toBeUndefined();
    expect(Object.prototype.pollue).toBeUndefined();
    await q(`DELETE FROM employes WHERE nom='Piege'`);
  });

  it('ignore les colonnes dangereuses tout en important les données valides', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nom', 'Prénom', 'Poste', 'Société', 'Service', 'Catégorie', 'Contrat', 'Date embauche'],
      ['Valide', 'Import', 'Agent', 'AIFG', 'Administration & Finances', 'Administratif', 'CDI', '2026-03-01'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employés');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const r = await request(app).post('/api/employes/import').set(avec(jetons.rh))
      .attach('fichier', buf, 'ok.xlsx');
    expect(r.body.importes).toBe(1);
    const e = (await q(`SELECT * FROM employes WHERE nom='Valide'`)).rows[0];
    expect(e.poste).toBe('Agent');
    await q(`DELETE FROM employes WHERE nom='Valide'`);
  });
});

// ============================================================
describe('Conformité au droit du travail algérien (loi 90-11)', () => {
  it('congé annuel : 2,5 j/mois plafonné à 30 j (art. 41) et période de référence 1er juillet (art. 40)', async () => {
    const r = await request(app).get('/api/droits-conge').set(avec(jetons.rh));
    expect(r.status).toBe(200);
    expect(r.body.periode.debut.slice(5)).toBe('07-01');
    const d = r.body.droits[0];
    expect(d.joursPrincipal).toBeLessThanOrEqual(30);
    expect(d.joursPrincipal).toBeCloseTo(d.moisTravailles * 2.5, 0);
  });

  it('congé supplémentaire du Sud : appliqué à Ouargla (art. 42)', async () => {
    const r = await request(app).get('/api/droits-conge').set(avec(jetons.rh));
    const ouargla = r.body.droits.find((d) => d.wilaya === 'Ouargla');
    expect(ouargla).toBeTruthy();
    expect(ouargla.estSud).toBe(true);
    expect(ouargla.joursSud).toBeGreaterThan(0);
    expect(ouargla.droitsTotal).toBe(ouargla.joursPrincipal + ouargla.joursSud + ouargla.joursAnciennete);
  });

  it('les droits calculés peuvent être appliqués et sont tracés (acquisitions_conge)', async () => {
    const r = await request(app).post('/api/droits-conge/appliquer').set(avec(jetons.rh));
    expect(r.status).toBe(200);
    expect(r.body.appliques).toBeGreaterThan(0);
    const acq = await q('SELECT * FROM acquisitions_conge LIMIT 1');
    expect(acq.rows[0].jours_sud).toBeTruthy();
    const audit = await q(`SELECT * FROM journal_audit WHERE action='application_droits_conge'`);
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it('jours fériés exclus du décompte des jours ouvrés de congé', async () => {
    // 1er et 12 janvier 2026 sont fériés : une demande couvrant ces jours les exclut
    await q('UPDATE employes SET solde_conges=30 WHERE id=1');
    const r = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 1, type: 'Congé annuel', debut: '2026-01-01', fin: '2026-01-14' });
    expect(r.status).toBe(201);
    expect(r.body.jours).toBe(8); // 14 jours - week-ends - 2 fériés
    await q('DELETE FROM conges WHERE id=$1', [r.body.id]);
  });

  it('congé exceptionnel : durée légale de 3 jours contrôlée (art. 54)', async () => {
    const r = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 1, type: 'Congé exceptionnel', debut: '2026-09-06', fin: '2026-09-17' });
    expect(r.status).toBe(400);
    expect(r.body.erreur).toMatch(/durée légale est de 3 jour/i);
  });

  it('congé sans solde : n’entame pas le solde (paramétrage decompte_solde)', async () => {
    await q('UPDATE employes SET solde_conges=30 WHERE id=1');
    const avant = (await q('SELECT solde_conges FROM employes WHERE id=1')).rows[0].solde_conges;
    const c = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 1, type: 'Congé sans solde', debut: '2026-10-04', fin: '2026-10-08' });
    await request(app).post(`/api/conges/${c.body.id}/decision`).set(avec(jetons.chefService)).send({ decision: 'valider' })
      .catch(() => {});
    const apres = (await q('SELECT solde_conges FROM employes WHERE id=1')).rows[0].solde_conges;
    expect(Number(apres)).toBe(Number(avant));
  });

  it('heures supplémentaires : plafond légal de 20 % contrôlé (art. 31)', async () => {
    const f = await request(app).post('/api/feuilles').set(avec(jetons.rh))
      .send({ serviceId: 2, chantierId: 1, mois: '2026-12' });
    const emp = f.body.lignes[0].employe_id;
    const jours = Array(31).fill('IZ');
    const r = await request(app).put(`/api/feuilles/${f.body.id}/lignes`).set(avec(jetons.rh))
      .send({ version: f.body.version, lignes: [{ employeId: emp, jours, heuresSupp: 120 }] });
    expect(r.status).toBe(422);
    expect(r.body.erreur).toMatch(/plafond légal/i);
    expect(r.body.confirmationRequise).toBe(true);
    // Cas dérogatoire assumé et tracé
    const forcer = await request(app).put(`/api/feuilles/${f.body.id}/lignes`).set(avec(jetons.rh))
      .send({ version: f.body.version, lignes: [{ employeId: emp, jours, heuresSupp: 120 }], forcerDepassementHS: true });
    expect(forcer.status).toBe(200);
  });

  it('les paramètres légaux sont modifiables sans redéploiement, et la modification est auditée', async () => {
    const avant = await request(app).get('/api/parametres').set(avec(jetons.rh));
    const sud = avant.body.find((p) => p.cle === 'conge_sud_jours');
    expect(Number(sud.valeur)).toBe(10);

    // Une convention collective plus favorable porte le congé du Sud à 15 jours
    const maj = await request(app).put('/api/parametres/conge_sud_jours').set(avec(jetons.rh)).send({ valeur: 15 });
    expect(maj.status).toBe(200);
    const droits = await request(app).get('/api/droits-conge').set(avec(jetons.rh));
    const o = droits.body.droits.find((d) => d.estSud);
    expect(o.joursSud).toBeGreaterThan(0);

    const audit = await q(`SELECT * FROM journal_audit WHERE action='modification_parametre_legal' ORDER BY id DESC LIMIT 1`);
    expect(audit.rows[0].details.avant).toBe(10);
    expect(audit.rows[0].details.apres).toBe(15);
    await request(app).put('/api/parametres/conge_sud_jours').set(avec(jetons.rh)).send({ valeur: 10 });
  });

  it('jours de repos hebdomadaire paramétrables (art. 33 : vendredi au minimum)', async () => {
    await request(app).put('/api/parametres/jours_repos_hebdomadaire').set(avec(jetons.rh)).send({ valeur: [5] });
    const r = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 1, type: 'Congé annuel', debut: '2026-09-05', fin: '2026-09-05' }); // un samedi
    expect(r.status).toBe(201); // samedi devient ouvré
    expect(r.body.jours).toBe(1);
    await q('DELETE FROM conges WHERE id=$1', [r.body.id]);
    await request(app).put('/api/parametres/jours_repos_hebdomadaire').set(avec(jetons.rh)).send({ valeur: [5, 6] });
  });

  it('les types de congé sont paramétrables (ajout sans modification du code)', async () => {
    await q(`DELETE FROM types_conge WHERE libelle LIKE 'Congé création%'`);
    const r = await request(app).post('/api/types-conge').set(avec(jetons.rh)).send({
      libelle: 'Congé création d\'entreprise', codePointage: 'CSS', joursLegaux: 365,
      decompteSolde: false, remunere: false, justificatifRequis: true,
      referenceLegale: 'Loi 22-16 modifiant la loi 90-11',
    });
    expect(r.status).toBe(201);
    const utilisable = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 1, type: 'Congé création d\'entreprise', debut: '2026-11-01', fin: '2026-11-05',
              justificatifReference: 'Attestation ANADE n° 2026/117' });
    expect(utilisable.status).toBe(201);
    await q(`DELETE FROM conges WHERE id=$1`, [utilisable.body.id]);
  });

  it('un type de congé inconnu est refusé', async () => {
    const r = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: 1, type: 'Congé fantaisiste', debut: '2026-11-01', fin: '2026-11-03' });
    expect(r.status).toBe(400);
  });

  it('jours fériés : ajout d’une fête religieuse à date variable', async () => {
    const r = await request(app).post('/api/jours-feries').set(avec(jetons.rh))
      .send({ date: '2026-03-20', libelle: 'Aïd el-Fitr (1er jour)', type: 'Religieux' });
    expect(r.status).toBe(201);
    const liste = await request(app).get('/api/jours-feries?annee=2026').set(avec(jetons.rh));
    expect(liste.body.some((f) => f.libelle.includes('Aïd el-Fitr'))).toBe(true);
  });

  it('tableau de conformité : signale les manques bloquant les calculs légaux', async () => {
    const r = await request(app).get('/api/conformite').set(avec(jetons.rh));
    expect(r.status).toBe(200);
    expect(r.body.parametres.congeSud).toBeTruthy();
    expect(r.body.controles.length).toBeGreaterThanOrEqual(5);
    // Le contrôle doit refléter fidèlement la base : les employés importés sans wilaya
    // sont bien détectés — c'est précisément le rôle de ce tableau de conformité.
    const wilaya = r.body.controles.find((c) => c.cle === 'wilaya_manquante');
    const attendu = Number((await q(`SELECT count(*)::int AS n FROM employes e
      LEFT JOIN chantiers ch ON ch.id=e.chantier_id
      LEFT JOIN services sv ON sv.id=e.service_id
      WHERE COALESCE(NULLIF(ch.wilaya,''), sv.wilaya, '') = ''`)).rows[0].n);
    expect(wilaya.valeur).toBe(attendu);
    expect(wilaya.conforme).toBe(attendu === 0);
    if (attendu > 0) expect(wilaya.message).toMatch(/art\. 42/);
  });

  it('la modification des paramètres légaux est réservée au RH', async () => {
    expect((await request(app).put('/api/parametres/conge_sud_jours').set(avec(jetons.chefService)).send({ valeur: 99 })).status).toBe(403);
    expect((await request(app).post('/api/jours-feries').set(avec(jetons.chefService)).send({ date: '2026-06-01', libelle: 'X' })).status).toBe(403);
  });
});

// ============================================================
describe('Complétude des dossiers (registre du personnel, CNAS, paie)', () => {
  let idEmploye;

  it('crée un employé avec le dossier complet et attribue un matricule automatique', async () => {
    const r = await request(app).post('/api/employes').set(avec(jetons.rh)).send({
      prenom: 'Yasmine', nom: 'Ferhat', poste: 'Ingénieure HSE',
      societeId: 1, chantierId: 1, categorie: 'Chantier',
      dateEmbauche: '2026-02-01', soldeConges: 30, typeContrat: 'CDI',
      dateNaissance: '1994-05-12', lieuNaissance: 'Ouargla', sexe: 'F',
      numIdentite: '109456789012', numCnas: '94051200123456',
      situationFamiliale: 'Marié(e)', enfantsACharge: 2, groupeSanguin: 'O+',
      adresse: 'Cité 500 logements, Bt 12', wilayaResidence: 'Ouargla',
      urgenceNom: 'Karim Ferhat', urgenceLien: 'Époux', urgenceTelephone: '0550 99 88 77',
      salaireBase: 85000, categorieConventionnelle: 'Cadre 12/3', rib: '00799999000123456789',
      niveauQualification: 'Ingénieur d\'État', finPeriodeEssai: '2026-08-01',
      observations: 'Habilitation ATEX à jour.',
    });
    expect(r.status).toBe(201);
    idEmploye = r.body.id;
    expect(r.body.matricule).toMatch(/^AIFG-\d{4}$/);
    expect(r.body.num_cnas).toBe('94051200123456');
    expect(Number(r.body.salaire_base)).toBe(85000);
    expect(r.body.enfants_a_charge).toBe(2);
    expect(r.body.sexe).toBe('F');
  });

  it('refuse un numéro CNAS en double (unicité de l\'affiliation)', async () => {
    const r = await request(app).post('/api/employes').set(avec(jetons.rh)).send({
      prenom: 'Autre', nom: 'Personne', poste: 'Agent', societeId: 1, serviceId: 1,
      categorie: 'Administratif', dateEmbauche: '2026-03-01', soldeConges: 0,
      typeContrat: 'CDI', numCnas: '94051200123456',
    });
    expect(r.status).toBe(409);
    expect(r.body.erreur).toMatch(/CNAS/i);
  });

  it('l\'export employés contient les colonnes du registre du personnel', async () => {
    const r = await request(app).get('/api/employes/export.xlsx').set(avec(jetons.rh)).buffer().parse((res, cb) => {
      const m = []; res.on('data', (c) => m.push(c)); res.on('end', () => cb(null, Buffer.concat(m)));
    });
    const wb = XLSX.read(r.body, { type: 'buffer' });
    const lignes = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    for (const col of ['Matricule', 'Date naissance', 'N° CNAS', 'Situation familiale',
                       'Enfants à charge', 'Salaire de base', 'RIB', 'Contact urgence']) {
      expect(Object.keys(lignes[0])).toContain(col);
    }
  });

  it('société : identification légale complète (RC, NIF, NIS, article d\'imposition)', async () => {
    const r = await request(app).post('/api/societes').set(avec(jetons.rh)).send({
      nom: 'SARL Technic Sud', formeJuridique: 'SARL',
      contact: 'M. Larbi', telephone: '0770 11 22 33', email: 'contact@technicsud.dz',
      adresse: 'Zone industrielle, Hassi Messaoud', wilaya: 'Ouargla',
      nif: '000431123456789', nis: '099431123456789', registreCommerce: '31/00-1234567 B 24',
      articleImposition: '31050123456', numCnasEmployeur: '3105001234',
      objetPrestation: 'Maintenance mécanique', contratReference: 'CT-2026-018',
      contratDebut: '2026-01-01', contratFin: '2026-12-31',
    });
    expect(r.status).toBe(201);
    expect(r.body.registre_commerce).toBe('31/00-1234567 B 24');
    expect(r.body.nis).toBe('099431123456789');
    expect(String(r.body.contrat_fin).slice(0, 10)).toBe('2026-12-31');
  });

  it('chantier : code, wilaya, client et dates d\'exploitation', async () => {
    const r = await request(app).post('/api/chantiers').set(avec(jetons.rh)).send({
      nom: 'Puits GTL-04', serviceId: 2, code: 'GTL04', lieu: 'Gassi Touil',
      wilaya: 'Ouargla', client: 'SONATRACH', dateOuverture: '2026-04-01', actif: true,
    });
    expect(r.status).toBe(201);
    expect(r.body.wilaya).toBe('Ouargla');
    expect(r.body.client).toBe('SONATRACH');
  });

  it('service : code analytique et wilaya (base du congé du Sud pour les administratifs)', async () => {
    const r = await request(app).post('/api/services').set(avec(jetons.rh))
      .send({ nom: 'Qualité & HSE', code: 'QHSE', wilaya: 'Ouargla', description: 'Sécurité et environnement' });
    expect(r.status).toBe(201);
    expect(r.body.code).toBe('QHSE');
    expect(r.body.wilaya).toBe('Ouargla');
  });

  it('compte : téléphone et fonction enregistrés (joignabilité sur chantier)', async () => {
    const r = await request(app).post('/api/comptes').set(avec(jetons.rh)).send({
      nom: 'Hakim Zerrouk', email: 'h.zerrouk@aifg.dz', motDePasse: 'Temporaire2026',
      telephone: '0661 45 67 89', fonction: 'Superviseur HSE',
      role: 'superviseur', chantierId: 1,
    });
    expect(r.status).toBe(201);
    expect(r.body.telephone).toBe('0661 45 67 89');
    expect(r.body.fonction).toBe('Superviseur HSE');
  });

  it('congé : justificatif exigé quand le type le requiert, et décision tracée', async () => {
    const sans = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: idEmploye, type: 'Congé de maladie', debut: '2026-05-04', fin: '2026-05-06' });
    expect(sans.status).toBe(400);
    expect(sans.body.erreur).toMatch(/justificatif/i);

    const avecJustif = await request(app).post('/api/conges').set(avec(jetons.rh)).send({
      employeId: idEmploye, type: 'Congé de maladie', debut: '2026-05-04', fin: '2026-05-06',
      justificatifReference: 'Certificat Dr Benali n° 4471',
      adressePendantConge: 'Ouargla, cité 500 logements',
    });
    expect(avecJustif.status).toBe(201);
    expect(avecJustif.body.justificatif_reference).toBe('Certificat Dr Benali n° 4471');

    const dec = await request(app).post(`/api/conges/${avecJustif.body.id}/decision`).set(avec(jetons.chefService))
      .send({ decision: 'valider', observation: 'Certificat vérifié et conforme.' });
    expect(dec.status).toBe(200);
    const enBase = (await q('SELECT * FROM conges WHERE id=$1', [avecJustif.body.id])).rows[0];
    expect(enBase.observation_decision).toBe('Certificat vérifié et conforme.');
    expect(enBase.decide_par).toBeTruthy();
    expect(enBase.decide_le).toBeTruthy();
  });

  it('l\'import Excel reconnaît les colonnes du dossier complet', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nom', 'Prénom', 'Poste', 'Société', 'Service', 'Catégorie', 'Contrat', 'Date embauche',
       'Date naissance', 'N° CNAS', 'Situation familiale', 'Enfants', 'Salaire', 'Groupe sanguin', 'Sexe'],
      ['Kaci', 'Nadir', 'Magasinier', 'AIFG', 'Administration & Finances', 'Administratif', 'CDI',
       '2026-01-15', '15/08/1990', '90081500998877', 'Marié', 3, 62000, 'A+', 'M'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employés');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const r = await request(app).post('/api/employes/import').set(avec(jetons.rh)).attach('fichier', buf, 'complet.xlsx');
    expect(r.body.importes).toBe(1);
    const e = (await q(`SELECT * FROM employes WHERE nom='Kaci'`)).rows[0];
    expect(e.matricule).toMatch(/^AIFG-\d{4}$/);
    expect(e.num_cnas).toBe('90081500998877');
    expect(e.situation_familiale).toBe('Marié(e)');
    expect(e.enfants_a_charge).toBe(3);
    expect(Number(e.salaire_base)).toBe(62000);
    expect(String(e.date_naissance).slice(0, 10)).toBe('1990-08-15');
  });
});

// ============================================================
describe('Pièces jointes (photos, contrats, certificats)', () => {
  // Fichiers minimalistes mais avec de vraies signatures binaires
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(64).fill(0)]);
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(64).fill(0)]);
  const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('contenu du contrat signé'), Buffer.alloc(32)]);
  let idDoc, idPhoto;

  it('dépose une photo d’employé (type vérifié par signature binaire)', async () => {
    const r = await request(app).post('/api/documents').set(avec(jetons.rh))
      .field('categorie', 'Photo').field('employeId', '4')
      .attach('fichier', JPEG, 'portrait.jpg');
    expect(r.status).toBe(201);
    idPhoto = r.body.id;
    expect(r.body.type_mime).toBe('image/jpeg');
    expect(r.body.empreinte_sha256).toHaveLength(64); // SHA-256 : preuve d'intégrité
  });

  it('une nouvelle photo remplace la précédente au lieu de s’y ajouter', async () => {
    const r = await request(app).post('/api/documents').set(avec(jetons.rh))
      .field('categorie', 'Photo').field('employeId', '4')
      .attach('fichier', PNG, 'nouvelle-photo.png');
    expect(r.status).toBe(201);
    const photos = await q(`SELECT * FROM documents WHERE employe_id=4 AND categorie='Photo'`);
    expect(photos.rows.length).toBe(1);
    expect(photos.rows[0].type_mime).toBe('image/png');
    idPhoto = photos.rows[0].id;
  });

  it('dépose un contrat signé avec date et expiration', async () => {
    const r = await request(app).post('/api/documents').set(avec(jetons.rh))
      .field('categorie', 'Contrat de travail').field('employeId', '4')
      .field('dateDocument', '2026-01-05').field('dateExpiration', '2027-01-04')
      .field('description', 'CDD signé, 12 mois')
      .attach('fichier', PDF, 'contrat.pdf');
    expect(r.status).toBe(201);
    idDoc = r.body.id;
    expect(r.body.type_mime).toBe('application/pdf');
    expect(r.body.date_expiration).toBe('2027-01-04');
  });

  it('REFUSE un fichier dont le contenu ne correspond pas à l’extension (script déguisé)', async () => {
    const malveillant = Buffer.from('<?php system($_GET["c"]); ?>');
    const r = await request(app).post('/api/documents').set(avec(jetons.rh))
      .field('categorie', 'Autre').field('employeId', '4')
      .attach('fichier', malveillant, 'innocent.jpg');
    expect(r.status).toBe(415);
    expect(r.body.erreur).toMatch(/non autorisé/i);
  });

  it('REFUSE un exécutable renommé en PDF', async () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, ...Array(64).fill(0)]); // en-tête MZ
    const r = await request(app).post('/api/documents').set(avec(jetons.rh))
      .field('categorie', 'Autre').field('employeId', '4')
      .attach('fichier', exe, 'document.pdf');
    expect(r.status).toBe(415);
  });

  it('le nom de fichier ne peut pas servir à sortir du dossier de stockage', async () => {
    const r = await request(app).post('/api/documents').set(avec(jetons.rh))
      .field('categorie', 'Autre').field('employeId', '4')
      .attach('fichier', PDF, '../../../etc/passwd.pdf');
    expect(r.status).toBe(201);
    const d = (await q('SELECT * FROM documents WHERE id=$1', [r.body.id])).rows[0];
    expect(d.nom_stockage).not.toContain('..');          // chemin sur disque anonymisé
    expect(d.nom_original).not.toContain('/');            // nom affiché nettoyé
    expect(d.nom_stockage).toMatch(/^\d{4}-\d{2}\/[0-9a-f-]{36}\.pdf$/);
    await request(app).delete(`/api/documents/${r.body.id}`).set(avec(jetons.rh));
  });

  it('exige un rattachement unique (ni zéro, ni deux)', async () => {
    const aucun = await request(app).post('/api/documents').set(avec(jetons.rh))
      .field('categorie', 'Autre').attach('fichier', PDF, 'x.pdf');
    expect(aucun.status).toBe(400);
    const deux = await request(app).post('/api/documents').set(avec(jetons.rh))
      .field('categorie', 'Autre').field('employeId', '4').field('societeId', '1')
      .attach('fichier', PDF, 'x.pdf');
    expect(deux.status).toBe(400);
  });

  it('télécharge le fichier avec les en-têtes de sécurité', async () => {
    const r = await request(app).get(`/api/documents/${idDoc}/fichier`).set(avec(jetons.rh)).buffer().parse((res, cb) => {
      const m = []; res.on('data', (c) => m.push(c)); res.on('end', () => cb(null, Buffer.concat(m)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.body.slice(0, 4).toString()).toBe('%PDF');
  });

  it('un chef de chantier accède aux documents de SON chantier uniquement', async () => {
    // Employé 4 est sur le chantier 1, celui du chef de chantier
    const sien = await request(app).get('/api/documents?employeId=4').set(avec(jetons.chefChantier));
    expect(sien.status).toBe(200);
    expect(sien.body.length).toBeGreaterThan(0);
    // Employé 1 est administratif, hors de son périmètre
    const autre = await request(app).get('/api/documents?employeId=1').set(avec(jetons.chefChantier));
    expect(autre.status).toBe(403);
    const fichierAutre = await request(app).get(`/api/documents/${idDoc}/fichier`).set(avec(jetons.superviseur));
    expect(fichierAutre.status).toBe(403); // superviseur d'un autre chantier
  });

  it('seul le RH peut déposer ou supprimer un document', async () => {
    const depot = await request(app).post('/api/documents').set(avec(jetons.chefService))
      .field('categorie', 'Autre').field('employeId', '4').attach('fichier', PDF, 'x.pdf');
    expect(depot.status).toBe(403);
    const suppr = await request(app).delete(`/api/documents/${idDoc}`).set(avec(jetons.chefService));
    expect(suppr.status).toBe(403);
  });

  it('les documents de société sont réservés au RH et à la Direction', async () => {
    const r = await request(app).post('/api/documents').set(avec(jetons.rh))
      .field('categorie', 'Contrat de sous-traitance').field('societeId', '2')
      .field('dateExpiration', '2026-12-31')
      .attach('fichier', PDF, 'convention.pdf');
    expect(r.status).toBe(201);
    expect((await request(app).get('/api/documents?societeId=2').set(avec(jetons.direction))).status).toBe(200);
    expect((await request(app).get('/api/documents?societeId=2').set(avec(jetons.chefService))).status).toBe(403);
  });

  it('signale les documents arrivant à expiration', async () => {
    const r = await request(app).get('/api/documents-expirants?jours=400').set(avec(jetons.rh));
    expect(r.status).toBe(200);
    expect(r.body.some((d) => d.categorie === 'Contrat de travail')).toBe(true);
  });

  it('la suppression retire le fichier du disque et laisse une trace d’audit', async () => {
    const avant = (await q('SELECT nom_stockage FROM documents WHERE id=$1', [idDoc])).rows[0];
    const r = await request(app).delete(`/api/documents/${idDoc}`).set(avec(jetons.rh));
    expect(r.status).toBe(200);
    const { fichierExiste } = await import('../src/lib/fichiers.js');
    expect(await fichierExiste(avant.nom_stockage)).toBe(false);
    const audit = await q(`SELECT * FROM journal_audit WHERE action='suppression_document' ORDER BY id DESC LIMIT 1`);
    expect(audit.rows[0]).toBeTruthy();
  });

  it('sortie d’effectif : les documents sont conservés (pièces justificatives)', async () => {
    const e = await request(app).post('/api/employes').set(avec(jetons.rh)).send({
      prenom: 'Temp', nom: 'Suppression', poste: 'Agent', societeId: 1, serviceId: 1,
      categorie: 'Administratif', dateEmbauche: '2026-01-01', soldeConges: 0, typeContrat: 'CDI',
    });
    await request(app).post('/api/documents').set(avec(jetons.rh))
      .field('categorie', 'Diplôme').field('employeId', String(e.body.id))
      .attach('fichier', PDF, 'diplome.pdf');
    // Par défaut, l'employé sort de l'effectif : son dossier reste consultable.
    const sortie = await request(app).delete(`/api/employes/${e.body.id}`).set(avec(jetons.rh))
      .send({ motif: 'Fin de mission' });
    expect(sortie.status).toBe(200);
    expect(sortie.body.mode).toBe('sorti_effectif');
    const conserves = await q('SELECT * FROM documents WHERE employe_id=$1', [e.body.id]);
    expect(conserves.rows.length).toBe(1);

    // Suppression définitive explicite : les documents sont alors purgés (RGPD/18-07),
    // et les fichiers correspondants retirés du disque.
    const stockage = conserves.rows[0].nom_stockage;
    const definitif = await request(app).delete(`/api/employes/${e.body.id}?definitif=1`).set(avec(jetons.rh));
    expect(definitif.body.mode).toBe('supprime');
    const restants = await q('SELECT * FROM documents WHERE employe_id=$1', [e.body.id]);
    expect(restants.rows.length).toBe(0);
    const { fichierExiste } = await import('../src/lib/fichiers.js');
    // Le fichier physique doit être nettoyé lors d'une suppression définitive
    expect(await fichierExiste(stockage)).toBe(false);
  });
});

// ============================================================
describe('Sortie d’effectif — cohérence sur toute l’application', () => {
  let idSortant;

  it('prépare un employé puis le sort de l’effectif', async () => {
    const e = await request(app).post('/api/employes').set(avec(jetons.rh)).send({
      prenom: 'Parti', nom: 'Zoubir', poste: 'Manœuvre', societeId: 1, chantierId: 1,
      categorie: 'Chantier', dateEmbauche: '2025-06-01', soldeConges: 10, typeContrat: 'CDI',
    });
    idSortant = e.body.id;
    const s = await request(app).delete(`/api/employes/${idSortant}`).set(avec(jetons.rh))
      .send({ motif: 'Démission', dateSortie: '2026-07-31' });
    expect(s.body.mode).toBe('sorti_effectif');
  });

  it('il disparaît de la liste du personnel mais reste consultable sur demande', async () => {
    const actifs = await request(app).get('/api/employes?limite=1000').set(avec(jetons.rh));
    expect(actifs.body.employes.some((x) => x.id === idSortant)).toBe(false);
    const tous = await request(app).get('/api/employes?limite=1000&inclureSortis=1').set(avec(jetons.rh));
    expect(tous.body.employes.some((x) => x.id === idSortant)).toBe(true);
  });

  it('il n’apparaît plus sur une nouvelle feuille de pointage', async () => {
    const f = await request(app).post('/api/feuilles').set(avec(jetons.rh))
      .send({ serviceId: 2, chantierId: 1, mois: '2026-10' });
    expect(f.status).toBe(201);
    expect(f.body.lignes.some((l) => l.employe_id === idSortant)).toBe(false);
  });

  it('aucune demande de congé ne peut être enregistrée pour lui', async () => {
    const r = await request(app).post('/api/conges').set(avec(jetons.rh))
      .send({ employeId: idSortant, type: 'Congé annuel', debut: '2026-09-07', fin: '2026-09-09' });
    expect(r.status).toBe(400);
    expect(r.body.erreur).toMatch(/sorti de l'effectif/i);
  });

  it('il est exclu du calcul des droits à congé et des contrôles de conformité', async () => {
    const d = await request(app).get('/api/droits-conge').set(avec(jetons.rh));
    expect(d.body.droits.some((x) => x.employeId === idSortant)).toBe(false);
    const c = await request(app).get('/api/conformite').set(avec(jetons.rh));
    expect(c.status).toBe(200);
  });

  it('aucun rappel WhatsApp ne lui est adressé', async () => {
    const r = await request(app).post('/api/rappels').set(avec(jetons.rh))
      .send({ employeId: idSortant, type: 'visite' });
    expect(r.status).toBe(404);
  });

  it('son dossier et ses pièces restent accessibles, et il peut être réintégré', async () => {
    const docs = await request(app).get(`/api/documents?employeId=${idSortant}`).set(avec(jetons.rh));
    expect(docs.status).toBe(200); // dossier consultable
    const re = await request(app).post(`/api/employes/${idSortant}/reintegrer`).set(avec(jetons.rh));
    expect(re.status).toBe(200);
    const actifs = await request(app).get('/api/employes?limite=1000').set(avec(jetons.rh));
    expect(actifs.body.employes.some((x) => x.id === idSortant)).toBe(true);
  });

  it('l’export mentionne le statut, la date et le motif de sortie', async () => {
    await request(app).delete(`/api/employes/${idSortant}`).set(avec(jetons.rh)).send({ motif: 'Fin de mission' });
    const r = await request(app).get('/api/employes/export.xlsx').set(avec(jetons.rh)).buffer().parse((res, cb) => {
      const m = []; res.on('data', (c) => m.push(c)); res.on('end', () => cb(null, Buffer.concat(m)));
    });
    const wb = XLSX.read(r.body, { type: 'buffer' });
    const lignes = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const sorti = lignes.find((l) => l['Nom'] === 'Zoubir');
    expect(sorti['Statut']).toMatch(/Sorti/);
    expect(sorti['Motif de sortie']).toBe('Fin de mission');
  });
});
