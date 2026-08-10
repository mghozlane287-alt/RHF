import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, initiales, libelleMois } from '@/data';
import type { Chantier, Conge, Employe, Feuille, Service, Societe } from '@/data';
import { Users, Building2, Inbox, ClipboardList, BellRing } from 'lucide-react';
import { joursRestants } from '@/data';

interface Props {
  employes: Employe[];
  conges: Conge[];
  feuilles: Feuille[];
  societes: Societe[];
  services: Service[];
  chantiers: Chantier[];
  role: string;
  nomPerimetre: string;
  allerA: (vue: 'employes' | 'conges' | 'pointage' | 'parametres' | 'suivi') => void;
}

export default function Dashboard({ employes, conges, feuilles, societes, services, chantiers, role, nomPerimetre, allerA }: Props) {
  const estRH = role === 'rh';
  const estDirection = role === 'direction';
  const effectif = employes.length;
  const nbSousTraitants = societes.filter((s) => s.type === 'Sous-traitance').length;
  const effectifSousTraite = employes.filter((e) => societes.find((s) => s.id === e.societeId)?.type === 'Sous-traitance').length;
  const congesATraiter = conges.filter((c) => c.statut.startsWith('En attente')).length;
  const feuillesChezRH = feuilles.filter((f) => f.statut === 'Chez RH').length;
  const alertes = employes.filter((e) =>
    (e.typeContrat === 'CDD' && e.finContrat && joursRestants(e.finContrat) <= 60) ||
    (e.prochaineVisiteMedicale && joursRestants(e.prochaineVisiteMedicale) <= 30)
  ).length;

  const parSoc = societes.map((s) => ({ nom: s.nom, type: s.type, n: employes.filter((e) => e.societeId === s.id).length }));
  const max = Math.max(1, ...parSoc.map((d) => d.n));

  const recentes = [...conges].sort((a, b) => b.id - a.id).slice(0, 4);
  const emp = (id: number) => employes.find((e) => e.id === id);

  const feuillesAPreparer = feuilles.filter((f) => f.statut === 'En préparation').length;
  const feuillesAValider = feuilles.filter((f) => f.statut === 'Chez le chef de service').length;

  const kpis = estRH || estDirection ? [
    { icone: Users, label: 'Effectif total', valeur: effectif, detail: `dont ${effectifSousTraite} en sous-traitance`, action: () => allerA('employes') },
    { icone: Building2, label: 'Sociétés de sous-traitance', valeur: nbSousTraitants, detail: 'Partenaires actifs', action: () => allerA(estRH ? 'parametres' : 'employes') },
    { icone: Inbox, label: 'Congés à traiter', valeur: congesATraiter, detail: 'En attente de décision', action: () => allerA('conges') },
    { icone: ClipboardList, label: 'Pointages chez RH', valeur: feuillesChezRH, detail: 'À vérifier, valider et archiver', action: () => allerA('pointage') },
    { icone: BellRing, label: 'Alertes RH', valeur: alertes, detail: 'Contrats CDD et visites médicales', action: () => allerA('suivi') },
  ] : [
    { icone: Users, label: 'Mon effectif', valeur: effectif, detail: nomPerimetre, action: () => allerA('employes') },
    { icone: ClipboardList, label: 'Pointages à préparer', valeur: feuillesAPreparer, detail: 'Feuilles du mois en cours', action: () => allerA('pointage') },
    { icone: Inbox, label: 'Congés à traiter', valeur: congesATraiter, detail: 'Demandes de mon équipe', action: () => allerA('conges') },
    { icone: BellRing, label: 'À valider', valeur: feuillesAValider, detail: 'Pointages soumis par le chantier', action: () => allerA('pointage') },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        {kpis.map((k) => (
          <button key={k.label} onClick={k.action} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
            <Card className="h-full border-l-4 border-l-primary/70 hover:shadow-md transition-shadow">
              <CardContent className="pt-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="rule-label">{k.label}</p>
                    <p className="display text-3xl font-bold mt-2 tabular-nums">{k.valeur}</p>
                    <p className="text-sm text-muted-foreground mt-1">{k.detail}</p>
                  </div>
                  <k.icone className="h-5 w-5 text-primary mt-1" aria-hidden />
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className={estRH || estDirection ? "lg:col-span-3" : "lg:col-span-5"}>
          <CardHeader><CardTitle className="display text-lg">Effectif par société</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {parSoc.map((d) => (
              <div key={d.nom} className="flex items-center gap-3">
                <span className="w-44 shrink-0 text-sm truncate">{d.nom}{d.type === 'Principale' ? ' (principale)' : ''}</span>
                <div className="flex-1 h-6 bg-muted rounded-sm overflow-hidden">
                  <div className={`h-full rounded-sm ${d.type === 'Principale' ? 'bg-primary/85' : 'bg-primary/45'}`} style={{ width: `${(d.n / max) * 100}%` }} role="img" aria-label={`${d.nom} : ${d.n} employés`} />
                </div>
                <span className="w-6 text-right text-sm font-semibold tabular-nums">{d.n}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="display text-lg">Circuit des pointages</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {feuilles.length === 0 && <p className="py-4 text-sm text-muted-foreground">Aucune feuille de pointage. Créez-en une dans le module Pointage.</p>}
            {feuilles.slice(-5).reverse().map((f) => (
              <div key={f.id} className="py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{services.find((s) => s.id === f.serviceId)?.nom}{f.chantierId ? ` · ${chantiers.find((c) => c.id === f.chantierId)?.nom ?? ''}` : ' · Administratif'}</p>
                  <p className="text-xs text-muted-foreground">{libelleMois(f.mois)}</p>
                </div>
                <span className={`stamp ${f.statut === 'Archivée' ? 'text-primary' : f.statut === 'Chez RH' ? 'text-sky-800' : 'text-amber-700'}`}>{f.statut}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="display text-lg">Dernières demandes de congé</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {recentes.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground text-center">
              Aucune demande de congé pour le moment.
            </p>
          )}
          {recentes.map((c) => {
            const e = emp(c.employeId);
            if (!e) return null;
            return (
              <div key={c.id} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center display font-bold text-sm shrink-0">{initiales(e)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{e.prenom} {e.nom}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.type} · {formatDate(c.debut)} ({c.jours} j)</p>
                </div>
                <span className={`stamp ${c.statut === 'Approuvé' ? 'text-primary' : c.statut === 'Refusé' ? 'text-destructive' : c.statut === 'En attente (RH)' ? 'text-sky-800' : 'text-amber-700'}`}>{c.statut}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
