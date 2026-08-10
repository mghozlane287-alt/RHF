import { useEffect, useState } from 'react';
import Dashboard from '@/views/Dashboard';
import Employes from '@/views/Employes';
import Conges from '@/views/Conges';
import Pointage from '@/views/Pointage';
import Parametres from '@/views/Parametres';
import Suivi from '@/views/Suivi';
import Envois from '@/views/Envois';
import Login from '@/views/Login';
import Organigramme from '@/views/Organigramme';
import CadreLegal from '@/views/CadreLegal';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ErreurApi, definirJeton } from '@/lib/api';
import type { CompteSession } from '@/lib/api';
import { useDonnees } from '@/lib/donnees';
import { formatDate } from '@/data';
import type { Role, RoleCompte } from '@/data';
import {
  LayoutDashboard, Users, CalendarDays, FolderOpen, ClipboardList, Settings2,
  Bell, BellRing, Send, LogOut, ShieldCheck, Network, Loader2, AlertCircle, Scale,
} from 'lucide-react';

type Vue = 'dashboard' | 'employes' | 'pointage' | 'conges' | 'suivi' | 'organigramme' | 'legal' | 'envois' | 'parametres';

const ROLE_LIBELLE: Record<string, RoleCompte> = {
  chef_service: 'Chef de service', chef_chantier: 'Chef de chantier', superviseur: 'Superviseur',
};

