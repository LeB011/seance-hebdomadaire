MISE À JOUR - PAGE TÂCHES

Fichiers à remplacer/ajouter dans GitHub :
- index.html
- app.js
- style.css
- supabase-schema.sql

Après upload dans GitHub :
1. Va dans Supabase > SQL Editor.
2. Ouvre le fichier supabase-schema.sql.
3. Copie tout le contenu et clique Run.
4. Attends Success.
5. Netlify se mettra à jour automatiquement après le commit GitHub.

Cette mise à jour ajoute :
- Page Tâches dans le menu
- Création/modification/suppression de tâches
- Priorités : basse, moyenne, haute, urgente
- Statuts : à faire, en cours, terminée
- Échéance/date limite
- Filtres + recherche
- Compteurs dashboard : tâches ouvertes, urgentes, en retard
- Statistiques par priorité
- Table Supabase public.tasks avec RLS admin/utilisateur
