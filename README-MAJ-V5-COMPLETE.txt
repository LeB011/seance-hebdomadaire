MISE À JOUR V5 COMPLÈTE — BASE STABLE + AJOUTS AVANCÉS

Cette version garde la base qui fonctionne déjà et ajoute les fonctionnalités discutées :

1. Sécurité / session
- Déconnexion automatique après 1h d'inactivité.
- Popup d'avertissement avant expiration.
- Bouton “Rester connecté”.
- Bouton “Verrouiller maintenant”.

2. Admin
- Compte admin prévu : admin@admin.ch.
- Panneau Admin visible uniquement aux admins.
- Liste des utilisateurs.
- Rôle user/admin modifiable.
- Présence en ligne/hors ligne.
- Dernière activité utilisateur.
- Logs d’activité.

3. Tâches évolutives
- Statuts : À faire, En cours, En attente, Partiellement fait, À relancer, Urgent, Terminé.
- Barre de progression de 0 à 100%.
- Historique d’évolution par tâche.
- Actions rapides : Partiel, À relancer, Terminer/Réouvrir.
- Date de début, fin et relance.
- Tâches épinglées sur le dashboard.

4. Dashboard vivant
- Tâches urgentes/épinglées.
- Tâches en retard.
- Profils urgents.
- Collaborateurs actifs/urgents.
- Timeline immédiate.
- Centre de notifications interne.
- Historique récent.

5. Recherche globale
- Recherche dans les notes.
- Recherche dans les tâches.
- Recherche dans les collaborateurs.
- Recherche dans les logs d’activité.

6. Notifications
- Notifications navigateur si autorisées.
- Centre de notifications interne visible dans le dashboard.
- Détection des tâches en retard, tâches du jour, relances, collaborateurs urgents, disponibilités dépassées.

7. Thèmes
- Thème sombre premium.
- Thème clair premium blanc/classé.
- Affichage compact disponible.

8. Collaborateurs
- La base collaborateur est conservée.
- Ajout / modification / suppression.
- Domaine, disponibilité début/fin, urgence, statut, téléphone, email, notes.
- Recherche et filtres collaborateurs.

IMPORTANT SUPABASE
- Après avoir remplacé les fichiers sur GitHub, lance le fichier supabase-schema.sql dans Supabase > SQL Editor.
- Garde les mêmes variables Vercel : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.
- Ne supprime aucune table existante.

CONTRÔLE
- app.js contrôlé avec node --check.
- ZIP créé sans changer config.js.
