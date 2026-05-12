MISE À JOUR PREMIUM - Séance Hebdomadaire

Fichiers à uploader sur GitHub :
- index.html
- app.js
- style.css
- config.js
- netlify.toml
- supabase-schema.sql

Important : après l'upload GitHub, retourne dans Supabase > SQL Editor > New query.
Copie/colle tout le contenu de supabase-schema.sql puis clique Run.

Cette mise à jour ajoute :
- tâches avancées avec catégorie, priorité, statut, épinglage
- dates début mission / fin mission
- profils disponibles avec urgent / pas urgent + dates début/fin mission
- profils urgents affichés sur le dashboard
- timeline automatique des urgences
- graphiques statistiques premium
- recherche globale notes + tâches
- activité récente
- notifications navigateur pour tâches et rappels

Rien n'utilise Stripe, Google Agenda ou une API IA externe.
Tout fonctionne avec le site + Supabase.
