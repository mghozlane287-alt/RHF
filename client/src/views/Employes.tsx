import { useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatDate, initiales, joursRestants } from '@/data';
import { GROUPES_SANGUINS, SITUATIONS_FAMILIALES, WILAYAS } from '@/data';
import type { Categorie, Chantier, Employe, Rotation, Service, SituationFamiliale, Societe, TypeContrat } from '@/data';
import { telechargerModele } from '@/lib/excel';
import type { Actions } from '@/lib/donnees';
import { Search, UserPlus, Pencil, UserMinus, FileSpreadsheet, Upload, Download, FileDown } from 'lucide-react';

interface Props {
  actions: Actions;
  employes: Employe[];
  societes: Societe[];
  services: Service[];
  chantiers: Chantier[];
  rotations: Rotation[];
  lectureSeule: boolean;
  monServiceId: number | null;
}

const FORM_VIDE = {
  // Identité
  prenom: '', nom: '', matricule: '', dateNaissance: '', lieuNaissance: '',
  sexe: 'M' as 'M' | 'F', numIdentite: '', numCnas: '',
  situationFamiliale: 'Célibataire' as SituationFamiliale, enfantsACharge: 0, groupeSanguin: '',
  // Coordonnées
  adresse: '', wilayaResidence: '', email: '', telephone: '',
  urgenceNom: '', urgenceLien: '', urgenceTelephone: '',
  // Affectation
  poste: '', societeId: '', serviceId: '', categorie: 'Chantier' as Categorie,
  chantierId: '', rotationId: '', debutCycle: '',
  // Contrat et paie
  dateEmbauche: '', typeContrat: 'CDI' as TypeContrat, finContrat: '', finPeriodeEssai: '',
  niveauQualification: '', categorieConventionnelle: '', salaireBase: 0, rib: '',
  soldeConges: 30, prochaineVisiteMedicale: '', observations: '',
};

