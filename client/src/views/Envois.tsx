import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/data';
import type { Envoi } from '@/data';
import { Mail, MessageCircle, ExternalLink } from 'lucide-react';

interface Props { envois: Envoi[]; }

export default function Envois({ envois }: Props) {
  const liste = [...envois].sort((a, b) => b.id - a.id);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground max-w-3xl">
        Chaque étape du circuit (demandes, validations, refus, rappels de visite médicale, renouvellements de contrat)
        déclenche un message envoyé automatiquement par le serveur. Si la messagerie automatique n'est pas encore
        configurée, le message est préparé ici avec un lien à ouvrir d'un clic.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {liste.length === 0 && (
          <Card className="lg:col-span-2"><CardContent className="py-12 text-center text-muted-foreground">
            Aucun envoi pour le moment. Les messages apparaîtront ici au fil des validations et des alertes.
          </CardContent></Card>
        )}
        {liste.map((e) => (
          <Card key={e.id} className={`border-l-4 ${e.canal === 'whatsapp' ? 'border-l-primary/70' : 'border-l-sky-600/60'}`}>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {e.canal === 'whatsapp'
                    ? <MessageCircle className="h-4 w-4 text-primary shrink-0" aria-hidden />
                    : <Mail className="h-4 w-4 text-sky-700 shrink-0" aria-hidden />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{e.destinataire}</p>
                    <p className="text-xs text-muted-foreground truncate">{e.contact || 'coordonnées manquantes'} · {formatDate(e.date)}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`stamp ${e.canal === 'whatsapp' ? 'text-primary' : 'text-sky-800'}`}>{e.canal === 'whatsapp' ? 'WhatsApp' : 'E-mail'}</span>
                  {e.statut && (
                    <span className={`stamp ${e.statut === 'envoye' ? 'text-primary' : e.statut === 'echec' ? 'text-destructive' : 'text-amber-700'}`}>
                      {e.statut === 'envoye' ? 'Envoyé' : e.statut === 'echec' ? 'Échec' : 'À ouvrir'}
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm font-medium">{e.sujet}</p>
              <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">{e.message}</p>
              {e.erreur && <p className="mt-2 text-xs text-destructive">Erreur d'envoi : {e.erreur}</p>}
              {e.lien ? (
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <a href={e.lien} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1.5" aria-hidden />
                    Ouvrir dans {e.canal === 'whatsapp' ? 'WhatsApp' : 'la messagerie'}
                  </a>
                </Button>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">{e.statut === 'envoye' ? 'Message envoyé automatiquement par le serveur.' : 'Aucun lien disponible.'}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
