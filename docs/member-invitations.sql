-- NEXORA: email member invitations
create table if not exists public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  name text default '',
  role text not null check (role in ('manajer','kasir','marketing','gudang')),
  branch_ids uuid[] not null default '{}',
  invited_by uuid not null,
  status text not null default 'pending' check (status in ('pending','accepted','expired','cancelled')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists company_invitations_company_email_idx
  on public.company_invitations(company_id, lower(email));

create table if not exists public.company_user_branches (
  id uuid primary key default gen_random_uuid(),
  company_user_id uuid not null references public.company_users(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(company_user_id, branch_id)
);

alter table public.company_invitations enable row level security;
alter table public.company_user_branches enable row level security;

-- These tables are accessed by the NEXORA Vercel API using the Supabase secret key.
-- Do not add a public/anon policy that allows arbitrary inserts or reads.

-- Optional cleanup helper:
create index if not exists company_user_branches_member_idx
  on public.company_user_branches(company_user_id);