export default function Employes({ actions, employes, societes, services, chantiers, rotations, lectureSeule, monServiceId }: Props) {
  const [recherche, setRecherche] = useState('');
  const [filtreSoc, setFiltreSoc] = useState('toutes');
  const [voirSortis, setVoirSortis] = useState(false);
  const [edit, setEdit] = useState<Employe | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [form, setForm] = useState({ ...FORM_VIDE });
  const [erreur, setErreur] = useState('');
  const [rapportImport, setRapportImport] = useState<string | null>(null);
  const inputFichier = useRef<HTMLInputElement>(null);

  const nomSoc = (id: number) => societes.find((s) => s.id === id)?.nom ?? '—';
  const nomSrv = (id: number) => services.find((s) => s.id === id)?.nom ?? '—';
  const nomRot = (id: number | null) => rotations.find((r) => r.id === id)?.nom ?? '—';

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return employes.filter((e) => {
      if (!voirSortis && !e.actif) return false;
      if (monServiceId && e.serviceId !== monServiceId) return false;
      if (filtreSoc !== 'toutes' && e.societeId !== Number(filtreSoc)) return false;
      return !q || `${e.prenom} ${e.nom} ${e.poste} ${nomSoc(e.societeId)} ${nomSrv(e.serviceId)}`.toLowerCase().includes(q);
    });
  }, [employes, recherche, filtreSoc, monServiceId, voirSortis]);

  const ouvrir = (e?: Employe) => {
    setEdit(e ?? null);
    setForm(e ? {
      prenom: e.prenom, nom: e.nom, matricule: e.matricule, dateNaissance: e.dateNaissance,
      lieuNaissance: e.lieuNaissance, sexe: e.sexe, numIdentite: e.numIdentite, numCnas: e.numCnas,
      situationFamiliale: e.situationFamiliale, enfantsACharge: e.enfantsACharge,
      groupeSanguin: e.groupeSanguin, adresse: e.adresse, wilayaResidence: e.wilayaResidence,
      email: e.email, telephone: e.telephone, urgenceNom: e.urgenceNom,
      urgenceLien: e.urgenceLien, urgenceTelephone: e.urgenceTelephone,
      poste: e.poste, societeId: String(e.societeId), serviceId: String(e.serviceId),
      categorie: e.categorie, chantierId: e.chantierId ? String(e.chantierId) : '',
      rotationId: e.rotationId ? String(e.rotationId) : '', debutCycle: e.debutCycle,
      dateEmbauche: e.dateEmbauche, typeContrat: e.typeContrat, finContrat: e.finContrat,
      finPeriodeEssai: e.finPeriodeEssai, niveauQualification: e.niveauQualification,
      categorieConventionnelle: e.categorieConventionnelle, salaireBase: e.salaireBase,
      rib: e.rib, soldeConges: e.soldeConges, prochaineVisiteMedicale: e.prochaineVisiteMedicale,
      observations: e.observations,
    } : { ...FORM_VIDE });
    setErreur(''); setOuvert(true);
  };

  const sauver = async () => {
    const chantierChoisi = form.categorie === 'Chantier' ? chantiers.find((c) => c.id === Number(form.chantierId)) : null;
    if (!form.prenom.trim() || !form.nom.trim() || !form.poste.trim() || !form.societeId || !form.dateEmbauche) {
      setErreur("Champs obligatoires : prénom, nom, poste, société et date d'embauche."); return;
    }
    if (form.categorie === 'Chantier' && !chantierChoisi) {
      setErreur('Choisissez le chantier d\'affectation (le service en découle automatiquement).'); return;
    }
    if (form.categorie === 'Administratif' && !form.serviceId) {
      setErreur('Choisissez le service d\'affectation.'); return;
    }
    if (form.categorie === 'Chantier' && form.rotationId && !form.debutCycle) {
      setErreur('Précisez la date de début du cycle de rotation.'); return;
    }
    if (form.typeContrat === 'CDD' && !form.finContrat) {
      setErreur('Un CDD doit avoir une date de fin de contrat.'); return;
    }
    const data = {
      prenom: form.prenom.trim(), nom: form.nom.trim(), poste: form.poste.trim(),
      societeId: Number(form.societeId),
      serviceId: chantierChoisi ? chantierChoisi.serviceId : Number(form.serviceId),
      chantierId: chantierChoisi ? chantierChoisi.id : null,
      categorie: form.categorie,
      rotationId: form.categorie === 'Chantier' && form.rotationId ? Number(form.rotationId) : null,
      debutCycle: form.categorie === 'Chantier' && form.debutCycle ? form.debutCycle : null,
      email: form.email.trim(), telephone: form.telephone.trim(),
      dateEmbauche: form.dateEmbauche, soldeConges: Number(form.soldeConges) || 0,
      typeContrat: form.typeContrat,
      finContrat: form.typeContrat === 'CDD' ? form.finContrat : null,
      prochaineVisiteMedicale: form.prochaineVisiteMedicale || null,
      matricule: form.matricule.trim(),
      dateNaissance: form.dateNaissance || null,
      lieuNaissance: form.lieuNaissance.trim(), sexe: form.sexe,
      numIdentite: form.numIdentite.trim(), numCnas: form.numCnas.trim(),
      situationFamiliale: form.situationFamiliale,
      enfantsACharge: Number(form.enfantsACharge) || 0,
      groupeSanguin: form.groupeSanguin, adresse: form.adresse.trim(),
      wilayaResidence: form.wilayaResidence,
      urgenceNom: form.urgenceNom.trim(), urgenceLien: form.urgenceLien.trim(),
      urgenceTelephone: form.urgenceTelephone.trim(),
      salaireBase: Number(form.salaireBase) || 0,
      categorieConventionnelle: form.categorieConventionnelle.trim(),
      rib: form.rib.trim(), niveauQualification: form.niveauQualification.trim(),
      finPeriodeEssai: form.finPeriodeEssai || null,
      observations: form.observations.trim(),
    };
    const r = edit ? await actions.modifierEmploye(edit.id, data) : await actions.creerEmploye(data);
    if (r) setOuvert(false);
  };

  // Sortie d'effectif : l'employé n'est jamais supprimé, car ses feuilles de pointage
  // archivées sont des pièces justificatives de paie à conserver.
  const [sortie, setSortie] = useState<Employe | null>(null);
  const [motifSortie, setMotifSortie] = useState('');
  const [dateSortie, setDateSortie] = useState(new Date().toISOString().slice(0, 10));

  const confirmerSortie = async () => {
    if (!sortie) return;
    const r = await actions.sortirEffectif(sortie.id, motifSortie.trim(), dateSortie);
    if (r) { setSortie(null); setMotifSortie(''); }
  };

  const importer = async (fichier: File) => {
    const res = await actions.importerEmployes(fichier);
    if (!res) return;
    const parties = [`${res.importes} employé(s) importé(s).`];
    if (res.societesCreees.length) parties.push(`Sociétés créées : ${res.societesCreees.join(', ')}.`);
    if (res.servicesCrees.length) parties.push(`Services créés : ${res.servicesCrees.join(', ')}.`);
    if (res.chantiersCrees.length) parties.push(`Chantiers créés : ${res.chantiersCrees.join(', ')}.`);
    if (res.ignores.length) parties.push(`${res.ignores.length} ligne(s) ignorée(s) : ${res.ignores.map((x) => `ligne ${x.ligne} (${x.raison})`).join(' ; ')}`);
    setRapportImport(parties.join(' '));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center flex-wrap">
        <div className="relative flex-1 max-w-md min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher un nom, un poste, une société…" className="pl-9 bg-card" aria-label="Rechercher un employé" />
        </div>
        <Select value={filtreSoc} onValueChange={setFiltreSoc}>
          <SelectTrigger className="w-full sm:w-52 bg-card" aria-label="Filtrer par société"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="toutes">Toutes les sociétés</SelectItem>
            {societes.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nom}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={voirSortis} onChange={(e) => setVoirSortis(e.target.checked)}
            className="h-4 w-4 rounded border-input" />
          Afficher les sortis
        </label>
        {!lectureSeule && (
          <div className="flex gap-2 sm:ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"><FileSpreadsheet className="h-4 w-4 mr-2" aria-hidden />Excel</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => inputFichier.current?.click()}><Upload className="h-4 w-4 mr-2" aria-hidden />Importer des employés (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.exporterEmployes()}><Download className="h-4 w-4 mr-2" aria-hidden />Exporter la liste</DropdownMenuItem>
                <DropdownMenuItem onClick={telechargerModele}><FileDown className="h-4 w-4 mr-2" aria-hidden />Télécharger le modèle d'import</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={inputFichier} type="file" accept=".xlsx,.xls" className="hidden"
              aria-label="Fichier Excel à importer"
              onChange={(ev) => { const f = ev.target.files?.[0]; if (f) importer(f); ev.target.value = ''; }}
            />
            <Button onClick={() => ouvrir()}><UserPlus className="h-4 w-4 mr-2" aria-hidden />Nouvel employé</Button>
          </div>
        )}
      </div>

      {rapportImport && (
        <div className="border border-primary/30 bg-primary/5 rounded-md px-4 py-3 text-sm flex items-start justify-between gap-3">
          <p>{rapportImport}</p>
          <button className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => setRapportImport(null)} aria-label="Fermer le rapport d'import">✕</button>
        </div>
      )}

      <Card><CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="rule-label">Employé</TableHead>
            <TableHead className="rule-label hidden md:table-cell">Société</TableHead>
            <TableHead className="rule-label hidden lg:table-cell">Service</TableHead>
            <TableHead className="rule-label hidden xl:table-cell">Rotation</TableHead>
            <TableHead className="rule-label">Contrat</TableHead>
            {!lectureSeule && <TableHead className="rule-label text-right pr-4">Actions</TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {filtres.map((e) => {
              const estAifg = societes.find((s) => s.id === e.societeId)?.type === 'Principale';
              const rc = e.typeContrat === 'CDD' ? joursRestants(e.finContrat) : Infinity;
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center display font-bold text-sm shrink-0">{initiales(e)}</div>
                      <div>
                        <p className="font-medium">{e.prenom} {e.nom}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.matricule && <span className="font-mono">{e.matricule} · </span>}{e.poste}
                        </p>
                        {!e.actif && (
                          <span className="stamp text-destructive mt-0.5 inline-block">
                            Sorti{e.dateSortie ? ` le ${formatDate(e.dateSortie)}` : ''}{e.motifSortie ? ` — ${e.motifSortie}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className={`stamp ${estAifg ? 'text-primary' : 'text-muted-foreground'}`}>{nomSoc(e.societeId)}</span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <p>{nomSrv(e.serviceId)}</p>
                    {e.chantierId && <p className="text-xs text-muted-foreground">{chantiers.find((c) => c.id === e.chantierId)?.nom}</p>}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-sm">{e.categorie === 'Chantier' ? nomRot(e.rotationId) : '—'}</TableCell>
                  <TableCell>
                    <span className={`stamp ${e.typeContrat === 'CDI' ? 'text-primary' : rc < 0 ? 'text-destructive' : rc <= 60 ? 'text-amber-700' : 'text-muted-foreground'}`}>
                      {e.typeContrat}{e.typeContrat === 'CDD' && e.finContrat ? ` → ${formatDate(e.finContrat)}` : ''}
                    </span>
                  </TableCell>
                  {!lectureSeule && (
                    <TableCell className="text-right pr-4 whitespace-nowrap">
                      <Button variant="ghost" size="icon" aria-label={`Modifier ${e.prenom} ${e.nom}`} onClick={() => ouvrir(e)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={`Sortie d'effectif de ${e.prenom} ${e.nom}`} className="text-destructive" onClick={() => setSortie(e)}><UserMinus className="h-4 w-4" /></Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {filtres.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Aucun employé ne correspond à cette recherche.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!sortie} onOpenChange={(o) => !o && setSortie(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="display text-xl">Sortie d'effectif</DialogTitle></DialogHeader>
          {sortie && (
            <>
              <p className="text-sm">
                <b>{sortie.prenom} {sortie.nom}</b> sera retiré des listes et des futures feuilles de pointage.
              </p>
              <p className="text-sm text-muted-foreground">
                Son historique de pointage et de congés est conservé : ce sont des pièces
                justificatives de paie. Vous pourrez le réintégrer si besoin.
              </p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="date-sortie">Date de sortie</Label>
                  <Input id="date-sortie" type="date" value={dateSortie} onChange={(e) => setDateSortie(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="motif-sortie">Motif</Label>
                  <Input id="motif-sortie" value={motifSortie} onChange={(e) => setMotifSortie(e.target.value)}
                    placeholder="ex. Fin de contrat, démission, mutation…" />
                </div>
              </div>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSortie(null)}>Annuler</Button>
            <Button onClick={confirmerSortie}>Confirmer la sortie</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="display text-xl">{edit ? `Dossier de ${edit.prenom} ${edit.nom}` : 'Nouvel employé'}</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="dossier">
            <TabsList className="bg-muted">
              <TabsTrigger value="dossier">Dossier</TabsTrigger>
              <TabsTrigger value="pieces" disabled={!edit}>
                Pièces jointes{!edit && ' (après enregistrement)'}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pieces" className="pt-3">
              {edit && <PiecesJointes employeId={edit.id} lectureSeule={lectureSeule} onErreur={(m) => setErreur(m)} />}
            </TabsContent>

            <TabsContent value="dossier" className="space-y-3 pt-3">

          {/* ---------- Identité ---------- */}
          <p className="rule-label border-b pb-1">Identité</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label>Prénom *</Label><Input value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Nom *</Label><Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Matricule</Label>
              <Input value={form.matricule} onChange={(e) => setForm({ ...form, matricule: e.target.value })} placeholder="attribué automatiquement" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>Sexe</Label>
              <Select value={form.sexe} onValueChange={(v) => setForm({ ...form, sexe: v as 'M' | 'F' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="M">Masculin</SelectItem><SelectItem value="F">Féminin</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Date de naissance</Label><Input type="date" value={form.dateNaissance} onChange={(e) => setForm({ ...form, dateNaissance: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Lieu de naissance</Label><Input value={form.lieuNaissance} onChange={(e) => setForm({ ...form, lieuNaissance: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>N° pièce d'identité (NIN)</Label>
              <Input value={form.numIdentite} onChange={(e) => setForm({ ...form, numIdentite: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>N° sécurité sociale (CNAS)</Label>
              <Input value={form.numCnas} onChange={(e) => setForm({ ...form, numCnas: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Groupe sanguin</Label>
              <Select value={form.groupeSanguin || 'nc'} onValueChange={(v) => setForm({ ...form, groupeSanguin: v === 'nc' ? '' : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nc">Non communiqué</SelectItem>
                  {GROUPES_SANGUINS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Situation familiale</Label>
              <Select value={form.situationFamiliale} onValueChange={(v) => setForm({ ...form, situationFamiliale: v as SituationFamiliale })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SITUATIONS_FAMILIALES.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Enfants à charge</Label>
              <Input type="number" min={0} value={form.enfantsACharge} onChange={(e) => setForm({ ...form, enfantsACharge: Number(e.target.value) })} />
            </div>
          </div>

          {/* ---------- Coordonnées ---------- */}
          <p className="rule-label border-b pb-1 mt-2">Coordonnées et urgence</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2"><Label>Adresse</Label><Input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Wilaya de résidence</Label>
              <Select value={form.wilayaResidence || 'nc'} onValueChange={(v) => setForm({ ...form, wilayaResidence: v === 'nc' ? '' : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nc">Non renseignée</SelectItem>
                  {WILAYAS.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Téléphone</Label><Input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} placeholder="0550 12 34 56" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Contact en cas d'urgence</Label><Input value={form.urgenceNom} onChange={(e) => setForm({ ...form, urgenceNom: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Lien de parenté</Label><Input value={form.urgenceLien} onChange={(e) => setForm({ ...form, urgenceLien: e.target.value })} placeholder="Épouse, frère…" /></div>
            <div className="space-y-1.5"><Label>Téléphone d'urgence</Label><Input value={form.urgenceTelephone} onChange={(e) => setForm({ ...form, urgenceTelephone: e.target.value })} /></div>
          </div>

          {/* ---------- Affectation ---------- */}
          <p className="rule-label border-b pb-1 mt-2">Affectation</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2"><Label>Poste *</Label><Input value={form.poste} onChange={(e) => setForm({ ...form, poste: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Société employeur *</Label>
              <Select value={form.societeId} onValueChange={(v) => setForm({ ...form, societeId: v })}>
                <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                <SelectContent>{societes.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nom}{s.type === 'Sous-traitance' ? ' (sous-traitance)' : ''}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Catégorie</Label>
              <Select value={form.categorie} onValueChange={(v) => setForm({ ...form, categorie: v as Categorie })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Chantier">Chantier (rotation)</SelectItem>
                  <SelectItem value="Administratif">Administratif</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.categorie === 'Administratif' ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Service d'affectation *</Label>
                <Select value={form.serviceId} onValueChange={(v) => setForm({ ...form, serviceId: v })}>
                  <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                  <SelectContent>{services.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nom}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Chantier d'affectation *</Label>
                  <Select value={form.chantierId} onValueChange={(v) => setForm({ ...form, chantierId: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                    <SelectContent>
                      {chantiers.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.nom}{c.wilaya ? ` — ${c.wilaya}` : ''} ({services.find((s) => s.id === c.serviceId)?.nom ?? '?'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Le service et la wilaya (congé du Sud) découlent du chantier.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Rotation</Label>
                  <Select value={form.rotationId} onValueChange={(v) => setForm({ ...form, rotationId: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                    <SelectContent>{rotations.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.nom}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Début du cycle</Label><Input type="date" value={form.debutCycle} onChange={(e) => setForm({ ...form, debutCycle: e.target.value })} /></div>
              </>
            )}
          </div>

          {/* ---------- Contrat et rémunération ---------- */}
          <p className="rule-label border-b pb-1 mt-2">Contrat et rémunération</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label>Date d'embauche *</Label><Input type="date" value={form.dateEmbauche} onChange={(e) => setForm({ ...form, dateEmbauche: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Type de contrat</Label>
              <Select value={form.typeContrat} onValueChange={(v) => setForm({ ...form, typeContrat: v as TypeContrat })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="CDI">CDI</SelectItem><SelectItem value="CDD">CDD</SelectItem></SelectContent>
              </Select>
            </div>
            {form.typeContrat === 'CDD' ? (
              <div className="space-y-1.5"><Label>Fin de contrat *</Label><Input type="date" value={form.finContrat} onChange={(e) => setForm({ ...form, finContrat: e.target.value })} /></div>
            ) : (
              <div className="space-y-1.5"><Label>Fin de période d'essai</Label><Input type="date" value={form.finPeriodeEssai} onChange={(e) => setForm({ ...form, finPeriodeEssai: e.target.value })} /></div>
            )}
            <div className="space-y-1.5"><Label>Qualification</Label><Input value={form.niveauQualification} onChange={(e) => setForm({ ...form, niveauQualification: e.target.value })} placeholder="Ingénieur d'État, TS…" /></div>
            <div className="space-y-1.5"><Label>Catégorie conventionnelle</Label><Input value={form.categorieConventionnelle} onChange={(e) => setForm({ ...form, categorieConventionnelle: e.target.value })} placeholder="ex. 12/3" /></div>
            <div className="space-y-1.5"><Label>Salaire de base (DZD)</Label><Input type="number" min={0} value={form.salaireBase} onChange={(e) => setForm({ ...form, salaireBase: Number(e.target.value) })} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>RIB / CCP</Label><Input value={form.rib} onChange={(e) => setForm({ ...form, rib: e.target.value })} className="font-mono" /></div>
            <div className="space-y-1.5"><Label>Solde de congés (jours)</Label><Input type="number" min={0} value={form.soldeConges} onChange={(e) => setForm({ ...form, soldeConges: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label>Prochaine visite médicale</Label><Input type="date" value={form.prochaineVisiteMedicale} onChange={(e) => setForm({ ...form, prochaineVisiteMedicale: e.target.value })} /></div>
            <div className="space-y-1.5 sm:col-span-3"><Label>Observations</Label><Textarea rows={2} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} placeholder="Habilitations, restrictions médicales, remarques…" /></div>
          </div>

            </TabsContent>
          </Tabs>

          {erreur && <p className="text-sm text-destructive">{erreur}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOuvert(false)}>Fermer</Button>
            <Button onClick={sauver}>Enregistrer le dossier</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
