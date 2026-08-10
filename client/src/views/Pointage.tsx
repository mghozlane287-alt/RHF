import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CODES, CODES_TRAVAILLES, EMAIL_RH, codeTheorique, libelleMois, nbJoursMois, prochainCode } from '@/data';
import type { Chantier, CodePointage, CompteChef, Employe, Feuille, RoleCompte, Rotation, Role, Service, Societe } from '@/data';
import { echapperHtml as h } from '@/lib/securite';
import type { Actions } from '@/lib/donnees';
import { AlertTriangle, Archive, ChevronLeft, ChevronRight, FileDown, FilePlus2, Printer, Save, SendHorizonal, Undo2 } from 'lucide-react';

interface Props {
  actions: Actions;
  role: Role;
  roleCompte: RoleCompte | null;
  monChantierId: number | null;
  chantiers: Chantier[];
  comptes: CompteChef[];
  nomRole: string;
  services: Service[];
  societes: Societe[];
  employes: Employe[];
  rotations: Rotation[];
  feuilles: Feuille[];
  monServiceId: number | null;
}

const STATUT_STYLE: Record<Feuille['statut'], string> = {
  'En préparation': 'text-amber-700',
  'Chez le chef de service': 'text-violet-800',
  'Chez RH': 'text-sky-800',
  'Archivée': 'text-primary',
};

const MOIS_DISPONIBLES = ['2026-06', '2026-07', '2026-08', '2026-09'];

