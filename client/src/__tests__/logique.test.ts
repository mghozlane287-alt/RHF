import { describe, it, expect } from 'vitest';
import { codeTheorique, joursOuvres, joursRestants, nbJoursMois, prochainCode, telVersWa, lienWhatsApp, lienEmail, initiales, libelleMois, CODES } from '@/data';
import type { Employe, Rotation } from '@/data';

// Référentiel de rotations pour les tests (en production il vient de l'API)
const rotationsInitiales: Rotation[] = [
  { id: 1, nom: '4×4 (28 j travail / 28 j repos)', joursTravail: 28, joursRepos: 28 },
  { id: 2, nom: '20/10', joursTravail: 20, joursRepos: 10 },
  { id: 3, nom: '6×2 (6 j travail / 2 j repos)', joursTravail: 6, joursRepos: 2 },
];
import { echapperHtml, protegerCelluleExcel, protegerLigneExcel } from '@/lib/securite';
import { versISO } from '@/lib/excel';

const dossierVide = {
  matricule: '', dateNaissance: '', lieuNaissance: '', sexe: 'M' as const,
  numIdentite: '', numCnas: '', situationFamiliale: 'Célibataire' as const,
  enfantsACharge: 0, groupeSanguin: '', adresse: '', wilayaResidence: '',
  urgenceNom: '', urgenceLien: '', urgenceTelephone: '',
  salaireBase: 0, categorieConventionnelle: '', rib: '',
  niveauQualification: '', finPeriodeEssai: '', observations: '',
};

const empChantier = (debutCycle: string, rotationId: number): Employe => ({
  id: 99, prenom: 'Test', nom: 'Chantier', poste: 'Opérateur',
  societeId: 1, serviceId: 2, chantierId: 1, categorie: 'Chantier',
  rotationId, debutCycle, email: '', telephone: '', dateEmbauche: '2020-01-01',
  soldeConges: 30, typeContrat: 'CDI', finContrat: '', prochaineVisiteMedicale: '',
  ...dossierVide,
});

const empAdmin: Employe = {
  id: 98, prenom: 'Test', nom: 'Admin', poste: 'Assistant',
  societeId: 1, serviceId: 1, chantierId: null, categorie: 'Administratif',
  rotationId: null, debutCycle: '', email: '', telephone: '', dateEmbauche: '2020-01-01',
  soldeConges: 30, typeContrat: 'CDI', finContrat: '', prochaineVisiteMedicale: '',
  ...dossierVide,
};

describe('Calendrier et jours ouvrés (week-end vendredi/samedi — Algérie)', () => {
  it('compte les jours ouvrés en excluant vendredi et samedi', () => {
    // Du dimanche 2026-08-02 au samedi 2026-08-08 : dim→jeu = 5 ouvrés, ven+sam exclus
    expect(joursOuvres('2026-08-02', '2026-08-08')).toBe(5);
  });
  it('retourne 0 si la fin précède le début ou si une date est invalide', () => {
    expect(joursOuvres('2026-08-10', '2026-08-01')).toBe(0);
    expect(joursOuvres('invalide', '2026-08-01')).toBe(0);
  });
  it('connaît le nombre de jours de chaque mois (année bissextile incluse)', () => {
    expect(nbJoursMois('2026-08')).toBe(31);
    expect(nbJoursMois('2026-02')).toBe(28);
    expect(nbJoursMois('2028-02')).toBe(29);
  });
  it('formate le libellé du mois en français', () => {
    expect(libelleMois('2026-08')).toBe('août 2026');
  });
});

describe('Rotations (pré-remplissage du pointage)', () => {
  it('rotation 28/28 : IZ pendant 28 jours puis CR pendant 28 jours', () => {
    const e = empChantier('2026-07-13', 1); // rotation 28/28
    expect(codeTheorique(e, rotationsInitiales, '2026-07-13')).toBe('IZ'); // jour 0
    expect(codeTheorique(e, rotationsInitiales, '2026-08-09')).toBe('IZ'); // jour 27
    expect(codeTheorique(e, rotationsInitiales, '2026-08-10')).toBe('CR'); // jour 28 → repos
    expect(codeTheorique(e, rotationsInitiales, '2026-09-06')).toBe('CR'); // jour 55
    expect(codeTheorique(e, rotationsInitiales, '2026-09-07')).toBe('IZ'); // jour 56 → nouveau cycle
  });
  it('rotation 6/2 : cycle de 8 jours', () => {
    const e = empChantier('2026-08-03', 3);
    expect(codeTheorique(e, rotationsInitiales, '2026-08-03')).toBe('IZ');
    expect(codeTheorique(e, rotationsInitiales, '2026-08-08')).toBe('IZ'); // 6e jour de travail
    expect(codeTheorique(e, rotationsInitiales, '2026-08-09')).toBe('CR'); // repos 1
    expect(codeTheorique(e, rotationsInitiales, '2026-08-10')).toBe('CR'); // repos 2
    expect(codeTheorique(e, rotationsInitiales, '2026-08-11')).toBe('IZ'); // cycle suivant
  });
  it('fonctionne pour une date antérieure au début de cycle (modulo négatif)', () => {
    const e = empChantier('2026-08-10', 3);
    expect(['IZ', 'CR']).toContain(codeTheorique(e, rotationsInitiales, '2026-08-01'));
  });
  it('administratif : P en semaine, CR le vendredi et le samedi', () => {
    expect(codeTheorique(empAdmin, rotationsInitiales, '2026-08-05')).toBe('P');  // mercredi
    expect(codeTheorique(empAdmin, rotationsInitiales, '2026-08-07')).toBe('CR'); // vendredi
    expect(codeTheorique(empAdmin, rotationsInitiales, '2026-08-08')).toBe('CR'); // samedi
    expect(codeTheorique(empAdmin, rotationsInitiales, '2026-08-09')).toBe('P');  // dimanche = ouvré
  });
});

