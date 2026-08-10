/**
 * Messagerie automatique : e-mail (SMTP/nodemailer) et WhatsApp (Meta Cloud API).
 * Si les identifiants ne sont pas configurés (.env), le message est enregistré
 * avec un lien wa.me / mailto prêt à ouvrir (statut 'lien') — l'application
 * reste utilisable sans coupure.
 */
import nodemailer from 'nodemailer';
import { q } from './db.js';

const SMTP_HOTE = process.env.SMTP_HOTE || '';
const WA_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WA_TELEPHONE_ID = process.env.WHATSAPP_TELEPHONE_ID || '';

const transporteur = SMTP_HOTE
  ? nodemailer.createTransport({
      host: SMTP_HOTE,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURISE === 'true',
      auth: process.env.SMTP_UTILISATEUR
        ? { user: process.env.SMTP_UTILISATEUR, pass: process.env.SMTP_MDP }
        : undefined,
    })
  : null;

export function telVersWa(tel) {
  const chiffres = String(tel || '').replace(/\D/g, '');
  if (!chiffres) return '';
  if (chiffres.startsWith('213')) return chiffres;
  if (chiffres.startsWith('0')) return '213' + chiffres.slice(1);
  return '213' + chiffres;
}

async function envoyerEmail(contact, sujet, message) {
  if (!transporteur) return { statut: 'lien', lien: `mailto:${contact}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(message)}` };
  await transporteur.sendMail({
    from: process.env.SMTP_EXPEDITEUR || 'rh@aifg.dz',
    to: contact, subject: sujet, text: `${message}\n\n— AIFG, service RH`,
  });
  return { statut: 'envoye', lien: '' };
}

async function envoyerWhatsApp(contact, sujet, message) {
  const num = telVersWa(contact);
  if (!num) throw new Error('Numéro de téléphone manquant.');
  const texte = `${sujet}\n\n${message}\n\n— AIFG, service RH`;
  if (!WA_TOKEN || !WA_TELEPHONE_ID) {
    return { statut: 'lien', lien: `https://wa.me/${num}?text=${encodeURIComponent(texte)}` };
  }
  const rep = await fetch(`https://graph.facebook.com/v19.0/${WA_TELEPHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: num, type: 'text', text: { body: texte } }),
  });
  if (!rep.ok) throw new Error(`WhatsApp API ${rep.status}: ${await rep.text()}`);
  return { statut: 'envoye', lien: '' };
}

/** Point d'entrée unique : journalise puis tente l'envoi automatique. */
export async function envoyer(canal, destinataire, contact, sujet, message) {
  const ins = await q(
    `INSERT INTO envois (canal,destinataire,contact,sujet,message) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [canal, destinataire, contact || '', sujet, message]
  );
  const id = ins.rows[0].id;
  try {
    const r = canal === 'email'
      ? await envoyerEmail(contact, sujet, message)
      : await envoyerWhatsApp(contact, sujet, message);
    await q('UPDATE envois SET statut=$1, lien=$2 WHERE id=$3', [r.statut, r.lien, id]);
  } catch (e) {
    await q("UPDATE envois SET statut='echec', erreur=$1 WHERE id=$2", [String(e.message || e).slice(0, 500), id]);
  }
  return id;
}

export const notifier = (cible, texte) =>
  q('INSERT INTO notifications (cible, texte) VALUES ($1,$2)', [cible, texte]);
