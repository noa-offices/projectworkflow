# Supabase Setup

Run migrations in this order:

1. `migrations/001_profiles_roles_rls.sql`
2. `migrations/002_brands_categories.sql`
3. `migrations/003_product_templates_components.sql`
4. `migrations/004_add_option_type_to_product_components.sql`
5. `migrations/005_clients_projects.sql`
6. `migrations/006_add_project_year.sql`
7. `migrations/007_project_contact_fields.sql`
8. `migrations/008_quotations.sql`

The first user should sign up normally through the app. After that signup creates
the profile row, promote the first user manually in Supabase SQL:

```sql
update public.profiles
set role = 'system_owner',
    account_status = 'active',
    updated_at = now()
where email = 'YOUR_EMAIL_HERE';
```

Do not commit `.env.local`, database passwords, Supabase service role keys,
client quotation files, supplier price list PDFs, or generated private
documents.
