# Supabase Setup

Run `migrations/001_profiles_roles_rls.sql` first.

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
