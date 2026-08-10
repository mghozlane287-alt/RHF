import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EMAIL_RH, formatDate, initiales, joursOuvres } from '@/data';
import type { CompteChef, Conge, Employe, Role, RoleCompte, Service, Societe, StatutConge, TypeConge } from '@/data';
import { CalendarPlus, Check, Printer, X } from 'lucide-react';
import { echapperHtml as h } from '@/lib/securite';
import type { Actions } from '@/lib/donnees';

const TYPES: TypeConge[] = ['Congé annuel', 'Congé de récupération', 'Congé exceptionnel', 'Congé maladie', 'Congé maternité', 'Congé sans solde', 'Événement familial'];

interface Props {
  actions: Actions;
  role: Role;
  roleCompte: RoleCompte | null;
  monServiceId: number | null;
  employes: Employe[];
  services: Service[];
  societes: Societe[];
  conges: Conge[];
}

const STATUT_STYLE: Record<StatutConge, string> = {
  'En attente (chef de service)': 'text-amber-700',
  'En attente (RH)': 'text-sky-800',
  'Approuvé': 'text-primary',
  'Refusé': 'text-destructive',
};

const FORM_VIDE = { employeId: '', type: '' as TypeConge | '', debut: '', fin: '', motif: '', justificatifReference: '', adressePendantConge: '' };

