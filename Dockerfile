# ============================================================
# Registre RH AIFG — image de production
# Construction en deux étapes : l'interface est compilée dans une
# image jetable, seul le résultat est copié dans l'image finale.
# ============================================================

# --- Étape 1 : compilation de l'interface ---
FROM node:22-alpine AS client
WORKDIR /build
# Si la construction echoue ici avec « /client: not found », c'est que les dossiers
# client/ et serveur/ ne sont pas a la racine du depot : l'envoi par glisser-deposer
# sur le site de GitHub n'inclut pas les dossiers. Utilisez git (voir DEPOT-GITHUB.md).
COPY client/package.json client/package-lock.json ./
# npm uniquement : enchainer deux gestionnaires de paquets (pnpm puis npm en repli)
# laisse un arbre de dependances incoherent et fait echouer l'installation.
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npx vite build

# --- Étape 2 : image finale ---
FROM node:22-alpine
WORKDIR /app

# Dépendances de production uniquement
COPY serveur/package.json serveur/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY serveur/ ./
COPY --from=client /build/dist ./public

# L'application ne tourne pas en root
RUN addgroup -S aifg && adduser -S aifg -G aifg \
 && mkdir -p /app/fichiers /app/logs \
 && chown -R aifg:aifg /app
USER aifg

ENV NODE_ENV=production \
    HOTE=0.0.0.0 \
    PORT=3001 \
    DOSSIER_FICHIERS=/app/fichiers

EXPOSE 3001

# Sonde de santé : vérifie réellement l'accès à la base
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/sante').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
