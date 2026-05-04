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
9. `migrations/009_flexible_quotation_fields.sql`
10. `migrations/010_section_style_fields.sql`
11. `migrations/011_quotation_layout_settings.sql`
12. `migrations/012_quotation_item_manual_serial.sql`
13. `migrations/013_quotation_total_discount.sql`
14. `migrations/014_quotation_row_height_limits.sql`
15. `migrations/015_quotation_item_cell_layout.sql`
16. `migrations/016_storage_quote_images.sql`
17. `migrations/017_product_template_images.sql`

## Storage buckets

Migration `016_storage_quote_images.sql` creates these private Supabase Storage
buckets when it is run with normal migration privileges:

- `quote-images`
- `product-images`

The migration also creates storage object policies so active authenticated users
can read images, while only `system_owner`, `admin_manager`, and
`sales_designer` can upload or update images. Viewers are read-only. Do not use
a service role key in frontend code.

If your Supabase environment does not allow bucket creation through SQL, create
both buckets manually in the Supabase dashboard with:

- Public bucket: off
- File size limit: 5 MB
- Allowed MIME types: `image/png`, `image/jpeg`, `image/webp`

Then run the policy part of `016_storage_quote_images.sql` in the SQL editor.

Image adjustment settings are non-destructive display metadata. Quotation item
settings live in `quotation_items.cell_layout.images`; product template settings
live in `product_templates.image_settings`. Future PDF export must apply these
settings when rendering thumbnails.

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