export default function Conges({ actions, role, roleCompte, monServiceId, employes, services, societes, conges }: Props) {
  const [filtre, setFiltre] = useState<'toutes' | 'a-traiter' | 'Approuvé' | 'Refusé'>('a-traiter');
  const [ouvert, setOuvert] = useState(false);
  const [form, setForm] = useState({ ...FORM_VIDE });
  const [erreur, setErreur] = useState('');

  const emp = (id: number) => employes.find((e) => e.id === id);
  const empVisibles = monServiceId ? employes.filter((e) => e.serviceId === monServiceId) : employes;

  const liste = useMemo(() => {
    let l = [...conges].sort((a, b) => b.id - a.id);
    if (monServiceId) l = l.filter((c) => emp(c.employeId)?.serviceId === monServiceId);
    if (filtre === 'a-traiter') l = l.filter((c) => c.statut.startsWith('En attente'));
    else if (filtre !== 'toutes') l = l.filter((c) => c.statut === filtre);
    return l;
  }, [conges, filtre, monServiceId, employes]);

  const nbJours = form.debut && form.fin ? joursOuvres(form.debut, form.fin) : 0;

  const enregistrer = async () => {
    if (!form.employeId || !form.type || !form.debut || !form.fin) { setErreur("Veuillez renseigner l'employé, le type et les dates."); return; }
    const r = await actions.creerConge({
      employeId: Number(form.employeId), type: form.type,
      debut: form.debut, fin: form.fin, motif: form.motif.trim(),
      justificatifReference: form.justificatifReference.trim(),
      adressePendantConge: form.adressePendantConge.trim(),
    });
    if (!r) return;
    setForm({ ...FORM_VIDE }); setErreur(''); setOuvert(false);
  };

  const validerChef = (c: Conge) => actions.deciderConge(c.id, 'valider');

  const deciderRH = (c: Conge, statut: 'Approuvé' | 'Refusé') =>
    actions.deciderConge(c.id, statut === 'Approuvé' ? 'valider' : 'refuser');

  const refuserChef = (c: Conge) => actions.deciderConge(c.id, 'refuser');

  const imprimer = (c: Conge) => {
    const e = emp(c.employeId); if (!e) return;
    const srv = services.find((s) => s.id === e.serviceId)?.nom ?? '—';
    const soc = societes.find((s) => s.id === e.societeId)?.nom ?? '—';
    const w = window.open('', '_blank');
    if (!w) { alert('Veuillez autoriser les fenêtres pop-up pour imprimer.'); return; }
    try { (w as Window & { opener: unknown }).opener = null; } catch { /* ignore */ }
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Titre de congé — ${h(e.nom)} ${h(e.prenom)}</title>
<style>body{font-family:Arial,sans-serif;margin:40px;color:#1c2b26;font-size:13px;max-width:700px}
h1{font-size:18px;text-align:center;text-transform:uppercase;letter-spacing:.06em}
table{width:100%;border-collapse:collapse;margin:18px 0} td{border:1px solid #999;padding:7px 10px}
td:first-child{width:38%;background:#f0f2ee;font-weight:bold}
.cachet{margin-top:48px;display:flex;justify-content:space-between}
.cachet div{width:30%;border-top:1px solid #333;padding-top:5px;font-size:11px;text-align:center}
@media print{body{margin:14mm}}</style></head><body>
<p style="text-align:right">AIFG — Service des ressources humaines</p>
<h1>Titre de congé n° ${String(c.id).padStart(4, '0')}/2026</h1>
<table>
<tr><td>Nom et prénom</td><td>${h(e.nom)} ${h(e.prenom)}</td></tr>
<tr><td>Poste</td><td>${h(e.poste)}</td></tr>
<tr><td>Société employeur</td><td>${h(soc)}</td></tr>
<tr><td>Service</td><td>${h(srv)}</td></tr>
<tr><td>Nature du congé</td><td>${c.type}</td></tr>
<tr><td>Période</td><td>du ${formatDate(c.debut)} au ${formatDate(c.fin)} (${c.jours} jours ouvrés)</td></tr>
<tr><td>Motif</td><td>${h(c.motif) || '—'}</td></tr>
<tr><td>Décision</td><td>${c.statut}</td></tr>
</table>
<div class="cachet"><div>L'intéressé(e)</div><div>Le chef de service</div><div>Le responsable RH<br>(cachet et signature)</div></div>
<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <Tabs value={filtre} onValueChange={(v) => setFiltre(v as typeof filtre)}>
          <TabsList className="bg-muted flex-wrap h-auto">
            <TabsTrigger value="a-traiter">À traiter</TabsTrigger>
            <TabsTrigger value="toutes">Toutes</TabsTrigger>
            <TabsTrigger value="Approuvé">Approuvées</TabsTrigger>
            <TabsTrigger value="Refusé">Refusées</TabsTrigger>
          </TabsList>
        </Tabs>
        {role.type !== 'direction' && (
          <Button onClick={() => setOuvert(true)} className="sm:ml-auto">
            <CalendarPlus className="h-4 w-4 mr-2" aria-hidden /> Nouvelle demande
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {liste.map((c) => {
          const e = emp(c.employeId);
          if (!e) return null;
          const soc = societes.find((s) => s.id === e.societeId);
          return (
            <Card key={c.id} className="border-l-4 border-l-primary/60">
              <CardContent className="pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center display font-bold shrink-0">{initiales(e)}</div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{e.prenom} {e.nom}</p>
                      <p className="text-xs text-muted-foreground truncate">{e.poste} · {soc?.nom}</p>
                    </div>
                  </div>
                  <span className={`stamp ${STATUT_STYLE[c.statut]}`}>{c.statut}</span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-sm border rounded-md bg-muted/40 p-3">
                  <div><p className="rule-label">Type</p><p className="mt-1 font-medium">{c.type}</p></div>
                  <div><p className="rule-label">Période</p><p className="mt-1 tabular-nums">{formatDate(c.debut)} → {formatDate(c.fin)}</p></div>
                  <div><p className="rule-label">Durée</p><p className="mt-1 font-medium tabular-nums">{c.jours} j ouvrés</p></div>
                </div>
                {c.motif && <p className="mt-3 text-sm text-muted-foreground italic">« {c.motif} »</p>}
                {c.justificatifReference && (
                  <p className="mt-1 text-xs text-muted-foreground">Justificatif : {c.justificatifReference}</p>
                )}
                {c.adressePendantConge && (
                  <p className="text-xs text-muted-foreground">Joignable à : {c.adressePendantConge}</p>
                )}
                {c.observationDecision && (
                  <p className="mt-2 text-xs border-l-2 border-primary/40 pl-2">
                    {c.observationDecision}{c.decidePar ? ` — ${c.decidePar}` : ''}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {c.statut === 'En attente (chef de service)' && (role.type === 'rh' || (monServiceId === e.serviceId && roleCompte === 'Chef de service')) && (
                    <>
                      <Button size="sm" onClick={() => validerChef(c)}><Check className="h-4 w-4 mr-1.5" aria-hidden />Valider et transmettre au RH</Button>
                      <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/5" onClick={() => refuserChef(c)}><X className="h-4 w-4 mr-1.5" aria-hidden />Refuser</Button>
                    </>
                  )}
                  {c.statut === 'En attente (RH)' && role.type === 'rh' && (
                    <>
                      <Button size="sm" onClick={() => deciderRH(c, 'Approuvé')}><Check className="h-4 w-4 mr-1.5" aria-hidden />Approuver (RH)</Button>
                      <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/5" onClick={() => deciderRH(c, 'Refusé')}><X className="h-4 w-4 mr-1.5" aria-hidden />Refuser</Button>
                    </>
                  )}
                  {c.statut === 'Approuvé' && (
                    <Button size="sm" variant="outline" onClick={() => imprimer(c)}><Printer className="h-4 w-4 mr-1.5" aria-hidden />Imprimer le titre de congé</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {liste.length === 0 && (
          <Card className="lg:col-span-2"><CardContent className="py-12 text-center text-muted-foreground">
            Aucune demande dans cette catégorie.
          </CardContent></Card>
        )}
      </div>

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="display text-xl">Nouvelle demande de congé</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Employé</Label>
              <Select value={form.employeId} onValueChange={(v) => setForm({ ...form, employeId: v })}>
                <SelectTrigger><SelectValue placeholder="Choisir un employé…" /></SelectTrigger>
                <SelectContent>
                  {empVisibles.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.prenom} {e.nom} — solde {e.soldeConges} j</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type de congé</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as TypeConge })}>
                <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="debut">Du</Label><Input id="debut" type="date" value={form.debut} onChange={(e) => setForm({ ...form, debut: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="fin">Au</Label><Input id="fin" type="date" value={form.fin} onChange={(e) => setForm({ ...form, fin: e.target.value })} /></div>
            </div>
            {nbJours > 0 && <p className="text-sm text-muted-foreground">Durée : <b className="text-foreground tabular-nums">{nbJours} jours ouvrés</b> (week-end vendredi/samedi exclu)</p>}
            <div className="space-y-1.5">
              <Label htmlFor="justif">Référence du justificatif</Label>
              <Input id="justif" value={form.justificatifReference}
                onChange={(e) => setForm({ ...form, justificatifReference: e.target.value })}
                placeholder="certificat médical, acte, convocation…" />
              <p className="text-xs text-muted-foreground">Obligatoire pour les congés maladie, exceptionnels et maternité.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adr">Adresse pendant le congé</Label>
              <Input id="adr" value={form.adressePendantConge}
                onChange={(e) => setForm({ ...form, adressePendantConge: e.target.value })}
                placeholder="où joindre l'employé si nécessaire" />
            </div>
            <div className="space-y-1.5"><Label htmlFor="motif">Motif (facultatif)</Label><Textarea id="motif" rows={2} value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })} /></div>
          </div>
          {erreur && <p className="text-sm text-destructive">{erreur}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOuvert(false)}>Annuler</Button>
            <Button onClick={enregistrer}>Soumettre au chef de service</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
