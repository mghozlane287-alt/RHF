import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, ErreurApi } from '@/lib/api';
import { formatDate } from '@/data';
import { AlertCircle, CalendarDays, CheckCircle2, Plus, RefreshCw, Scale, Trash2, Save } from 'lucide-react';

interface ParametreLegal {
  cle: string; valeur: unknown; libelle: string; reference_legale: string;
  modifie_le: string; modifie_par: string;
}
interface Ferie { id: number; date: string; libelle: string; type: string; chome_paye: boolean }
interface TypeConge {
  id: number; libelle: string; code_pointage: string; jours_legaux: number | null;
  decompte_solde: boolean; remunere: boolean; justificatif_requis: boolean; reference_legale: string;
}
interface Droit {
  employeId: number; nom: string; prenom: string; wilaya: string; estSud: boolean;
  moisTravailles: number; joursPrincipal: number; joursSud: number; joursAnciennete: number;
  droitsTotal: number; soldeActuel: number; ecart: number;
}
interface Controle { cle: string; libelle: string; valeur: number; conforme: boolean; message: string }

interface Props { lectureSeule: boolean; onErreur: (m: string) => void }

export default function CadreLegal({ lectureSeule, onErreur }: Props) {
  const [parametres, setParametres] = useState<ParametreLegal[]>([]);
  const [feries, setFeries] = useState<Ferie[]>([]);
  const [types, setTypes] = useState<TypeConge[]>([]);
  const [droits, setDroits] = useState<Droit[]>([]);
  const [periode, setPeriode] = useState<{ debut: string; fin: string } | null>(null);
  const [controles, setControles] = useState<Controle[]>([]);
  const [brouillon, setBrouillon] = useState<Record<string, string>>({});
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [ferieOuvert, setFerieOuvert] = useState(false);
  const [ferieForm, setFerieForm] = useState({ date: '', libelle: '' });
  const [message, setMessage] = useState('');

  const gerer = async <T,>(p: Promise<T>) => {
    try { return await p; }
    catch (e) { onErreur(e instanceof ErreurApi ? e.message : 'Erreur.'); return null; }
  };

  const charger = async () => {
    const [p, f, t, d, c] = await Promise.all([
      gerer(api.parametresLegaux()), gerer(api.joursFeries(annee)),
      gerer(api.typesConge()), gerer(api.droitsConge()), gerer(api.conformite()),
    ]);
    if (p) setParametres(p);
    if (f) setFeries(f);
    if (t) setTypes(t);
    if (d) { setDroits(d.droits); setPeriode(d.periode); }
    if (c) setControles(c.controles);
  };

  useEffect(() => { charger(); /* eslint-disable-next-line */ }, [annee]);

  const enregistrer = async (cle: string) => {
    const brut = brouillon[cle];
    let valeur: unknown;
    try { valeur = JSON.parse(brut); }
    catch { valeur = brut; } // chaîne simple acceptée
    const r = await gerer(api.majParametreLegal(cle, valeur));
    if (r) {
      setBrouillon((b) => { const n = { ...b }; delete n[cle]; return n; });
      setMessage(`Paramètre « ${cle} » mis à jour. Le calcul s'applique immédiatement.`);
      await charger();
    }
  };

  const nonConformes = controles.filter((c) => !c.conforme);

  return (
    <Tabs defaultValue="conformite" className="space-y-4">
      <TabsList className="bg-muted flex-wrap h-auto">
        <TabsTrigger value="conformite"><Scale className="h-4 w-4 mr-1.5" aria-hidden />Conformité</TabsTrigger>
        <TabsTrigger value="droits">Droits à congé</TabsTrigger>
        <TabsTrigger value="parametres">Paramètres légaux</TabsTrigger>
        <TabsTrigger value="feries"><CalendarDays className="h-4 w-4 mr-1.5" aria-hidden />Jours fériés</TabsTrigger>
        <TabsTrigger value="types">Types de congé</TabsTrigger>
      </TabsList>

      {message && (
        <div className="border border-primary/30 bg-primary/5 rounded-md px-4 py-2.5 text-sm flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden />
          <p className="flex-1">{message}</p>
          <button onClick={() => setMessage('')} aria-label="Fermer">✕</button>
        </div>
      )}

      {/* ===== Conformité ===== */}
      <TabsContent value="conformite" className="space-y-4">
        <p className="text-sm text-muted-foreground max-w-3xl">
          Contrôles automatiques au regard de la loi 90-11 relative aux relations de travail
          (modifiée). Ces règles sont paramétrables : une évolution législative ou une convention
          collective plus favorable se traduit par un changement de valeur, pas par une modification
          de l'application.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {controles.map((c) => (
            <Card key={c.cle} className={`border-l-4 ${c.conforme ? 'border-l-primary/60' : 'border-l-amber-500'}`}>
              <CardContent className="pt-4 flex items-start gap-3">
                {c.conforme
                  ? <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden />
                  : <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.libelle}</p>
                  {c.message && <p className="text-xs text-muted-foreground mt-1">{c.message}</p>}
                </div>
                <span className={`display text-2xl font-bold tabular-nums ${c.conforme ? 'text-primary' : 'text-amber-700'}`}>{c.valeur}</span>
              </CardContent>
            </Card>
          ))}
        </div>
        {nonConformes.length === 0 && controles.length > 0 && (
          <p className="text-sm text-primary">Tous les contrôles de conformité sont satisfaits.</p>
        )}
      </TabsContent>

      {/* ===== Droits à congé ===== */}
      <TabsContent value="droits" className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-64">
            <p className="rule-label">Période de référence (art. 40)</p>
            <p className="text-sm">{periode ? `${formatDate(periode.debut)} → ${formatDate(periode.fin)}` : '—'}</p>
          </div>
          {!lectureSeule && (
            <Button onClick={async () => {
              if (!confirm('Appliquer les droits calculés au solde de tous les employés ? L\'opération est tracée dans le journal d\'audit.')) return;
              const r = await gerer(api.appliquerDroitsConge());
              if (r) { setMessage(`Droits appliqués à ${r.appliques} employé(s).`); await charger(); }
            }}>
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden />Appliquer les droits aux soldes
            </Button>
          )}
        </div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="rule-label">Employé</TableHead>
              <TableHead className="rule-label">Wilaya</TableHead>
              <TableHead className="rule-label text-right">Mois</TableHead>
              <TableHead className="rule-label text-right">Principal<br /><span className="font-normal normal-case">art. 41</span></TableHead>
              <TableHead className="rule-label text-right">Sud<br /><span className="font-normal normal-case">art. 42</span></TableHead>
              <TableHead className="rule-label text-right">Droits</TableHead>
              <TableHead className="rule-label text-right">Solde actuel</TableHead>
              <TableHead className="rule-label text-right pr-4">Écart</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {droits.map((d) => (
                <TableRow key={d.employeId}>
                  <TableCell className="font-medium">{d.nom} {d.prenom}</TableCell>
                  <TableCell>
                    {d.wilaya || <span className="text-amber-700">non renseignée</span>}
                    {d.estSud && <span className="stamp ml-1 text-primary">Sud</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.moisTravailles}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.joursPrincipal}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.joursSud || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{d.droitsTotal}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.soldeActuel}</TableCell>
                  <TableCell className={`text-right tabular-nums pr-4 ${d.ecart > 0 ? 'text-amber-700' : ''}`}>
                    {d.ecart > 0 ? `+${d.ecart}` : d.ecart}
                  </TableCell>
                </TableRow>
              ))}
              {droits.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Aucun employé.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      </TabsContent>

      {/* ===== Paramètres légaux ===== */}
      <TabsContent value="parametres" className="space-y-3">
        <p className="text-sm text-muted-foreground max-w-3xl">
          Chaque valeur correspond à une disposition légale ou conventionnelle. Une convention
          collective ne peut être que <b>plus favorable</b> que la loi. Toute modification est
          enregistrée dans le journal d'audit avec l'ancienne et la nouvelle valeur.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {parametres.map((p) => {
            const affiche = brouillon[p.cle] ?? JSON.stringify(p.valeur);
            const modifie = brouillon[p.cle] !== undefined;
            return (
              <Card key={p.cle}>
                <CardContent className="pt-4 space-y-2">
                  <div>
                    <Label htmlFor={`p-${p.cle}`} className="text-sm font-medium">{p.libelle}</Label>
                    <p className="text-xs text-muted-foreground">{p.reference_legale || 'Paramètre interne'}</p>
                  </div>
                  <div className="flex gap-2">
                    <Input id={`p-${p.cle}`} value={affiche} disabled={lectureSeule}
                      onChange={(e) => setBrouillon((b) => ({ ...b, [p.cle]: e.target.value }))}
                      className="font-mono text-xs" />
                    {modifie && !lectureSeule && (
                      <Button size="sm" onClick={() => enregistrer(p.cle)} aria-label={`Enregistrer ${p.libelle}`}>
                        <Save className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {p.modifie_par && (
                    <p className="text-[11px] text-muted-foreground">
                      Modifié le {formatDate(String(p.modifie_le).slice(0, 10))} par {p.modifie_par}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </TabsContent>

      {/* ===== Jours fériés ===== */}
      <TabsContent value="feries" className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground flex-1 min-w-64">
            Les fêtes religieuses suivent le calendrier hégirien : leurs dates doivent être saisies
            chaque année. Les jours fériés sont exclus du décompte des congés.
          </p>
          <Input type="number" value={annee} onChange={(e) => setAnnee(Number(e.target.value))}
            className="w-28" aria-label="Année" />
          {!lectureSeule && (
            <Button onClick={() => { setFerieForm({ date: `${annee}-01-01`, libelle: '' }); setFerieOuvert(true); }}>
              <Plus className="h-4 w-4 mr-1.5" aria-hidden />Ajouter
            </Button>
          )}
        </div>
        <Card><CardContent className="divide-y p-0">
          {feries.map((f) => (
            <div key={f.id} className="px-4 py-2.5 flex items-center gap-3">
              <span className="tabular-nums text-sm w-32">{formatDate(f.date)}</span>
              <span className="flex-1 text-sm">{f.libelle}</span>
              <span className={`stamp ${f.type === 'Civil' ? 'text-primary' : 'text-violet-800'}`}>{f.type}</span>
              {!lectureSeule && (
                <Button variant="ghost" size="icon" className="text-destructive" aria-label={`Supprimer ${f.libelle}`}
                  onClick={async () => { await gerer(api.supprimerJourFerie(f.id)); await charger(); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {feries.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Aucun jour férié saisi pour {annee}.</p>}
        </CardContent></Card>

        <Dialog open={ferieOuvert} onOpenChange={setFerieOuvert}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="display text-xl">Nouveau jour férié</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Date</Label>
                <Input type="date" value={ferieForm.date} onChange={(e) => setFerieForm({ ...ferieForm, date: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Libellé</Label>
                <Input value={ferieForm.libelle} onChange={(e) => setFerieForm({ ...ferieForm, libelle: e.target.value })}
                  placeholder="ex. Aïd el-Adha (1er jour)" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFerieOuvert(false)}>Annuler</Button>
              <Button onClick={async () => {
                const r = await gerer(api.ajouterJourFerie(ferieForm.date, ferieForm.libelle));
                if (r) { setFerieOuvert(false); await charger(); }
              }}>Enregistrer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabsContent>

      {/* ===== Types de congé ===== */}
      <TabsContent value="types" className="space-y-4">
        <p className="text-sm text-muted-foreground max-w-3xl">
          Chaque type de congé porte sa durée légale, son code de pointage et son effet sur le solde.
          Ajouter un type (nouvelle disposition légale, accord d'entreprise) se fait ici, sans
          modification de l'application.
        </p>
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="rule-label">Type</TableHead>
              <TableHead className="rule-label">Code</TableHead>
              <TableHead className="rule-label text-right">Durée légale</TableHead>
              <TableHead className="rule-label">Décompte solde</TableHead>
              <TableHead className="rule-label">Rémunéré</TableHead>
              <TableHead className="rule-label">Référence</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {types.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.libelle}</TableCell>
                  <TableCell><span className="stamp text-muted-foreground">{t.code_pointage}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{t.jours_legaux ?? 'libre'}</TableCell>
                  <TableCell>{t.decompte_solde ? 'Oui' : 'Non'}</TableCell>
                  <TableCell>{t.remunere ? 'Oui' : 'Non'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.reference_legale}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </TabsContent>
    </Tabs>
  );
}
