import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, ErreurApi, urlFichierDocument } from '@/lib/api';
import type { DocumentApi } from '@/lib/api';
import { formatDate, joursRestants } from '@/data';
import { FileText, Image as IconImage, Paperclip, Trash2, Upload, AlertTriangle, Download } from 'lucide-react';

const CATEGORIES_EMPLOYE = [
  'Contrat de travail', "Pièce d'identité", 'Diplôme', 'Certificat médical',
  'Attestation de travail', 'Habilitation', 'Autre',
];
const CATEGORIES_SOCIETE = ['Contrat de sous-traitance', 'Autre'];

interface Props {
  employeId?: number;
  societeId?: number;
  lectureSeule: boolean;
  onErreur: (m: string) => void;
}

const poids = (o: number) => (o < 1024 * 1024 ? `${Math.round(o / 1024)} Ko` : `${(o / 1024 / 1024).toFixed(1)} Mo`);

export default function PiecesJointes({ employeId, societeId, lectureSeule, onErreur }: Props) {
  const [documents, setDocuments] = useState<DocumentApi[]>([]);
  const [chargement, setChargement] = useState(true);
  const [categorie, setCategorie] = useState(employeId ? 'Contrat de travail' : 'Contrat de sous-traitance');
  const [dateDocument, setDateDocument] = useState('');
  const [dateExpiration, setDateExpiration] = useState('');
  const [description, setDescription] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const champFichier = useRef<HTMLInputElement>(null);
  const champPhoto = useRef<HTMLInputElement>(null);

  const categories = employeId ? CATEGORIES_EMPLOYE : CATEGORIES_SOCIETE;

  const charger = async () => {
    setChargement(true);
    try {
      setDocuments(await api.documents({ employeId, societeId }));
    } catch (e) {
      onErreur(e instanceof ErreurApi ? e.message : 'Chargement des pièces jointes impossible.');
    } finally { setChargement(false); }
  };

  useEffect(() => { charger(); /* eslint-disable-next-line */ }, [employeId, societeId]);

  const deposer = async (fichier: File, cat: string) => {
    setEnvoiEnCours(true);
    try {
      await api.deposerDocument(fichier, {
        categorie: cat, employeId, societeId,
        dateDocument: cat === 'Photo' ? '' : dateDocument,
        dateExpiration: cat === 'Photo' ? '' : dateExpiration,
        description: cat === 'Photo' ? '' : description,
      });
      setDateDocument(''); setDateExpiration(''); setDescription('');
      await charger();
    } catch (e) {
      onErreur(e instanceof ErreurApi ? e.message : 'Dépôt impossible.');
    } finally { setEnvoiEnCours(false); }
  };

  const supprimer = async (d: DocumentApi) => {
    if (!confirm(`Supprimer « ${d.nom_original} » ? Le fichier sera définitivement effacé.`)) return;
    try { await api.supprimerDocument(d.id); await charger(); }
    catch (e) { onErreur(e instanceof ErreurApi ? e.message : 'Suppression impossible.'); }
  };

  const photo = documents.find((d) => d.categorie === 'Photo');
  const autres = documents.filter((d) => d.categorie !== 'Photo');

  return (
    <div className="space-y-4">
      {/* ---------- Photo (employés uniquement) ---------- */}
      {employeId && (
        <div className="flex items-center gap-4">
          <div className="h-24 w-20 rounded-md border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0">
            {photo ? (
              <img src={urlFichierDocument(photo.id)} alt="Photo de l'employé" className="h-full w-full object-cover" />
            ) : (
              <IconImage className="h-7 w-7 text-muted-foreground" aria-hidden />
            )}
          </div>
          <div className="space-y-1.5">
            <p className="rule-label">Photo d'identité</p>
            {!lectureSeule && (
              <>
                <Button size="sm" variant="outline" disabled={envoiEnCours}
                  onClick={() => champPhoto.current?.click()}>
                  <Upload className="h-4 w-4 mr-1.5" aria-hidden />
                  {photo ? 'Remplacer la photo' : 'Ajouter une photo'}
                </Button>
                <input ref={champPhoto} type="file" accept="image/jpeg,image/png" className="hidden"
                  aria-label="Photo de l'employé"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) deposer(f, 'Photo'); e.target.value = ''; }} />
                <p className="text-xs text-muted-foreground">JPEG ou PNG, 10 Mo maximum.</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------- Dépôt d'une pièce ---------- */}
      {!lectureSeule && (
        <div className="border rounded-md p-3 space-y-3 bg-muted/30">
          <p className="rule-label flex items-center gap-1.5"><Paperclip className="h-4 w-4" aria-hidden />Ajouter une pièce</p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nature du document</Label>
              <Select value={categorie} onValueChange={setCategorie}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date du document</Label>
              <Input type="date" value={dateDocument} onChange={(e) => setDateDocument(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Expire le</Label>
              <Input type="date" value={dateExpiration} onChange={(e) => setDateExpiration(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="ex. Habilitation électrique BR, certificat n° 4471" />
            </div>
            <div className="flex items-end">
              <Button className="w-full" disabled={envoiEnCours} onClick={() => champFichier.current?.click()}>
                <Upload className="h-4 w-4 mr-1.5" aria-hidden />{envoiEnCours ? 'Envoi…' : 'Choisir le fichier'}
              </Button>
              <input ref={champFichier} type="file" className="hidden"
                accept="image/jpeg,image/png,application/pdf,.docx,.xlsx"
                aria-label="Fichier à déposer"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) deposer(f, categorie); e.target.value = ''; }} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Formats acceptés : JPEG, PNG, PDF, DOCX, XLSX — 10 Mo maximum. Le type réel est vérifié
            à la réception ; un fichier renommé est refusé.
          </p>
        </div>
      )}

      {/* ---------- Liste ---------- */}
      <div className="divide-y border rounded-md">
        {chargement && <p className="p-4 text-sm text-muted-foreground">Chargement des pièces…</p>}
        {!chargement && autres.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground text-center">
            Aucune pièce jointe. Déposez le contrat signé, la pièce d'identité et les certificats.
          </p>
        )}
        {autres.map((d) => {
          const restants = d.date_expiration ? joursRestants(d.date_expiration) : Infinity;
          const expire = restants < 0;
          const proche = !expire && restants <= 60;
          return (
            <div key={d.id} className="px-3 py-2.5 flex items-center gap-3">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{d.nom_original}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {d.categorie} · {poids(d.taille_octets)}
                  {d.date_document && ` · du ${formatDate(d.date_document)}`}
                  {d.description && ` · ${d.description}`}
                </p>
                {d.date_expiration && (
                  <p className={`text-xs flex items-center gap-1 ${expire ? 'text-destructive' : proche ? 'text-amber-700' : 'text-muted-foreground'}`}>
                    {(expire || proche) && <AlertTriangle className="h-3 w-3" aria-hidden />}
                    {expire ? `Expiré depuis le ${formatDate(d.date_expiration)}` : `Valable jusqu'au ${formatDate(d.date_expiration)}`}
                  </p>
                )}
              </div>
              <Button asChild variant="ghost" size="icon" aria-label={`Ouvrir ${d.nom_original}`}>
                <a href={urlFichierDocument(d.id)} target="_blank" rel="noopener noreferrer"><Download className="h-4 w-4" /></a>
              </Button>
              {!lectureSeule && (
                <Button variant="ghost" size="icon" className="text-destructive"
                  aria-label={`Supprimer ${d.nom_original}`} onClick={() => supprimer(d)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
