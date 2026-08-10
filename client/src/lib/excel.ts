import * as XLSX from 'xlsx';
import { protegerLigneExcel } from '@/lib/securite';
import { CODES, CODES_TRAVAILLES } from '@/data';
import type { Categorie, Chantier, Employe, Feuille, Rotation, Service, Societe, TypeContrat } from '@/data';

// ---------- helpers ----------
export function versISO(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v.getTime())) {
    const tz = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
    return tz.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    // date sérielle Excel
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    return '';
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // JJ/MM/AAAA
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

function telecharger(wb: XLSX.WorkBook, nom: string) {
  XLSX.writeFile(wb, nom);
}

// ---------- Export paie (feuille de pointage) ----------
export function exporterPaie(
  feuille: Feuille, service: Service, employes: Employe[], societes: Societe[], chantier: Chantier | null
) {
  const lignes = feuille.lignes.map((l) => {
    const e = employes.find((x) => x.id === l.employeId);
    const compte: Record<string, number> = {};
    CODES.forEach((c) => { compte[c.code] = l.jours.filter((j) => j === c.code).length; });
    const travailles = l.jours.filter((j) => CODES_TRAVAILLES.includes(j)).length;
    return {
      'Matricule': l.employeId,
      'Nom': e?.nom ?? '?', 'Prénom': e?.prenom ?? '', 'Poste': e?.poste ?? '',
      'Société': societes.find((s) => s.id === e?.societeId)?.nom ?? '',
      'Service': service.nom,
      'Chantier': chantier?.nom ?? 'Personnel administratif',
      'P (on base)': compte['P'], 'IZ (on chantier)': compte['IZ'],
      'CR': compte['CR'], 'CA': compte['CA'], 'CE': compte['CE'],
      'M': compte['M'], 'A': compte['A'], 'S': compte['S'],
      'CSS': compte['CSS'], 'MAP': compte['MAP'],
      'Jours travaillés (P+IZ)': travailles,
      'Heures supplémentaires': l.heuresSupp ?? 0,
    };
  });
  const ws = XLSX.utils.json_to_sheet(lignes.map(protegerLigneExcel));
  ws['!cols'] = Object.keys(lignes[0] ?? {}).map((k) => ({ wch: Math.max(10, k.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Paie');
  const scope = chantier ? chantier.nom : service.nom;
  telecharger(wb, `paie_${scope.replace(/[^\w]+/g, '_')}_${feuille.mois}.xlsx`);
}

// ---------- Export liste employés ----------
export function exporterEmployes(
  employes: Employe[], societes: Societe[], services: Service[], chantiers: Chantier[], rotations: Rotation[]
) {
  const lignes = employes.map((e) => ({
    'Nom': e.nom, 'Prénom': e.prenom, 'Poste': e.poste,
    'Société': societes.find((s) => s.id === e.societeId)?.nom ?? '',
    'Service': services.find((s) => s.id === e.serviceId)?.nom ?? '',
    'Chantier': chantiers.find((c) => c.id === e.chantierId)?.nom ?? '',
    'Catégorie': e.categorie,
    'Rotation': rotations.find((r) => r.id === e.rotationId)?.nom ?? '',
    'Début cycle': e.debutCycle,
    'Email': e.email, 'Téléphone': e.telephone,
    'Date embauche': e.dateEmbauche, 'Solde congés': e.soldeConges,
    'Contrat': e.typeContrat, 'Fin contrat': e.finContrat,
    'Prochaine visite médicale': e.prochaineVisiteMedicale,
  }));
  const ws = XLSX.utils.json_to_sheet(lignes.map(protegerLigneExcel));
  ws['!cols'] = Object.keys(lignes[0] ?? { A: '' }).map((k) => ({ wch: Math.max(12, k.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employés');
  telecharger(wb, 'employes_aifg.xlsx');
}

// ---------- Modèle d'import ----------
export function telechargerModele() {
  const exemple = [{
    'Nom': 'Benmoussa', 'Prénom': 'Ahmed', 'Poste': 'Mécanicien engins',
    'Société': 'SARL Sahara Services', 'Service': 'Chantier Nord — Forage', 'Chantier': 'Puits HBK-12',
    'Catégorie': 'Chantier', 'Rotation': '4×4 (28 j travail / 28 j repos)',
    'Début cycle': '2026-08-10', 'Email': 'a.benmoussa@exemple.dz', 'Téléphone': '0550 00 00 00',
    'Date embauche': '2026-08-01', 'Solde congés': 30,
    'Contrat': 'CDD', 'Fin contrat': '2027-07-31', 'Prochaine visite médicale': '2026-09-01',
  }];
  const ws = XLSX.utils.json_to_sheet(exemple.map(protegerLigneExcel));
  ws['!cols'] = Object.keys(exemple[0]).map((k) => ({ wch: Math.max(14, k.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employés');
  telecharger(wb, 'modele_import_employes.xlsx');
}

// ---------- Import employés ----------
export interface ResultatImport {
  employes: Employe[];
  nouvellesSocietes: Societe[];
  nouveauxServices: Service[];
  nouveauxChantiers: Chantier[];
  ignores: { ligne: number; raison: string }[];
}

export async function importerEmployes(
  fichier: File,
  existants: { employes: Employe[]; societes: Societe[]; services: Service[]; chantiers: Chantier[]; rotations: Rotation[] }
): Promise<ResultatImport> {
  const buf = await fichier.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const brut = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  const societes = [...existants.societes];
  const services = [...existants.services];
  const chantiers = [...existants.chantiers];
  const nouvellesSocietes: Societe[] = [];
  const nouveauxServices: Service[] = [];
  const nouveauxChantiers: Chantier[] = [];
  const ignores: ResultatImport['ignores'] = [];
  const employes: Employe[] = [];
  let idEmp = Math.max(0, ...existants.employes.map((e) => e.id));

  const val = (r: Record<string, unknown>, ...cles: string[]) => {
    for (const k of Object.keys(r)) {
      if (cles.some((c) => k.trim().toLowerCase() === c.toLowerCase())) return r[k];
    }
    return '';
  };

  brut.forEach((r, i) => {
    const nom = String(val(r, 'Nom') ?? '').trim();
    const prenom = String(val(r, 'Prénom', 'Prenom') ?? '').trim();
    if (!nom && !prenom) return; // ligne vide
    if (!nom || !prenom) { ignores.push({ ligne: i + 2, raison: 'Nom ou prénom manquant.' }); return; }

    const nomSoc = String(val(r, 'Société', 'Societe') ?? '').trim() || 'AIFG';
    let soc = societes.find((s) => s.nom.toLowerCase() === nomSoc.toLowerCase());
    if (!soc) {
      soc = { id: Math.max(0, ...societes.map((s) => s.id)) + 1, nom: nomSoc, type: 'Sous-traitance', contact: '', telephone: '', nif: '' };
      societes.push(soc); nouvellesSocietes.push(soc);
    }

    const nomSrv = String(val(r, 'Service') ?? '').trim();
    if (!nomSrv) { ignores.push({ ligne: i + 2, raison: 'Service manquant.' }); return; }
    let srv = services.find((s) => s.nom.toLowerCase() === nomSrv.toLowerCase());
    if (!srv) {
      srv = { id: Math.max(0, ...services.map((s) => s.id)) + 1, nom: nomSrv };
      services.push(srv); nouveauxServices.push(srv);
    }

    const catBrut = String(val(r, 'Catégorie', 'Categorie') ?? '').trim().toLowerCase();
    const categorie: Categorie = catBrut.startsWith('admin') ? 'Administratif' : 'Chantier';

    let chantierId: number | null = null;
    const nomChantier = String(val(r, 'Chantier') ?? '').trim();
    if (categorie === 'Chantier' && nomChantier) {
      let ch = chantiers.find((x) => x.nom.toLowerCase() === nomChantier.toLowerCase());
      if (!ch) {
        ch = { id: Math.max(0, ...chantiers.map((x) => x.id)) + 1, nom: nomChantier, serviceId: srv.id, lieu: '' };
        chantiers.push(ch); nouveauxChantiers.push(ch);
      }
      chantierId = ch.id;
    }

    const nomRot = String(val(r, 'Rotation') ?? '').trim();
    const rot = existants.rotations.find((x) => x.nom.toLowerCase() === nomRot.toLowerCase()) ?? null;

    const contratBrut = String(val(r, 'Contrat', 'Type contrat') ?? '').trim().toUpperCase();
    const typeContrat: TypeContrat = contratBrut === 'CDD' ? 'CDD' : 'CDI';

    idEmp += 1;
    employes.push({
      id: idEmp, nom, prenom,
      poste: String(val(r, 'Poste') ?? '').trim() || '—',
      societeId: soc.id, serviceId: chantierId ? (chantiers.find((x) => x.id === chantierId)?.serviceId ?? srv.id) : srv.id, chantierId, categorie,
      rotationId: categorie === 'Chantier' ? (rot?.id ?? null) : null,
      debutCycle: categorie === 'Chantier' ? versISO(val(r, 'Début cycle', 'Debut cycle')) : '',
      email: String(val(r, 'Email', 'E-mail') ?? '').trim(),
      telephone: String(val(r, 'Téléphone', 'Telephone') ?? '').trim(),
      dateEmbauche: versISO(val(r, 'Date embauche', "Date d'embauche")) || new Date().toISOString().slice(0, 10),
      soldeConges: Number(val(r, 'Solde congés', 'Solde conges')) || 0,
      typeContrat,
      finContrat: typeContrat === 'CDD' ? versISO(val(r, 'Fin contrat')) : '',
      prochaineVisiteMedicale: versISO(val(r, 'Prochaine visite médicale', 'Visite médicale', 'Visite medicale')),
    });
  });

  return { employes, nouvellesSocietes, nouveauxServices, nouveauxChantiers, ignores };
}
