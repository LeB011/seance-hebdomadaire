MISE A JOUR STABLE CONTROLEE - Séance Hebdomadaire

Fichiers à mettre sur GitHub :
- index.html
- app.js
- style.css
- config.js
- netlify.toml
- supabase-schema.sql

Corrections incluses :
- le loader ne reste plus bloqué si une erreur Supabase/JS arrive
- chaque onglet est chargé séparément, donc une erreur sur un module ne casse plus tout le site
- Dashboard, Nouvelle note, Mes notes, Archives, Recherche restent accessibles
- Nouvelle note ouvre directement l’éditeur
- Tâches avancées avec priorité, dates début/fin, urgent/épingle, retard
- Profils urgents avec urgent/pas urgent, début mission, fin mission
- Profils urgents visibles sur le dashboard
- Page collaborateurs/en attente
- Graphiques visibles dans dashboard/statistiques
- Timeline et activité récente
- Menu organisé avec dropdown
- Responsive mobile renforcé

Contrôles effectués :
- node --check app.js : OK
- simulation de clics sur tous les onglets : OK
- vérification présence des fichiers essentiels : OK

Après upload GitHub :
1. Attendre Netlify Published
2. Faire Ctrl+F5 sur PC
3. Sur téléphone, fermer/rouvrir l’app navigateur ou ouvrir en navigation privée
4. Relancer supabase-schema.sql dans Supabase SQL Editor si les tables tasks/collaborators n’existent pas encore
