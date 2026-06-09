create table if not exists public.app_settings (
  id integer primary key default 1 check (id = 1),
  school_name text not null default 'Spojená škola škola, Ružínska ulica 210/22, Kysak',
  active_month text not null,
  edit_from_day integer not null default 5 check (edit_from_day between 1 and 31),
  edit_until_day integer not null default 29 check (edit_until_day between 1 and 31),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (
  id,
  school_name,
  active_month,
  edit_from_day,
  edit_until_day
)
values (
  1,
  'Spojená škola škola, Ružínska ulica 210/22, Kysak',
  to_char(current_date, 'YYYY-MM'),
  5,
  29
)
on conflict (id) do nothing;

create table if not exists public.overtime_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  teacher_name text not null,
  work_date date not null,
  hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  reason text not null,
  note text not null default '',
  month text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists overtime_entries_user_id_idx
  on public.overtime_entries(user_id);

create index if not exists overtime_entries_month_idx
  on public.overtime_entries(month);

create table if not exists public.overtime_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  hours numeric(7,2) not null default 0 check (hours >= 0),
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

create index if not exists overtime_usage_user_month_idx
  on public.overtime_usage(user_id, month);

alter table public.app_settings enable row level security;
alter table public.overtime_entries enable row level security;
alter table public.overtime_usage enable row level security;

-- Aplikacia pristupuje k tabulkam iba cez server so service role klucom.
-- Preto netreba povolit priamy pristup z prehliadaca.