describe('Codes de pointage', () => {
  it('contient exactement les 10 codes demandés', () => {
    expect(CODES.map((c) => c.code)).toEqual(['P', 'IZ', 'CR', 'CA', 'CE', 'M', 'A', 'S', 'CSS', 'MAP']);
  });
  it('prochainCode boucle sur tous les codes puis revient au premier', () => {
    let c = CODES[0].code;
    const vus = [c];
    for (let i = 0; i < CODES.length - 1; i++) { c = prochainCode(c); vus.push(c); }
    expect(new Set(vus).size).toBe(CODES.length);
    expect(prochainCode(c)).toBe('P');
  });
});

describe('WhatsApp et e-mail', () => {
  it('convertit un numéro algérien 05xx au format international 213', () => {
    expect(telVersWa('0550 12 34 56')).toBe('213550123456');
    expect(telVersWa('0771-09-88-77')).toBe('213771098877');
    expect(telVersWa('+213 661 22 87 09')).toBe('213661228709');
    expect(telVersWa('')).toBe('');
  });
  it('construit un lien wa.me encodé', () => {
    const l = lienWhatsApp('0550 12 34 56', 'Bonjour & bienvenue');
    expect(l).toContain('https://wa.me/213550123456?text=');
    expect(l).toContain(encodeURIComponent('&'));
  });
  it('construit un lien mailto encodé', () => {
    const l = lienEmail('rh@aifg.dz', 'Sujet & test', 'Corps');
    expect(l.startsWith('mailto:rh@aifg.dz?subject=')).toBe(true);
    expect(l).toContain(encodeURIComponent('&'));
  });
});

describe('Alertes (contrats et visites médicales)', () => {
  it('joursRestants : négatif si la date est passée, Infinity si absente', () => {
    expect(joursRestants('2000-01-01')).toBeLessThan(0);
    expect(joursRestants('')).toBe(Infinity);
    const dans10j = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    expect(joursRestants(dans10j)).toBeGreaterThanOrEqual(9);
    expect(joursRestants(dans10j)).toBeLessThanOrEqual(11);
  });
});

describe('Sécurité', () => {
  it("echapperHtml neutralise les balises et guillemets (anti-XSS à l'impression)", () => {
    expect(echapperHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(echapperHtml(`"quotes" & 'apostrophes'`)).toBe('&quot;quotes&quot; &amp; &#39;apostrophes&#39;');
    expect(echapperHtml(null)).toBe('');
  });
  it('protegerCelluleExcel neutralise les formules (=, +, -, @)', () => {
    expect(protegerCelluleExcel('=CMD|calc')).toBe("'=CMD|calc");
    expect(protegerCelluleExcel('+1+1')).toBe("'+1+1");
    expect(protegerCelluleExcel('-2')).toBe("'-2");
    expect(protegerCelluleExcel('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(protegerCelluleExcel('Benali')).toBe('Benali');
    expect(protegerCelluleExcel(42)).toBe(42);
  });
  it('protegerLigneExcel traite toutes les colonnes', () => {
    const l = protegerLigneExcel({ Nom: '=DANGER', Poste: 'Soudeur', Solde: 12 });
    expect(l['Nom']).toBe("'=DANGER");
    expect(l['Poste']).toBe('Soudeur');
    expect(l['Solde']).toBe(12);
  });
});

describe("Import Excel — analyse des dates", () => {
  it('accepte AAAA-MM-JJ, JJ/MM/AAAA et les objets Date', () => {
    expect(versISO('2026-08-15')).toBe('2026-08-15');
    expect(versISO('15/08/2026')).toBe('2026-08-15');
    expect(versISO('5/8/2026')).toBe('2026-08-05');
    expect(versISO(new Date(2026, 7, 15))).toBe('2026-08-15');
    expect(versISO('')).toBe('');
    expect(versISO('pas une date')).toBe('');
  });
});

describe('Divers', () => {
  it('initiales gère les noms courts et vides', () => {
    expect(initiales({ prenom: 'Amina', nom: 'Benali' })).toBe('AB');
    expect(initiales({ prenom: 'A', nom: '' })).toBe('A');
  });
});
