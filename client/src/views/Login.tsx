import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { api, ErreurApi, definirJeton } from '@/lib/api';
import type { CompteSession } from '@/lib/api';
import { FolderOpen, KeyRound } from 'lucide-react';

interface Props {
  onConnexion: (compte: CompteSession) => void;
}

export default function Login({ onConnexion }: Props) {
  const [enCours, setEnCours] = useState(false);
  const [email, setEmail] = useState('');
  const [mdp, setMdp] = useState('');
  const [erreur, setErreur] = useState('');

  const connecter = async () => {
    if (!email.trim() || !mdp) { setErreur('Veuillez saisir votre e-mail et votre mot de passe.'); return; }
    setErreur(''); setEnCours(true);
    try {
      const r = await api.connexion(email.trim(), mdp);
      definirJeton(r.token);
      onConnexion(r.compte);
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : 'Connexion impossible.');
    } finally { setEnCours(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <FolderOpen className="h-7 w-7 text-primary" aria-hidden />
          <div>
            <p className="display font-bold text-xl leading-tight">AIFG · Registre RH</p>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Service du personnel</p>
          </div>
        </div>
        <Card className="border-t-4 border-t-primary">
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Adresse e-mail</Label>
              <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="votre.nom@aifg.dz" autoComplete="username"
                onKeyDown={(e) => e.key === 'Enter' && connecter()} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-mdp">Mot de passe</Label>
              <Input id="login-mdp" type="password" value={mdp} onChange={(e) => setMdp(e.target.value)}
                autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && connecter()} />
            </div>
            {erreur && <p className="text-sm text-destructive">{erreur}</p>}
            <Button className="w-full" onClick={connecter} disabled={enCours}><KeyRound className="h-4 w-4 mr-2" aria-hidden />{enCours ? 'Connexion…' : 'Se connecter'}</Button>
            <p className="text-xs text-muted-foreground text-center">
              Vos identifiants vous sont transmis par e-mail par le service RH.
              Un changement de mot de passe vous sera demandé à la première connexion.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