export default function App() {
  const [session, setSession] = useState<CompteSession | null>(null);
  const [sessionVerifiee, setSessionVerifiee] = useState(false);

  // Reprise de session au chargement : le cookie httpOnly évite de ressaisir
  // le mot de passe après un rechargement de page ou un redémarrage du navigateur.
  useEffect(() => {
    rafraichirSession().then((c) => { if (c) setSession(c); }).finally(() => setSessionVerifiee(true));
  }, []);
  const [vue, setVue] = useState<Vue>('dashboard');
  const [erreur, setErreur] = useState('');

  const [nvMdp, setNvMdp] = useState('');
  const [nvMdp2, setNvMdp2] = useState('');
  const [ancienMdp, setAncienMdp] = useState('');
  const [erreurMdp, setErreurMdp] = useState('');

  const d = useDonnees(session, setErreur);

  const deconnecter = async () => {
    try { await api.deconnexion(); } catch { /* la session locale est effacée dans tous les cas */ }
    definirJeton(null); setSession(null); setVue('dashboard'); setErreur('');
  };

  if (!sessionVerifiee) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          <p className="text-sm">Ouverture de votre session…</p>
        </div>
      </div>
    );
  }

  if (!session) return <Login onConnexion={(c) => { setSession(c); setVue('dashboard'); }} />;

  const estRH = session.role === 'rh';
  const estDirection = session.role === 'direction';
  const role: Role = estRH ? { type: 'rh' } : estDirection ? { type: 'direction' } : { type: 'chef', compteId: session.id };
  const roleCompte = ROLE_LIBELLE[session.role] ?? null;
  const monServiceId = estRH || estDirection ? null : session.serviceId;
  const monChantierId = session.chantierId;
  const nomRole = estRH ? 'Service RH — AIFG' : estDirection ? 'Direction générale — AIFG' : `${session.nom} (${roleCompte?.toLowerCase()})`;

  const nonLues = d.notifications.filter((n) => !n.lue).length;

  const changerMdp = async () => {
    if (nvMdp.length < 8) { setErreurMdp('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    if (!/[a-zA-Z]/.test(nvMdp) || !/[0-9]/.test(nvMdp)) { setErreurMdp('Le mot de passe doit contenir des lettres et des chiffres.'); return; }
    if (nvMdp !== nvMdp2) { setErreurMdp('Les deux saisies ne correspondent pas.'); return; }
    try {
      await api.changerMotDePasse(ancienMdp, nvMdp);
      const moi = await api.moi();
      setSession(moi);
      setNvMdp(''); setNvMdp2(''); setAncienMdp(''); setErreurMdp('');
      await d.actions.recharger();
    } catch (e) {
      setErreurMdp(e instanceof ErreurApi ? e.message : 'Changement impossible.');
    }
  };

  const NAV: { id: Vue; label: string; icone: typeof Users; roles: string[] }[] = [
    { id: 'dashboard', label: 'Tableau de bord', icone: LayoutDashboard, roles: ['rh', 'direction', 'chef_service', 'chef_chantier', 'superviseur'] },
    { id: 'employes', label: 'Employés', icone: Users, roles: ['rh', 'direction', 'chef_service', 'chef_chantier', 'superviseur'] },
    { id: 'pointage', label: 'Pointage', icone: ClipboardList, roles: ['rh', 'direction', 'chef_service', 'chef_chantier', 'superviseur'] },
    { id: 'conges', label: 'Congés & absences', icone: CalendarDays, roles: ['rh', 'direction', 'chef_service', 'chef_chantier', 'superviseur'] },
    { id: 'suivi', label: 'Suivi & alertes', icone: BellRing, roles: ['rh', 'direction', 'chef_service'] },
    { id: 'organigramme', label: 'Organigramme', icone: Network, roles: ['rh', 'direction'] },
    { id: 'legal', label: 'Cadre légal', icone: Scale, roles: ['rh', 'direction'] },
    { id: 'envois', label: 'Envois (mail / WhatsApp)', icone: Send, roles: ['rh'] },
    { id: 'parametres', label: 'Paramètres', icone: Settings2, roles: ['rh'] },
  ];
  const navVisible = NAV.filter((n) => n.roles.includes(session.role));

  const TITRES: Record<Vue, { titre: string; sousTitre: string }> = {
    dashboard: { titre: 'Tableau de bord', sousTitre: "Vue d'ensemble — AIFG et sociétés de sous-traitance" },
    employes: { titre: 'Registre des employés', sousTitre: 'Affectation AIFG / sous-traitance, contrats et rotations' },
    pointage: { titre: 'Pointage mensuel', sousTitre: 'Chef de chantier → chef de service → RH (vérification, validation, impression, archivage)' },
    conges: { titre: 'Congés & absences', sousTitre: 'Circuit chef de service puis RH — notifications e-mail et WhatsApp' },
    suivi: { titre: 'Suivi & alertes', sousTitre: 'Contrats CDD (échéances) et visites médicales — rappels WhatsApp' },
    organigramme: { titre: 'Organigramme', sousTitre: 'Direction → responsables de service → chantiers & personnel de base → employés' },
    legal: { titre: 'Cadre légal', sousTitre: 'Conformité loi 90-11 — droits à congé, jours fériés, paramètres modifiables' },
    envois: { titre: 'Envois', sousTitre: 'Journal des e-mails et messages WhatsApp envoyés par le serveur' },
    parametres: { titre: 'Paramètres', sousTitre: 'Sociétés, services, chantiers, comptes et rotations' },
  };
  const t = TITRES[vue];

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="md:w-64 shrink-0 bg-primary text-primary-foreground md:min-h-screen flex md:flex-col">
        <div className="hidden md:flex items-center gap-2.5 px-5 py-6">
          <FolderOpen className="h-6 w-6" aria-hidden />
          <div>
            <p className="display font-bold text-lg leading-tight">AIFG · Registre RH</p>
            <p className="text-[11px] uppercase tracking-[0.14em] opacity-70">Service du personnel</p>
          </div>
        </div>
        <nav className="flex md:flex-col w-full md:pl-4 md:gap-1.5 overflow-x-auto" aria-label="Navigation principale">
          {navVisible.map((n) => {
            const actif = vue === n.id;
            return (
              <button key={n.id} onClick={() => setVue(n.id)} aria-current={actif ? 'page' : undefined}
                className={`folder-tab flex-1 md:flex-none flex items-center justify-center md:justify-start gap-2.5 px-3 md:px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground
                  ${actif ? 'bg-background text-foreground md:rounded-l-md' : 'text-primary-foreground/75 hover:text-primary-foreground hover:bg-primary-foreground/10 md:rounded-l-md'}`}>
                <n.icone className="h-4 w-4 shrink-0" aria-hidden />
                <span className="hidden sm:inline whitespace-nowrap">{n.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="hidden md:block mt-auto px-5 py-5 space-y-1">
          <p className="text-xs font-medium truncate">{nomRole}</p>
          <p className="text-[11px] opacity-60">Année sociale 2026</p>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="px-5 md:px-8 pt-5 md:pt-6 pb-4 border-b bg-card/60">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="rule-label">Ressources humaines</p>
              <h1 className="text-2xl md:text-3xl font-bold mt-1">{t.titre}</h1>
              <p className="text-sm text-muted-foreground mt-1">{t.sousTitre}</p>
            </div>
            <div className="flex items-center gap-2">
              {d.chargement && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Chargement" />}
              <Popover onOpenChange={(o) => o && nonLues > 0 && d.actions.marquerNotificationsLues()}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon" className="relative" aria-label={`Notifications (${nonLues} non lues)`}>
                    <Bell className="h-4 w-4" aria-hidden />
                    {nonLues > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">{nonLues}</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-96 max-w-[90vw] p-0">
                  <p className="rule-label px-4 py-3 border-b">Notifications — {nomRole}</p>
                  <div className="max-h-80 overflow-y-auto divide-y">
                    {d.notifications.length === 0 && <p className="p-4 text-sm text-muted-foreground">Aucune notification.</p>}
                    {d.notifications.map((n) => (
                      <div key={n.id} className="px-4 py-3">
                        <p className="text-sm">{n.texte}</p>
                        <p className="text-xs text-muted-foreground mt-1">{formatDate(n.date)}</p>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Button variant="outline" onClick={deconnecter}><LogOut className="h-4 w-4 mr-2" aria-hidden />Se déconnecter</Button>
            </div>
          </div>
          {erreur && (
            <div className="mt-3 border border-destructive/40 bg-destructive/5 rounded-md px-4 py-2.5 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-hidden />
              <p className="flex-1">{erreur}</p>
              <button onClick={() => setErreur('')} aria-label="Fermer le message d'erreur" className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
          )}
        </header>

        <div className="px-5 md:px-8 py-6">
          {vue === 'dashboard' && <Dashboard employes={d.employes} conges={d.conges} feuilles={d.feuilles} societes={d.societes} services={d.services} chantiers={d.chantiers} role={session.role}
              nomPerimetre={monChantierId ? (d.chantiers.find((c) => c.id === monChantierId)?.nom ?? '') : (d.services.find((s) => s.id === monServiceId)?.nom ?? 'Tous services')}
              allerA={(v) => setVue(v)} />}
          {vue === 'employes' && (
            <Employes actions={d.actions} employes={d.employes} societes={d.societes} services={d.services}
              chantiers={d.chantiers} rotations={d.rotations} lectureSeule={!estRH} monServiceId={monServiceId} />
          )}
          {vue === 'pointage' && (
            <Pointage actions={d.actions} role={role} roleCompte={roleCompte} monChantierId={monChantierId}
              chantiers={d.chantiers} comptes={d.comptes} nomRole={nomRole} services={d.services} societes={d.societes}
              employes={d.employes} rotations={d.rotations} feuilles={d.feuilles} monServiceId={monServiceId} />
          )}
          {vue === 'conges' && (
            <Conges actions={d.actions} role={role} roleCompte={roleCompte} monServiceId={monServiceId}
              employes={d.employes} services={d.services} societes={d.societes} conges={d.conges} />
          )}
          {vue === 'suivi' && (
            <Suivi employes={d.employes} societes={d.societes} services={d.services} monServiceId={monServiceId}
              rappeler={(id, type) => d.actions.rappel(id, type)} peutNotifier={estRH} />
          )}
          {vue === 'organigramme' && (estRH || estDirection) && (
            <Organigramme services={d.services} chantiers={d.chantiers} comptes={d.comptes} employes={d.employes} societes={d.societes} />
          )}
          {vue === 'legal' && (estRH || estDirection) && <CadreLegal lectureSeule={!estRH} onErreur={setErreur} />}
          {vue === 'envois' && estRH && <Envois envois={d.envois} />}
          {vue === 'parametres' && estRH && (
            <Parametres actions={d.actions} societes={d.societes} services={d.services} chantiers={d.chantiers}
              comptes={d.comptes} rotations={d.rotations} employes={d.employes} />
          )}
        </div>
      </main>

      <Dialog open={session.doitChangerMdp}>
        <DialogContent className="max-w-sm [&>button]:hidden" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="display text-xl flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden />Premier accès — nouveau mot de passe</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Pour sécuriser votre compte, remplacez le mot de passe temporaire reçu par e-mail avant de continuer.</p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ancien-mdp">Mot de passe actuel (temporaire)</Label>
              <Input id="ancien-mdp" type="password" value={ancienMdp} onChange={(e) => setAncienMdp(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nv-mdp">Nouveau mot de passe (8 caractères min., lettres et chiffres)</Label>
              <Input id="nv-mdp" type="password" value={nvMdp} onChange={(e) => setNvMdp(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nv-mdp2">Confirmer le mot de passe</Label>
              <Input id="nv-mdp2" type="password" value={nvMdp2} onChange={(e) => setNvMdp2(e.target.value)} autoComplete="new-password" />
            </div>
          </div>
          {erreurMdp && <p className="text-sm text-destructive">{erreurMdp}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={deconnecter}>Se déconnecter</Button>
            <Button onClick={changerMdp}>Enregistrer et continuer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
