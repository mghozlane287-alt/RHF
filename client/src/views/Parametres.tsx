import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Chantier, CompteChef, Employe, RoleCompte, Rotation, Service, Societe } from '@/data';
import { LIBELLE_VERS_ROLE } from '@/lib/donnees';
import type { Actions } from '@/lib/donnees';
import { Building2, HardHat, Pencil, Plus, Trash2, UserCog, RefreshCw, Eye, EyeOff } from 'lucide-react';

interface Props {
  actions: Actions;
  societes: Societe[];
  services: Service[];
  chantiers: Chantier[];
  comptes: CompteChef[];
  rotations: Rotation[];
  employes: Employe[];
}


export default function Parametres({ actions, societes, services, chantiers, comptes, rotations, employes }: Props) {
  // --- Sociétés ---
  const [socEdit, setSocEdit] = useState<Societe | null>(null);
  const [socOuvert, setSocOuvert] = useState(false);
  const SOC_VIDE = {
    nom: '', formeJuridique: 'SARL', contact: '', telephone: '', email: '',
    adresse: '', wilaya: '', nif: '', nis: '', registreCommerce: '',
    articleImposition: '', numCnasEmployeur: '', objetPrestation: '',
    contratReference: '', contratDebut: '', contratFin: '',
  };
  const [socForm, setSocForm] = useState({ ...SOC_VIDE });
  const [socErr, setSocErr] = useState('');

  const ouvrirSoc = (s?: Societe) => {
    setSocEdit(s ?? null);
    setSocForm(s ? {
      nom: s.nom, formeJuridique: s.formeJuridique || 'SARL', contact: s.contact,
      telephone: s.telephone, email: s.email, adresse: s.adresse, wilaya: s.wilaya,
      nif: s.nif, nis: s.nis, registreCommerce: s.registreCommerce,
      articleImposition: s.articleImposition, numCnasEmployeur: s.numCnasEmployeur,
      objetPrestation: s.objetPrestation, contratReference: s.contratReference,
      contratDebut: s.contratDebut, contratFin: s.contratFin,
    } : { ...SOC_VIDE });
    setSocErr(''); setSocOuvert(true);
  };
  const sauverSoc = async () => {
    if (!socForm.nom.trim()) { setSocErr('Le nom de la société est obligatoire.'); return; }
    const d = {
      ...socForm, nom: socForm.nom.trim(),
      contratDebut: socForm.contratDebut || null, contratFin: socForm.contratFin || null,
    };
    if (socEdit) await actions.modifierSociete(socEdit.id, d); else await actions.creerSociete(d);
    setSocOuvert(false);
  };
  const supprimerSoc = async (s: Societe) => {
    if (confirm(`Supprimer la société « ${s.nom} » ?`)) await actions.supprimerSociete(s.id);
  };

  // --- Services ---
  const [srvEdit, setSrvEdit] = useState<Service | null>(null);
  const [srvOuvert, setSrvOuvert] = useState(false);
  const [srvForm, setSrvForm] = useState({ nom: '', code: '', wilaya: '', description: '' });
  const ouvrirSrv = (s?: Service) => {
    setSrvEdit(s ?? null);
    setSrvForm(s ? { nom: s.nom, code: s.code, wilaya: s.wilaya, description: s.description }
                 : { nom: '', code: '', wilaya: '', description: '' });
    setSrvOuvert(true);
  };
  const sauverSrv = async () => {
    if (!srvForm.nom.trim()) return;
    const d = { ...srvForm, nom: srvForm.nom.trim() };
    if (srvEdit) await actions.modifierService(srvEdit.id, d); else await actions.creerService(d);
    setSrvOuvert(false);
  };
  const supprimerSrv = async (s: Service) => {
    if (confirm(`Supprimer le service « ${s.nom} » ? Les comptes associés seront aussi supprimés.`)) await actions.supprimerService(s.id);
  };

  // --- Chantiers ---
  const [chEdit, setChEdit] = useState<Chantier | null>(null);
  const [chOuvert, setChOuvert] = useState(false);
  const [chForm, setChForm] = useState({ nom: '', serviceId: '', code: '', lieu: '', wilaya: '', client: '', dateOuverture: '', dateFermeture: '', actif: true });
  const [chErr, setChErr] = useState('');
  const ouvrirCh = (c?: Chantier) => {
    setChEdit(c ?? null);
    setChForm(c ? {
      nom: c.nom, serviceId: String(c.serviceId), code: c.code, lieu: c.lieu, wilaya: c.wilaya,
      client: c.client, dateOuverture: c.dateOuverture, dateFermeture: c.dateFermeture, actif: c.actif,
    } : { nom: '', serviceId: '', code: '', lieu: '', wilaya: '', client: '', dateOuverture: '', dateFermeture: '', actif: true });
    setChErr(''); setChOuvert(true);
  };
  const sauverCh = async () => {
    if (!chForm.nom.trim() || !chForm.serviceId) { setChErr('Nom du chantier et service de rattachement obligatoires.'); return; }
    const data = {
      nom: chForm.nom.trim(), serviceId: Number(chForm.serviceId), code: chForm.code.trim(),
      lieu: chForm.lieu.trim(), wilaya: chForm.wilaya, client: chForm.client.trim(),
      dateOuverture: chForm.dateOuverture || null, dateFermeture: chForm.dateFermeture || null,
      actif: chForm.actif,
    };
    if (chEdit) await actions.modifierChantier(chEdit.id, data); else await actions.creerChantier(data);
    setChOuvert(false);
  };
  const supprimerCh = async (c: Chantier) => {
    if (confirm(`Supprimer le chantier « ${c.nom} » ? Les comptes associés seront supprimés.`)) await actions.supprimerChantier(c.id);
  };

  // --- Comptes chefs ---
  const [cptEdit, setCptEdit] = useState<CompteChef | null>(null);
  const [cptOuvert, setCptOuvert] = useState(false);
  const [cptForm, setCptForm] = useState({ nom: '', email: '', telephone: '', fonction: '', motDePasse: '', serviceId: '', chantierId: '', role: 'Chef de service' as RoleCompte });
  const [cptErr, setCptErr] = useState('');
  const [voirMdp, setVoirMdp] = useState(false);
  const ouvrirCpt = (c?: CompteChef) => {
    setCptEdit(c ?? null);
    setCptForm(c ? { nom: c.nom, email: c.email, telephone: c.telephone, fonction: c.fonction, motDePasse: '', serviceId: String(c.serviceId), chantierId: c.chantierId ? String(c.chantierId) : '', role: c.role } : { nom: '', email: '', telephone: '', fonction: '', motDePasse: '', serviceId: '', chantierId: '', role: 'Chef de service' });
    setCptErr(''); setVoirMdp(false); setCptOuvert(true);
  };
  const sauverCpt = async () => {
    const estNiveauChantier = cptForm.role !== 'Chef de service';
    if (!cptForm.nom.trim() || !cptForm.email.trim()) { setCptErr('Nom et e-mail sont obligatoires.'); return; }
    if (!cptEdit && cptForm.motDePasse.length < 8) { setCptErr('Mot de passe temporaire : 8 caractères minimum.'); return; }
    if (cptForm.motDePasse && cptForm.motDePasse.length < 8) { setCptErr('Mot de passe temporaire : 8 caractères minimum.'); return; }
    if (!estNiveauChantier && !cptForm.serviceId) { setCptErr('Choisissez le service dirigé.'); return; }
    if (estNiveauChantier && !cptForm.chantierId) { setCptErr('Choisissez le chantier sous responsabilité.'); return; }
    const d: Record<string, unknown> = {
      nom: cptForm.nom.trim(), email: cptForm.email.trim(),
      telephone: cptForm.telephone.trim(), fonction: cptForm.fonction.trim(),
      role: LIBELLE_VERS_ROLE[cptForm.role],
      serviceId: estNiveauChantier ? null : Number(cptForm.serviceId),
      chantierId: estNiveauChantier ? Number(cptForm.chantierId) : null,
    };
    if (cptForm.motDePasse) d.motDePasse = cptForm.motDePasse;
    const r = cptEdit ? await actions.modifierCompte(cptEdit.id, d) : await actions.creerCompte(d);
    if (r) setCptOuvert(false);
  };

  // --- Rotations ---
  const [rotEdit, setRotEdit] = useState<Rotation | null>(null);
  const [rotOuvert, setRotOuvert] = useState(false);
  const [rotForm, setRotForm] = useState({ nom: '', joursTravail: 28, joursRepos: 28 });
  const [rotErr, setRotErr] = useState('');
  const ouvrirRot = (r?: Rotation) => {
    setRotEdit(r ?? null);
    setRotForm(r ? { nom: r.nom, joursTravail: r.joursTravail, joursRepos: r.joursRepos } : { nom: '', joursTravail: 28, joursRepos: 28 });
    setRotErr(''); setRotOuvert(true);
  };
  const sauverRot = async () => {
    const t = Number(rotForm.joursTravail), rp = Number(rotForm.joursRepos);
    if (!rotForm.nom.trim() || t < 1 || rp < 0) { setRotErr('Nom obligatoire ; jours de travail ≥ 1 et repos ≥ 0.'); return; }
    const d = { nom: rotForm.nom.trim(), joursTravail: t, joursRepos: rp };
    if (rotEdit) await actions.modifierRotation(rotEdit.id, d); else await actions.creerRotation(d);
    setRotOuvert(false);
  };
  const supprimerRot = async (r: Rotation) => {
    if (confirm(`Supprimer la rotation « ${r.nom} » ?`)) await actions.supprimerRotation(r.id);
  };

  const nomService = (id: number) => services.find((s) => s.id === id)?.nom ?? '—';

  return (
    <Tabs defaultValue="societes" className="space-y-4">
      <TabsList className="bg-muted flex-wrap h-auto">
        <TabsTrigger value="societes"><Building2 className="h-4 w-4 mr-1.5" aria-hidden />Sociétés</TabsTrigger>
        <TabsTrigger value="services"><UserCog className="h-4 w-4 mr-1.5" aria-hidden />Services & comptes</TabsTrigger>
        <TabsTrigger value="rotations"><RefreshCw className="h-4 w-4 mr-1.5" aria-hidden />Rotations</TabsTrigger>
      </TabsList>

      {/* ===== Sociétés ===== */}
      <TabsContent value="societes" className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">AIFG est la société principale. Les sociétés de sous-traitance peuvent être ajoutées, modifiées ou supprimées.</p>
          <Button onClick={() => ouvrirSoc()}><Plus className="h-4 w-4 mr-1.5" aria-hidden />Nouvelle société</Button>
        </div>
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="rule-label">Société</TableHead>
              <TableHead className="rule-label hidden sm:table-cell">Contact</TableHead>
              <TableHead className="rule-label hidden md:table-cell">Téléphone</TableHead>
              <TableHead className="rule-label hidden lg:table-cell">NIF</TableHead>
              <TableHead className="rule-label">Effectif</TableHead>
              <TableHead className="rule-label text-right pr-4">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {societes.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <p className="font-medium">{s.nom}</p>
                    <span className={`stamp ${s.type === 'Principale' ? 'text-primary' : 'text-muted-foreground'}`}>{s.type}</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{s.contact || '—'}</TableCell>
                  <TableCell className="hidden md:table-cell tabular-nums">{s.telephone || '—'}</TableCell>
                  <TableCell className="hidden lg:table-cell tabular-nums">{s.nif || '—'}</TableCell>
                  <TableCell className="tabular-nums">{employes.filter((e) => e.societeId === s.id).length}</TableCell>
                  <TableCell className="text-right pr-4">
                    <Button variant="ghost" size="icon" aria-label={`Modifier ${s.nom}`} onClick={() => ouvrirSoc(s)}><Pencil className="h-4 w-4" /></Button>
                    {s.type !== 'Principale' && (
                      <Button variant="ghost" size="icon" aria-label={`Supprimer ${s.nom}`} className="text-destructive" onClick={() => supprimerSoc(s)}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>

        <Dialog open={socOuvert} onOpenChange={setSocOuvert}>
          <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="display text-xl">{socEdit ? 'Modifier la société' : 'Nouvelle société de sous-traitance'}</DialogTitle></DialogHeader>
            <p className="rule-label border-b pb-1">Identification</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 sm:col-span-2"><Label>Raison sociale *</Label><Input value={socForm.nom} onChange={(e) => setSocForm({ ...socForm, nom: e.target.value })} placeholder="ex. SARL El Waha Services" /></div>
              <div className="space-y-1.5">
                <Label>Forme juridique</Label>
                <Select value={socForm.formeJuridique} onValueChange={(v) => setSocForm({ ...socForm, formeJuridique: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FORMES_JURIDIQUES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>N° registre de commerce</Label><Input value={socForm.registreCommerce} onChange={(e) => setSocForm({ ...socForm, registreCommerce: e.target.value })} placeholder="31/00-1234567 B 24" /></div>
              <div className="space-y-1.5"><Label>NIF</Label><Input value={socForm.nif} onChange={(e) => setSocForm({ ...socForm, nif: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>NIS</Label><Input value={socForm.nis} onChange={(e) => setSocForm({ ...socForm, nis: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Article d'imposition</Label><Input value={socForm.articleImposition} onChange={(e) => setSocForm({ ...socForm, articleImposition: e.target.value })} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>N° employeur CNAS</Label><Input value={socForm.numCnasEmployeur} onChange={(e) => setSocForm({ ...socForm, numCnasEmployeur: e.target.value })} /></div>
            </div>

            <p className="rule-label border-b pb-1 mt-2">Coordonnées</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Personne de contact</Label><Input value={socForm.contact} onChange={(e) => setSocForm({ ...socForm, contact: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Téléphone</Label><Input value={socForm.telephone} onChange={(e) => setSocForm({ ...socForm, telephone: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>E-mail</Label><Input type="email" value={socForm.email} onChange={(e) => setSocForm({ ...socForm, email: e.target.value })} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>Adresse</Label><Input value={socForm.adresse} onChange={(e) => setSocForm({ ...socForm, adresse: e.target.value })} /></div>
              <div className="space-y-1.5">
                <Label>Wilaya</Label>
                <Select value={socForm.wilaya || 'nc'} onValueChange={(v) => setSocForm({ ...socForm, wilaya: v === 'nc' ? '' : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nc">Non renseignée</SelectItem>
                    {WILAYAS.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {socEdit && (
              <>
                <p className="rule-label border-b pb-1 mt-2">Pièces jointes</p>
                <PiecesJointes societeId={socEdit.id} lectureSeule={false} onErreur={(m) => setSocErr(m)} />
              </>
            )}

            <p className="rule-label border-b pb-1 mt-2">Contrat de sous-traitance</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 sm:col-span-3"><Label>Objet de la prestation</Label><Input value={socForm.objetPrestation} onChange={(e) => setSocForm({ ...socForm, objetPrestation: e.target.value })} placeholder="ex. Maintenance mécanique, transport du personnel…" /></div>
              <div className="space-y-1.5"><Label>Référence du contrat</Label><Input value={socForm.contratReference} onChange={(e) => setSocForm({ ...socForm, contratReference: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Début</Label><Input type="date" value={socForm.contratDebut} onChange={(e) => setSocForm({ ...socForm, contratDebut: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Fin</Label><Input type="date" value={socForm.contratFin} onChange={(e) => setSocForm({ ...socForm, contratFin: e.target.value })} /></div>
            </div>
            {socErr && <p className="text-sm text-destructive">{socErr}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSocOuvert(false)}>Annuler</Button>
              <Button onClick={sauverSoc}>Enregistrer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabsContent>

      {/* ===== Services & comptes ===== */}
      <TabsContent value="services" className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="display text-lg">Services</CardTitle>
              <Button size="sm" onClick={() => ouvrirSrv()}><Plus className="h-4 w-4 mr-1" aria-hidden />Ajouter</Button>
            </CardHeader>
            <CardContent className="divide-y">
              {services.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{s.nom}</p>
                    <p className="text-xs text-muted-foreground">
                      {employes.filter((e) => e.serviceId === s.id).length} employé(s) · chef : {comptes.find((c) => c.serviceId === s.id)?.nom ?? 'aucun compte'}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Modifier ${s.nom}`} onClick={() => ouvrirSrv(s)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Supprimer ${s.nom}`} className="text-destructive" onClick={() => supprimerSrv(s)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="display text-lg">Comptes (chefs de service & chantier)</CardTitle>
              <Button size="sm" onClick={() => ouvrirCpt()}><Plus className="h-4 w-4 mr-1" aria-hidden />Créer un compte</Button>
            </CardHeader>
            <CardContent className="divide-y">
              {comptes.map((c) => (
                <div key={c.id} className="py-2.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{c.nom} <span className={`stamp ml-1 ${c.role === 'Chef de service' ? 'text-primary' : c.role === 'Superviseur' ? 'text-violet-800' : 'text-sky-800'}`}>{c.role}</span>{c.doitChangerMdp && <span className="stamp ml-1 text-amber-700">1er accès en attente</span>}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.email} · {nomService(c.serviceId)}{c.chantierId ? ` · ${chantiers.find((x) => x.id === c.chantierId)?.nom ?? ''}` : ''}</p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Modifier le compte de ${c.nom}`} onClick={() => ouvrirCpt(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Supprimer le compte de ${c.nom}`} className="text-destructive" onClick={() => { if (confirm(`Désactiver le compte de ${c.nom} ?`)) actions.supprimerCompte(c.id); }}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {comptes.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Aucun compte. Créez un compte pour chaque chef de service.</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="display text-lg flex items-center gap-2"><HardHat className="h-5 w-5 text-primary" aria-hidden />Chantiers</CardTitle>
            <Button size="sm" onClick={() => ouvrirCh()}><Plus className="h-4 w-4 mr-1" aria-hidden />Ajouter un chantier</Button>
          </CardHeader>
          <CardContent className="divide-y">
            {chantiers.map((c) => {
              const resp = comptes.find((x) => x.chantierId === c.id);
              return (
                <div key={c.id} className="py-2.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{c.nom}{c.lieu ? ` — ${c.lieu}` : ''}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {nomService(c.serviceId)} · {employes.filter((e) => e.chantierId === c.id).length} employé(s) · responsable : {resp ? `${resp.nom} (${resp.role.toLowerCase()})` : 'aucun compte'}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Modifier ${c.nom}`} onClick={() => ouvrirCh(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Supprimer ${c.nom}`} className="text-destructive" onClick={() => supprimerCh(c)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              );
            })}
            {chantiers.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Aucun chantier. Ajoutez les chantiers rattachés à chaque service (activité).</p>}
          </CardContent>
        </Card>

        <Dialog open={chOuvert} onOpenChange={setChOuvert}>
          <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="display text-xl">{chEdit ? 'Modifier le chantier' : 'Nouveau chantier'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Nom du chantier</Label><Input value={chForm.nom} onChange={(e) => setChForm({ ...chForm, nom: e.target.value })} placeholder="ex. Puits HBK-15" /></div>
              <div className="space-y-1.5">
                <Label>Service (activité) de rattachement</Label>
                <Select value={chForm.serviceId} onValueChange={(v) => setChForm({ ...chForm, serviceId: v })}>
                  <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                  <SelectContent>{services.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nom}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Code</Label><Input value={chForm.code} onChange={(e) => setChForm({ ...chForm, code: e.target.value })} placeholder="ex. HBK12" /></div>
                <div className="space-y-1.5"><Label>Lieu</Label><Input value={chForm.lieu} onChange={(e) => setChForm({ ...chForm, lieu: e.target.value })} placeholder="ex. Hassi Messaoud" /></div>
              </div>
              <div className="space-y-1.5">
                <Label>Wilaya *</Label>
                <Select value={chForm.wilaya || 'nc'} onValueChange={(v) => setChForm({ ...chForm, wilaya: v === 'nc' ? '' : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nc">Non renseignée</SelectItem>
                    {WILAYAS.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Détermine le congé supplémentaire du Sud (art. 42) pour les employés du chantier.</p>
              </div>
              <div className="space-y-1.5"><Label>Client / maître d'ouvrage</Label><Input value={chForm.client} onChange={(e) => setChForm({ ...chForm, client: e.target.value })} placeholder="ex. SONATRACH" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Date d'ouverture</Label><Input type="date" value={chForm.dateOuverture} onChange={(e) => setChForm({ ...chForm, dateOuverture: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Date de fermeture</Label><Input type="date" value={chForm.dateFermeture} onChange={(e) => setChForm({ ...chForm, dateFermeture: e.target.value })} /></div>
              </div>
            </div>
            {chErr && <p className="text-sm text-destructive">{chErr}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setChOuvert(false)}>Annuler</Button>
              <Button onClick={sauverCh}>Enregistrer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={srvOuvert} onOpenChange={setSrvOuvert}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="display text-xl">{srvEdit ? 'Modifier le service' : 'Nouveau service'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Nom du service *</Label><Input value={srvForm.nom} onChange={(e) => setSrvForm({ ...srvForm, nom: e.target.value })} placeholder="ex. Chantier Est — Génie civil" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Code</Label><Input value={srvForm.code} onChange={(e) => setSrvForm({ ...srvForm, code: e.target.value })} placeholder="ex. QHSE" /></div>
                <div className="space-y-1.5">
                  <Label>Wilaya</Label>
                  <Select value={srvForm.wilaya || 'nc'} onValueChange={(v) => setSrvForm({ ...srvForm, wilaya: v === 'nc' ? '' : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nc">Non renseignée</SelectItem>
                      {WILAYAS.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5"><Label>Description</Label><Input value={srvForm.description} onChange={(e) => setSrvForm({ ...srvForm, description: e.target.value })} /></div>
              <p className="text-xs text-muted-foreground">La wilaya détermine le congé supplémentaire du Sud (art. 42) pour le personnel administratif.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSrvOuvert(false)}>Annuler</Button>
              <Button onClick={sauverSrv}>Enregistrer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={cptOuvert} onOpenChange={setCptOuvert}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="display text-xl">{cptEdit ? 'Modifier le compte' : 'Compte chef de service'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Nom complet</Label><Input value={cptForm.nom} onChange={(e) => setCptForm({ ...cptForm, nom: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>E-mail (identifiant)</Label><Input type="email" value={cptForm.email} onChange={(e) => setCptForm({ ...cptForm, email: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Téléphone</Label><Input value={cptForm.telephone} onChange={(e) => setCptForm({ ...cptForm, telephone: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Fonction</Label><Input value={cptForm.fonction} onChange={(e) => setCptForm({ ...cptForm, fonction: e.target.value })} placeholder="ex. Superviseur HSE" /></div>
              </div>
              <div className="space-y-1.5">
                <Label>Mot de passe</Label>
                <div className="relative">
                  <Input type={voirMdp ? 'text' : 'password'} value={cptForm.motDePasse} onChange={(e) => setCptForm({ ...cptForm, motDePasse: e.target.value })} className="pr-10" />
                  <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setVoirMdp(!voirMdp)} aria-label={voirMdp ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                    {voirMdp ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Mot de passe temporaire (8 caractères min.) : l'utilisateur devra le changer à sa première connexion, et recevra ses identifiants par e-mail automatiquement. En modification, laissez vide pour ne pas le réinitialiser.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Rôle du compte</Label>
                <Select value={cptForm.role} onValueChange={(v) => setCptForm({ ...cptForm, role: v as RoleCompte })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Chef de service">Chef de service (valide et transmet au RH)</SelectItem>
                    <SelectItem value="Chef de chantier">Chef de chantier (prépare et soumet le pointage)</SelectItem>
                    <SelectItem value="Superviseur">Superviseur (prépare et soumet le pointage)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {cptForm.role === 'Chef de service' ? (
                <div className="space-y-1.5">
                  <Label>Service dirigé</Label>
                  <Select value={cptForm.serviceId} onValueChange={(v) => setCptForm({ ...cptForm, serviceId: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                    <SelectContent>{services.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nom}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Chantier sous responsabilité</Label>
                  <Select value={cptForm.chantierId} onValueChange={(v) => setCptForm({ ...cptForm, chantierId: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                    <SelectContent>
                      {chantiers.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.nom} — {services.find((s) => s.id === c.serviceId)?.nom ?? '?'}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Ce compte rendra compte au chef du service de rattachement du chantier.</p>
                </div>
              )}
            </div>
            {cptErr && <p className="text-sm text-destructive">{cptErr}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCptOuvert(false)}>Annuler</Button>
              <Button onClick={sauverCpt}>Enregistrer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabsContent>

      {/* ===== Rotations ===== */}
      <TabsContent value="rotations" className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Cycles de rotation appliqués au personnel de chantier. Le pointage est pré-rempli automatiquement selon la rotation.</p>
          <Button onClick={() => ouvrirRot()}><Plus className="h-4 w-4 mr-1.5" aria-hidden />Nouvelle rotation</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rotations.map((r) => (
            <Card key={r.id} className="border-l-4 border-l-primary/60">
              <CardContent className="pt-5">
                <div className="flex items-start justify-between">
                  <p className="display font-bold">{r.nom}</p>
                  <div className="flex">
                    <Button variant="ghost" size="icon" aria-label={`Modifier ${r.nom}`} onClick={() => ouvrirRot(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label={`Supprimer ${r.nom}`} className="text-destructive" onClick={() => supprimerRot(r)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="mt-3 flex h-3 rounded-sm overflow-hidden" role="img" aria-label={`${r.joursTravail} jours de travail puis ${r.joursRepos} jours de repos`}>
                  <div className="bg-primary" style={{ width: `${(r.joursTravail / (r.joursTravail + r.joursRepos)) * 100}%` }} />
                  <div className="bg-secondary" style={{ width: `${(r.joursRepos / (r.joursTravail + r.joursRepos)) * 100}%` }} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground tabular-nums">{r.joursTravail} j travail · {r.joursRepos} j repos · {employes.filter((e) => e.rotationId === r.id).length} employé(s)</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Dialog open={rotOuvert} onOpenChange={setRotOuvert}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="display text-xl">{rotEdit ? 'Modifier la rotation' : 'Nouvelle rotation'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Nom</Label><Input value={rotForm.nom} onChange={(e) => setRotForm({ ...rotForm, nom: e.target.value })} placeholder="ex. 20/10" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Jours de travail</Label><Input type="number" min={1} value={rotForm.joursTravail} onChange={(e) => setRotForm({ ...rotForm, joursTravail: Number(e.target.value) })} /></div>
                <div className="space-y-1.5"><Label>Jours de repos</Label><Input type="number" min={0} value={rotForm.joursRepos} onChange={(e) => setRotForm({ ...rotForm, joursRepos: Number(e.target.value) })} /></div>
              </div>
            </div>
            {rotErr && <p className="text-sm text-destructive">{rotErr}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setRotOuvert(false)}>Annuler</Button>
              <Button onClick={sauverRot}>Enregistrer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabsContent>
    </Tabs>
  );
}