export default function Pointage({ actions, role, roleCompte, monChantierId, chantiers, comptes, nomRole, services, societes, employes, rotations, feuilles, monServiceId }: Props) {
  const servicesVisibles = monServiceId ? services.filter((s) => s.id === monServiceId) : services;
  const [serviceId, setServiceId] = useState<string>(String(servicesVisibles[0]?.id ?? ''));
  const [mois, setMois] = useState('2026-08');

  const sid = Number(serviceId);
  const service = services.find((s) => s.id === sid);

  // Périmètre : un chantier du service ou le personnel administratif ('admin')
  const chantiersDuService = chantiers.filter((c) => c.serviceId === sid);
  const perimetresVisibles = monChantierId
    ? chantiersDuService.filter((c) => c.id === monChantierId).map((c) => String(c.id))
    : ['admin', ...chantiersDuService.map((c) => String(c.id))];
  const [perimetre, setPerimetre] = useState<string>(perimetresVisibles[0] ?? 'admin');
  const perimetreValide = perimetresVisibles.includes(perimetre) ? perimetre : (perimetresVisibles[0] ?? 'admin');
  const chantierActif = perimetreValide === 'admin' ? null : chantiers.find((c) => c.id === Number(perimetreValide)) ?? null;
  const cidActif = chantierActif?.id ?? null;
  const nomPerimetre = chantierActif ? `${chantierActif.nom}${chantierActif.lieu ? ' (' + chantierActif.lieu + ')' : ''}` : 'Personnel administratif';

  const feuille = feuilles.find((f) => f.serviceId === sid && f.mois === mois && (f.chantierId ?? null) === cidActif);
  const effectif = useMemo(
    () => chantierActif
      ? employes.filter((e) => e.chantierId === chantierActif.id)
      : employes.filter((e) => e.serviceId === sid && e.categorie === 'Administratif'),
    [employes, sid, chantierActif]
  );
  const nbJours = nbJoursMois(mois);

  // Brouillon local : la saisie est fluide, l'enregistrement est explicite (un seul appel serveur).
  const [brouillon, setBrouillon] = useState<{ employeId: number; jours: CodePointage[]; heuresSupp: number }[]>([]);
  const [modifie, setModifie] = useState(false);
  // Vue « fiche » : indispensable sur téléphone (le tableau 31 colonnes est illisible
  // sur un écran de chantier). Activée par défaut sur les petits écrans.
  const [vueFiche, setVueFiche] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900);
  const [indexEmploye, setIndexEmploye] = useState(0);
  useEffect(() => {
    setBrouillon(feuille ? feuille.lignes.map((l) => ({ ...l, jours: [...l.jours] })) : []);
    setModifie(false);
  }, [feuille?.id, feuille?.statut, feuille?.lignes]);

  // Filet de sécurité : prévenir avant de fermer l'onglet avec une saisie non enregistrée.
  useEffect(() => {
    if (!modifie) return;
    const avertir = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avertir);
    return () => window.removeEventListener('beforeunload', avertir);
  }, [modifie]);

  const estDuService = role.type === 'chef' && monServiceId === sid;
  const estChefService = estDuService && roleCompte === 'Chef de service';
  const estChefChantier = estDuService && (roleCompte === 'Chef de chantier' || roleCompte === 'Superviseur') && monChantierId === cidActif;
  const peutEditer = !!feuille && (
    (feuille.statut === 'En préparation' && (role.type === 'rh' || estChefService || estChefChantier)) ||
    (feuille.statut === 'Chez le chef de service' && (role.type === 'rh' || estChefService))
  );
  const peutCreer = role.type === 'rh' || estChefService || estChefChantier;
  const chefServiceDe = (idSrv: number) => comptes.find((c) => c.serviceId === idSrv && c.role === 'Chef de service');

  const creerFeuille = async () => {
    if (effectif.length === 0) { alert('Aucun employé affecté à ce périmètre.'); return; }
    await actions.creerFeuille(sid, cidActif, mois);
  };

  const changerCode = (employeId: number, jour: number) => {
    if (!peutEditer || !feuille) return;
    const ligne = brouillon.find((l) => l.employeId === employeId);
    if (!ligne) return;
    setBrouillon(brouillon.map((l) => l.employeId !== employeId ? l
      : { ...l, jours: l.jours.map((c, i) => (i === jour ? prochainCode(c) : c)) }));
    setModifie(true);
  };

  const changerHS = (employeId: number, valeur: number) => {
    if (!peutEditer || !feuille) return;
    setBrouillon(brouillon.map((l) => (l.employeId === employeId ? { ...l, heuresSupp: Math.max(0, valeur) } : l)));
    setModifie(true);
  };

  const enregistrer = async () => {
    if (!feuille) return;
    const r = await actions.enregistrerLignes(feuille.id, brouillon.map((l) => ({
      employeId: l.employeId, jours: l.jours, heuresSupp: l.heuresSupp,
    })), feuille.version);
    if (r) setModifie(false);
    return r;
  };

  const soumettreAuChef = async () => {
    if (!feuille) return;
    if (modifie) await enregistrer();
    await actions.changerStatutFeuille(feuille.id, 'Chez le chef de service');
  };

  const transmettre = async () => {
    if (!feuille) return;
    if (modifie) await enregistrer();
    await actions.changerStatutFeuille(feuille.id, 'Chez RH');
  };
  const archiver = async () => {
    if (feuille) await actions.changerStatutFeuille(feuille.id, 'Archivée');
  };
  const renvoyer = async () => {
    if (feuille) await actions.changerStatutFeuille(feuille.id, 'En préparation');
  };

  const imprimer = () => {
    if (!feuille || !service) return;
    const emp = (id: number) => employes.find((e) => e.id === id);
    const soc = (id: number) => societes.find((s) => s.id === id)?.nom ?? '—';
    const stylesCodes = CODES.map((c) => `.c-${c.code}{background:${c.print}}`).join(' ');
    const lignesHtml = brouillon.map((l) => {
      const e = emp(l.employeId); if (!e) return '';
      const tp = l.jours.filter((c) => CODES_TRAVAILLES.includes(c)).length;
      return `<tr><td class="g">${h(e.nom)} ${h(e.prenom)}<br><small>${h(e.poste)} — ${h(soc(e.societeId))}</small></td>${l.jours.map((c) => `<td class="c c-${c}">${c}</td>`).join('')}<td class="t">${tp}</td><td class="t">${Number(l.heuresSupp) || 0}</td></tr>`;
    }).join('');
    const w = window.open('', '_blank');
    if (!w) { alert('Veuillez autoriser les fenêtres pop-up pour imprimer.'); return; }
    try { (w as Window & { opener: unknown }).opener = null; } catch { /* ignore */ }
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Pointage ${h(service.nom)} / ${h(nomPerimetre)} — ${libelleMois(mois)}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:10px;margin:20px;color:#1c2b26}
  h1{font-size:15px;margin:0} h2{font-size:12px;margin:2px 0 10px;font-weight:normal}
  table{border-collapse:collapse;width:100%} td,th{border:1px solid #999;padding:2px;text-align:center;font-size:9px}
  .g{text-align:left;min-width:140px} small{color:#555} .t{font-weight:bold}
  ${stylesCodes}
  .entete{display:flex;justify-content:space-between;margin-bottom:8px}
  .cachet{margin-top:26px;display:flex;justify-content:space-between}
  .cachet div{width:23%;border-top:1px solid #333;padding-top:4px;font-size:9px;text-align:center}
  @media print{body{margin:6mm}}
</style></head><body>
<div class="entete"><div><h1>AIFG — Feuille de pointage mensuelle</h1><h2>Service : ${h(service.nom)} · ${chantierActif ? 'Chantier : ' + h(chantierActif.nom) : 'Personnel administratif'} · Mois : ${libelleMois(mois)} · Statut : ${feuille.statut}</h2></div>
<div style="text-align:right;font-size:9px">Préparée par : ${h(feuille.preparePar)}<br>Validation service : ${feuille.valideServiceLe ?? '—'}<br>Validation RH : ${feuille.valideRHLe ?? '—'}</div></div>
<table><tr><th class="g">Employé</th>${Array.from({ length: nbJours }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>P+IZ</th><th>HS</th></tr>${lignesHtml}</table>
<p style="margin-top:6px;font-size:9px">${CODES.map((c) => `<b>${c.code}</b> ${c.libelle}`).join(' · ')} · <b>HS</b> Heures supplémentaires</p>
<div class="cachet"><div>Le chef de chantier / superviseur</div><div>Le chef de service</div><div>Le responsable RH (cachet)</div></div>
<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <Select value={serviceId} onValueChange={(v) => { setServiceId(v); setPerimetre('admin'); }}>
          <SelectTrigger className="w-full sm:w-64 bg-card" aria-label="Choisir le service"><SelectValue /></SelectTrigger>
          <SelectContent>{servicesVisibles.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nom}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={perimetreValide} onValueChange={setPerimetre}>
          <SelectTrigger className="w-full sm:w-64 bg-card" aria-label="Choisir le chantier ou le personnel administratif"><SelectValue /></SelectTrigger>
          <SelectContent>
            {!monChantierId && <SelectItem value="admin">Personnel administratif</SelectItem>}
            {chantiersDuService
              .filter((c) => !monChantierId || c.id === monChantierId)
              .map((c) => <SelectItem key={c.id} value={String(c.id)}>Chantier : {c.nom}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={mois} onValueChange={setMois}>
          <SelectTrigger className="w-full sm:w-44 bg-card" aria-label="Choisir le mois"><SelectValue /></SelectTrigger>
          <SelectContent>{MOIS_DISPONIBLES.map((m) => <SelectItem key={m} value={m}>{libelleMois(m)}</SelectItem>)}</SelectContent>
        </Select>
        {feuille && <span className={`stamp ${STATUT_STYLE[feuille.statut]} sm:ml-auto`}>{feuille.statut}</span>}
      </div>

      {!feuille ? (
        <Card><CardContent className="py-12 text-center space-y-3">
          <p className="text-muted-foreground">Aucune feuille de pointage pour « {service?.nom} / {nomPerimetre} » — {libelleMois(mois)}.</p>
          {peutCreer ? (
            <Button onClick={creerFeuille}><FilePlus2 className="h-4 w-4 mr-2" aria-hidden />Créer la feuille (pré-remplie selon les rotations)</Button>
          ) : (
            <p className="text-sm text-muted-foreground">Seuls le chef/superviseur de ce chantier, le chef de service et le RH peuvent créer la feuille.</p>
          )}
        </CardContent></Card>
      ) : (
        <>
          {modifie && (
            <div className="border border-amber-500/40 bg-amber-50 rounded-md px-4 py-2.5 text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" aria-hidden />
              <p className="flex-1">Saisie non enregistrée. Cliquez sur « Enregistrer les modifications » pour l'envoyer au serveur.</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border bg-card p-0.5" role="group" aria-label="Mode d'affichage">
              <button onClick={() => setVueFiche(true)}
                className={`px-3 py-1.5 text-xs font-medium rounded-[3px] ${vueFiche ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                Fiche par employé
              </button>
              <button onClick={() => setVueFiche(false)}
                className={`px-3 py-1.5 text-xs font-medium rounded-[3px] ${!vueFiche ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                Tableau complet
              </button>
            </div>
            <p className="text-xs text-muted-foreground hidden sm:block">
              {vueFiche ? 'Recommandé sur téléphone et tablette.' : 'Recommandé sur grand écran.'}
            </p>
          </div>

          {vueFiche ? (() => {
            const l = brouillon[Math.min(indexEmploye, brouillon.length - 1)];
            const e = l && employes.find((x) => x.id === l.employeId);
            if (!l || !e) return null;
            const soc = societes.find((x) => x.id === e.societeId);
            const [an, mo] = mois.split('-').map(Number);
            const decalage = new Date(Date.UTC(an, mo - 1, 1)).getUTCDay(); // 0 = dimanche
            const totalTravaille = l.jours.filter((c) => CODES_TRAVAILLES.includes(c)).length;
            const JOURS_COURTS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
            return (
              <Card>
                <CardContent className="pt-5 space-y-4">
                  {/* Navigation entre employés */}
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="icon" aria-label="Employé précédent"
                      disabled={indexEmploye === 0} onClick={() => setIndexEmploye((i) => Math.max(0, i - 1))}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex-1 min-w-0 text-center">
                      <p className="font-medium truncate">{e.nom} {e.prenom}</p>
                      <p className="text-xs text-muted-foreground truncate">{e.poste} · {soc?.nom}</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                        Employé {indexEmploye + 1} sur {brouillon.length}
                      </p>
                    </div>
                    <Button variant="outline" size="icon" aria-label="Employé suivant"
                      disabled={indexEmploye >= brouillon.length - 1} onClick={() => setIndexEmploye((i) => Math.min(brouillon.length - 1, i + 1))}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Grille calendrier : 7 colonnes, lisible au pouce */}
                  <div>
                    <div className="grid grid-cols-7 gap-1 mb-1">
                      {JOURS_COURTS.map((j, i) => (
                        <div key={i} className={`text-center text-[10px] rule-label ${i === 5 || i === 6 ? 'text-primary' : ''}`}>{j}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: decalage }, (_, i) => <div key={`v${i}`} />)}
                      {l.jours.map((c, i) => {
                        const style = CODES.find((x) => x.code === c)?.couleur ?? '';
                        return (
                          <button key={i} onClick={() => changerCode(l.employeId, i)} disabled={!peutEditer}
                            aria-label={`Jour ${i + 1} : ${CODES.find((x) => x.code === c)?.libelle}. ${peutEditer ? 'Toucher pour changer.' : ''}`}
                            className={`aspect-square rounded-md flex flex-col items-center justify-center ${style} ${peutEditer ? 'active:scale-95 hover:ring-2 hover:ring-primary transition' : ''}`}>
                            <span className="text-[9px] opacity-70 leading-none">{i + 1}</span>
                            <span className="text-[11px] font-bold leading-tight">{c}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                    <div className="flex-1">
                      <p className="rule-label">Jours travaillés (P + IZ)</p>
                      <p className="display text-2xl font-bold tabular-nums">{totalTravaille}</p>
                    </div>
                    <div>
                      <Label htmlFor="hs-fiche" className="rule-label">Heures supp.</Label>
                      {peutEditer ? (
                        <Input id="hs-fiche" type="number" min={0} value={l.heuresSupp}
                          onChange={(ev) => changerHS(l.employeId, Number(ev.target.value))}
                          className="w-24 h-9 mt-1 tabular-nums" />
                      ) : (
                        <p className="display text-2xl font-bold tabular-nums">{l.heuresSupp} h</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })() : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="rule-label text-left px-3 py-2 sticky left-0 bg-muted/95 min-w-[170px] z-10">Employé</th>
                    {Array.from({ length: nbJours }, (_, i) => (
                      <th key={i} className="px-0.5 py-2 font-semibold tabular-nums min-w-[32px]">{i + 1}</th>
                    ))}
                    <th className="rule-label px-2 py-2 whitespace-nowrap">P+IZ</th>
                    <th className="rule-label px-2 py-2 whitespace-nowrap">H. supp</th>
                  </tr>
                </thead>
                <tbody>
                  {brouillon.map((l) => {
                    const e = employes.find((x) => x.id === l.employeId);
                    if (!e) return null;
                    const soc = societes.find((s) => s.id === e.societeId);
                    const total = l.jours.filter((c) => CODES_TRAVAILLES.includes(c)).length;
                    return (
                      <tr key={l.employeId} className="border-t">
                        <td className="px-3 py-1.5 sticky left-0 bg-card z-10">
                          <p className="font-medium text-sm">{e.nom} {e.prenom}</p>
                          <p className="text-muted-foreground">{soc?.nom}{e.categorie === 'Chantier' ? ' · Chantier' : ' · Admin.'}</p>
                        </td>
                        {l.jours.map((c, i) => {
                          const style = CODES.find((x) => x.code === c)?.couleur ?? '';
                          return (
                            <td key={i} className="p-0.5">
                              <button
                                onClick={() => changerCode(l.employeId, i)}
                                disabled={!peutEditer}
                                aria-label={`${e.nom} ${e.prenom}, jour ${i + 1} : ${c}. ${peutEditer ? 'Cliquer pour changer.' : ''}`}
                                className={`w-full h-7 rounded-[3px] font-semibold text-[10px] leading-none ${style} ${peutEditer ? 'hover:ring-1 hover:ring-primary cursor-pointer' : 'cursor-default'}`}
                              >{c}</button>
                            </td>
                          );
                        })}
                        <td className="px-2 text-center font-bold tabular-nums">{total}</td>
                        <td className="px-1.5 text-center">
                          {peutEditer ? (
                            <input
                              type="number" min={0} value={l.heuresSupp ?? 0}
                              onChange={(ev) => changerHS(l.employeId, Number(ev.target.value))}
                              aria-label={`Heures supplémentaires de ${e.nom} ${e.prenom}`}
                              className="w-14 h-7 text-center border rounded-[3px] bg-card tabular-nums"
                            />
                          ) : (
                            <span className="font-bold tabular-nums">{l.heuresSupp ?? 0}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t bg-muted/40">
                    <td className="px-3 py-2 font-semibold sticky left-0 bg-muted/95 z-10">Total du service</td>
                    <td colSpan={nbJours} className="px-2 text-right text-muted-foreground">Jours travaillés / heures supplémentaires →</td>
                    <td className="px-2 text-center font-bold tabular-nums">{brouillon.reduce((s, l) => s + l.jours.filter((c) => CODES_TRAVAILLES.includes(c)).length, 0)}</td>
                    <td className="px-2 text-center font-bold tabular-nums">{brouillon.reduce((s, l) => s + (l.heuresSupp ?? 0), 0)} h</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {modifie && (
              <Button variant="secondary" onClick={enregistrer}>
                <Save className="h-4 w-4 mr-2" aria-hidden />Enregistrer les modifications
              </Button>
            )}
            {feuille.statut === 'En préparation' && estChefChantier && (
              <Button onClick={soumettreAuChef}><SendHorizonal className="h-4 w-4 mr-2" aria-hidden />Soumettre au chef de service</Button>
            )}
            {feuille.statut === 'En préparation' && (role.type === 'rh' || estChefService) && (
              <Button onClick={transmettre}><SendHorizonal className="h-4 w-4 mr-2" aria-hidden />Valider et transmettre au RH</Button>
            )}
            {feuille.statut === 'Chez le chef de service' && (role.type === 'rh' || estChefService) && (
              <>
                <Button onClick={transmettre}><SendHorizonal className="h-4 w-4 mr-2" aria-hidden />Valider et transmettre au RH</Button>
                <Button variant="outline" onClick={renvoyer}><Undo2 className="h-4 w-4 mr-2" aria-hidden />Renvoyer au chantier</Button>
              </>
            )}
            {feuille.statut === 'Chez RH' && role.type === 'rh' && (
              <>
                <Button onClick={archiver}><Archive className="h-4 w-4 mr-2" aria-hidden />Vérifier, valider et archiver</Button>
                <Button variant="outline" onClick={renvoyer}><Undo2 className="h-4 w-4 mr-2" aria-hidden />Renvoyer pour correction</Button>
              </>
            )}
            {(feuille.statut === 'Chez RH' || feuille.statut === 'Archivée') && (
              <>
                <Button variant="outline" onClick={imprimer}><Printer className="h-4 w-4 mr-2" aria-hidden />Imprimer la feuille</Button>
                {role.type === 'rh' && service && (
                  <Button variant="outline" onClick={() => actions.exporterPaie(feuille.id, `paie_${nomPerimetre.replace(/[^\w]+/g, '_')}_${mois}.xlsx`)}>
                    <FileDown className="h-4 w-4 mr-2" aria-hidden />Exporter pour la paie (Excel)
                  </Button>
                )}
              </>
            )}
            {peutEditer && <p className="text-xs text-muted-foreground w-full sm:w-auto">Cliquez sur une case pour faire défiler les codes, puis enregistrez. Les heures supp. se saisissent dans la dernière colonne.</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            {CODES.map((c) => (
              <span key={c.code} className={`text-xs px-2 py-1 rounded-sm ${c.couleur}`}><b>{c.code}</b> — {c.libelle}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
