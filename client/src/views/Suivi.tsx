import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, initiales, joursRestants } from '@/data';
import type { Employe, Service, Societe } from '@/data';
import { Button } from '@/components/ui/button';
import { FileWarning, MessageCircle, Stethoscope } from 'lucide-react';

interface Props {
  employes: Employe[];
  societes: Societe[];
  services: Service[];
  monServiceId: number | null;
  rappeler: (employeId: number, type: 'visite' | 'contrat') => void;
  peutNotifier: boolean;
}

const SEUIL_CONTRAT = 60;   // alerte si fin de contrat dans moins de 60 jours
const SEUIL_VISITE = 30;    // alerte si visite dans moins de 30 jours

export default function Suivi({ employes, societes, services, monServiceId, rappeler, peutNotifier }: Props) {
  const rappelVisite = (e: Employe) => rappeler(e.id, 'visite');
  const rappelContrat = (e: Employe) => rappeler(e.id, 'contrat');
  const visibles = monServiceId ? employes.filter((e) => e.serviceId === monServiceId) : employes;
  const nomSoc = (id: number) => societes.find((s) => s.id === id)?.nom ?? '—';
  const nomSrv = (id: number) => services.find((s) => s.id === id)?.nom ?? '—';

  const contrats = useMemo(() =>
    visibles
      .filter((e) => e.typeContrat === 'CDD' && e.finContrat)
      .map((e) => ({ e, restants: joursRestants(e.finContrat) }))
      .sort((a, b) => a.restants - b.restants),
    [visibles]);

  const visites = useMemo(() =>
    visibles
      .filter((e) => e.prochaineVisiteMedicale)
      .map((e) => ({ e, restants: joursRestants(e.prochaineVisiteMedicale) }))
      .sort((a, b) => a.restants - b.restants),
    [visibles]);

  const etatContrat = (r: number) =>
    r < 0 ? { txt: 'Contrat expiré', cls: 'text-destructive' }
    : r <= SEUIL_CONTRAT ? { txt: `Expire dans ${r} j`, cls: 'text-amber-700' }
    : { txt: `Dans ${r} j`, cls: 'text-primary' };

  const etatVisite = (r: number) =>
    r < 0 ? { txt: `Échue depuis ${-r} j`, cls: 'text-destructive' }
    : r <= SEUIL_VISITE ? { txt: `Dans ${r} j — à programmer`, cls: 'text-amber-700' }
    : { txt: `Dans ${r} j`, cls: 'text-primary' };

  const nbAlertesContrats = contrats.filter((c) => c.restants <= SEUIL_CONTRAT).length;
  const nbAlertesVisites = visites.filter((v) => v.restants <= SEUIL_VISITE).length;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <FileWarning className="h-5 w-5 text-primary" aria-hidden />
          <CardTitle className="display text-lg flex-1">Contrats CDD — échéances</CardTitle>
          {nbAlertesContrats > 0 && <span className="stamp text-amber-700">{nbAlertesContrats} alerte(s)</span>}
        </CardHeader>
        <CardContent className="divide-y">
          {contrats.length === 0 && <p className="py-6 text-sm text-muted-foreground text-center">Aucun CDD à suivre.</p>}
          {contrats.map(({ e, restants }) => {
            const et = etatContrat(restants);
            return (
              <div key={e.id} className="py-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center display font-bold text-sm shrink-0">{initiales(e)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{e.prenom} {e.nom}</p>
                  <p className="text-xs text-muted-foreground truncate">{e.poste} · {nomSoc(e.societeId)} · {nomSrv(e.serviceId)}</p>
                  <p className="text-xs text-muted-foreground">Fin de contrat : {formatDate(e.finContrat)}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`stamp ${et.cls}`}>{et.txt}</span>
                  {peutNotifier && restants <= SEUIL_CONTRAT && (
                    <Button size="sm" variant="outline" onClick={() => rappelContrat(e)}>
                      <MessageCircle className="h-3.5 w-3.5 mr-1.5" aria-hidden />WhatsApp
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Stethoscope className="h-5 w-5 text-primary" aria-hidden />
          <CardTitle className="display text-lg flex-1">Visites médicales</CardTitle>
          {nbAlertesVisites > 0 && <span className="stamp text-amber-700">{nbAlertesVisites} alerte(s)</span>}
        </CardHeader>
        <CardContent className="divide-y">
          {visites.length === 0 && <p className="py-6 text-sm text-muted-foreground text-center">Aucune visite médicale planifiée. Renseignez les dates dans les dossiers employés.</p>}
          {visites.map(({ e, restants }) => {
            const et = etatVisite(restants);
            return (
              <div key={e.id} className="py-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center display font-bold text-sm shrink-0">{initiales(e)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{e.prenom} {e.nom}</p>
                  <p className="text-xs text-muted-foreground truncate">{e.poste} · {nomSoc(e.societeId)}</p>
                  <p className="text-xs text-muted-foreground">Prochaine visite : {formatDate(e.prochaineVisiteMedicale)}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`stamp ${et.cls}`}>{et.txt}</span>
                  {peutNotifier && restants <= SEUIL_VISITE && (
                    <Button size="sm" variant="outline" onClick={() => rappelVisite(e)}>
                      <MessageCircle className="h-3.5 w-3.5 mr-1.5" aria-hidden />WhatsApp
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <p className="xl:col-span-2 text-xs text-muted-foreground">
        Seuils d'alerte : fin de contrat CDD à moins de {SEUIL_CONTRAT} jours · visite médicale à moins de {SEUIL_VISITE} jours ou échue.
        Les dates se modifient dans le dossier de chaque employé (module Employés). Le bouton WhatsApp prépare le message de rappel dans le journal des envois.
      </p>
    </div>
  );
}
