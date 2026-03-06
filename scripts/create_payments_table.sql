-- Run this in the Supabase SQL Editor to create the payments table for the MCP Payment API.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_id text not null unique,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'INR',
  payer_id uuid not null references auth.users(id),
  receiver_id uuid not null references auth.users(id),
  group_id uuid not null references public.groups(id) on delete cascade,
  expense_description text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  created_at timestamptz not null default now()
);

-- Optional: index for looking up payments by payment_id or by group
create index if not exists idx_payments_payment_id on public.payments(payment_id);
create index if not exists idx_payments_group_id on public.payments(group_id);
create index if not exists idx_payments_created_at on public.payments(created_at desc);
