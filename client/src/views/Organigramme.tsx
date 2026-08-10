import { Card, CardContent } from '@/components/ui/card';
import type { Chantier, CompteChef, Employe, Service, Societe } from '@/data';
import { Building, HardHat, UserCog, Users } from 'lucide-react';

interface Props {
  services: Service[];
  chantiers: Chantier[];
  comptes: CompteChef[];
  employes: Employe[];
  societes: Societe[];
}

export default function Organigramme({ services, chantiers, comptes, employes, societes }: Props) {
  const estAifg = (e: Employe) => societes.find((s) => s.id === e.societeId)?.type === 'Principale';

  const compteurs = (liste: Employe[]) => {
    const aifg = liste.filter(estAifg).length;
    return { total: liste.length, aifg, st: liste.length - aifg };
  };

  return (
    <div className="space-y-6">
      {/* Direction */}
      <div className="flex justify-center">
        <Card className="border-t-4 border-t-primary w-full max-w-md">
          <CardContent className="pt-5 text-center">
            <Building className="h-6 w-6 text-primary mx-auto" aria-hidden />
            <p className="display text-lg font-bold mt-2">Direction générale — AIFG</p>
            <p className="text-sm text-muted-foreground">
              Supervise l'ensemble des services, des chantiers et du personnel (AIFG et sous-traitance).
            </p>
            <p className="text-xs text-muted-foreground mt-2 tabular-nums">
              {services.length} services · {chantiers.length} chantiers · {employes.length} employés
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-center" aria-hidden>
        <div className="w-px h-6 bg-border" />
      </div>

      {/* Services */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {services.map((srv) => {
          const responsable = comptes.find((c) => c.serviceId === srv.id && c.role === 'Chef de service');
          const admins = employes.filter((e) => e.serviceId === srv.id && e.categorie === 'Administratif');
          const cAdmin = compteurs(admins);
          const chantiersDuService = chantiers.filter((c) => c.serviceId === srv.id);
          return (
            <Card key={srv.id} className="border-l-4 border-l-primary/70">
              <CardContent className="pt-5 space-y-3">
                <div>
                  <p className="rule-label">Service (activité)</p>
                  <p className="display text-lg font-bold">{srv.nom}</p>
                  <p className="text-sm flex items-center gap-1.5 mt-1">
                    <UserCog className="h-4 w-4 text-primary shrink-0" aria-hidden />
                    Responsable : {responsable ? <b>{responsable.nom}</b> : <span className="text-amber-700">compte à créer</span>}
                  </p>
                </div>

                {/* Personnel de base (administratif) */}
                <div className="border rounded-md bg-muted/40 p-3">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-primary" aria-hidden />Personnel de base du service
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                    {cAdmin.total} employé(s) — {cAdmin.aifg} AIFG · {cAdmin.st} sous-traitance · dépendent directement du responsable de service
                  </p>
                </div>

                {/* Chantiers */}
                {chantiersDuService.length > 0 && (
                  <div className="space-y-2">
                    {chantiersDuService.map((ch) => {
                      const resp = comptes.find((c) => c.chantierId === ch.id);
                      const eff = compteurs(employes.filter((e) => e.chantierId === ch.id));
                      return (
                        <div key={ch.id} className="border rounded-md p-3 ml-3 relative before:content-[''] before:absolute before:-left-3 before:top-1/2 before:w-3 before:h-px before:bg-border">
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            <HardHat className="h-4 w-4 text-primary" aria-hidden />
                            {ch.nom}{ch.lieu ? ` — ${ch.lieu}` : ''}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {resp ? `${resp.role} : ${resp.nom}` : <span className="text-amber-700">chef de chantier / superviseur à désigner</span>}
                            {' '}· rend compte au responsable de service
                          </p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {eff.total} employé(s) — {eff.aifg} AIFG · {eff.st} sous-traitance
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Chaîne hiérarchique : Direction → responsable de service → (personnel de base + chefs de chantier / superviseurs) → employés AIFG et sous-traitants.
      </p>
    </div>
  );
}
