alter table public.profiles
add column if not exists phone text,
add column if not exists job_title text,
add column if not exists department text;
