SÉANCE HEBDOMADAIRE SUITE - VERSION PUBLIQUE FONCTIONNELLE

Configuration incluse :
- Supabase URL déjà renseignée
- Supabase anon key déjà renseignée
- Authentification Supabase
- Dashboard complet
- Notes avancées
- Calendrier interne
- Statistiques réelles
- Archives
- Recherche live
- Assistant local sans API externe
- Uploads Supabase avec fallback local
- Admin / rôles / utilisateurs
- Export JSON + CSV
- Paramètres, thème clair/sombre, notifications navigateur
- Netlify prêt

Déploiement :
1. Dépose tout le contenu du ZIP sur Netlify.
2. Dans Supabase, ton compte doit avoir role = admin dans la table profiles.
3. Le site est prêt pour le public.

Important sécurité :
La clé anon Supabase est publique par nature. Les protections viennent des policies RLS dans supabase-schema.sql.
Ne jamais mettre la service_role key dans le front-end.
