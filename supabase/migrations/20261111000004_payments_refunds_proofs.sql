-- =============================================================================
-- 04 PAYMENTS, REFUNDS, PROOF FILES, APPROVAL HISTORY
--
-- Payments (money in) and refunds (money out) are separate tables with the same
-- shape and the same approval rules. Refunds are never negative payments (Q7).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- payments
-- Identity/time columns (payment_code, resort_id, recorded_by, recorded_at,
-- approved_by/at, ...) are filled by triggers from the verified session, so they
-- cannot be faked by the caller (migration 06).
-- ---------------------------------------------------------------------------
create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  payment_code     text   not null,                         -- {booking_code}-P{n}
  booking_id       uuid   not null references public.bookings (id) on delete restrict,
  resort_id        uuid   not null references public.resorts (id) on delete restrict,   -- copied from booking
  amount_paise     bigint not null,
  method           public.payment_method not null,
  provider_id      smallint,
  provider_other   text,
  payment_date     date   not null,                         -- ACTUAL payment date (backdating allowed)
  payment_time     time,
  reference_number text,
  remarks          text,
  status           public.approval_status not null default 'waiting',
  recorded_by      uuid   not null references public.user_profiles (id),
  recorded_at      timestamptz not null default now(),      -- entry time, never editable
  approved_by      uuid references public.user_profiles (id),
  approved_at      timestamptz,
  rejected_by      uuid references public.user_profiles (id),
  rejected_at      timestamptz,
  rejection_reason text,
  reversed_by      uuid references public.user_profiles (id),
  reversed_at      timestamptz,
  reversal_reason  text,
  is_self_approved boolean generated always as (coalesce(approved_by = recorded_by, false)) stored,   -- Q8
  idempotency_key  uuid   not null,
  version          int    not null default 1,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.user_profiles (id),

  constraint payments_code_key  unique (payment_code),
  constraint payments_idem_key  unique (idempotency_key),
  -- A provider must belong to the chosen method (e.g. PhonePe only with UPI).
  constraint payments_provider_fk foreign key (provider_id, method)
    references public.payment_providers (id, method) on delete restrict,
  constraint payments_amount     check (amount_paise > 0 and amount_paise <= 1000000000000000),
  constraint payments_date_min   check (payment_date >= date '2000-01-01'),
  constraint payments_text_len   check (coalesce(length(reference_number), 0) <= 100 and coalesce(length(provider_other), 0) <= 60),
  constraint payments_version_min check (version >= 1),

  -- Each status carries exactly its own decision fields (never silently overwritten).
  constraint payments_waiting_clean check (
    status <> 'waiting' or (approved_by is null and approved_at is null
      and rejected_by is null and rejected_at is null and rejection_reason is null
      and reversed_by is null and reversed_at is null and reversal_reason is null)
  ),
  constraint payments_approved_fields check (
    status <> 'approved' or (approved_by is not null and approved_at is not null
      and rejected_by is null and rejected_at is null and rejection_reason is null
      and reversed_by is null and reversed_at is null and reversal_reason is null)
  ),
  constraint payments_rejected_fields check (
    status <> 'rejected' or (rejected_by is not null and rejected_at is not null
      and length(btrim(coalesce(rejection_reason, ''))) > 0
      and approved_by is null and approved_at is null
      and reversed_by is null and reversed_at is null and reversal_reason is null)
  ),
  constraint payments_reversed_fields check (
    status <> 'reversed' or (approved_by is not null and approved_at is not null
      and reversed_by is not null and reversed_at is not null
      and length(btrim(coalesce(reversal_reason, ''))) > 0
      and rejected_by is null and rejected_at is null and rejection_reason is null)
  )
);
create index payments_booking_idx       on public.payments (booking_id);
create index payments_resort_date_idx   on public.payments (resort_id, payment_date);
create index payments_status_date_idx   on public.payments (status, payment_date);
create index payments_waiting_idx       on public.payments (recorded_at) where status = 'waiting';
create index payments_reference_idx     on public.payments (reference_number) where reference_number is not null;
create index payments_recorded_by_idx   on public.payments (recorded_by);

-- ---------------------------------------------------------------------------
-- refunds (same rules as payments; money going back to the guest)
-- ---------------------------------------------------------------------------
create table public.refunds (
  id               uuid primary key default gen_random_uuid(),
  refund_code      text   not null,                         -- {booking_code}-R{n}
  booking_id       uuid   not null references public.bookings (id) on delete restrict,
  resort_id        uuid   not null references public.resorts (id) on delete restrict,
  amount_paise     bigint not null,
  method           public.payment_method not null,
  provider_id      smallint,
  provider_other   text,
  refund_date      date   not null,                         -- ACTUAL refund date (Q7d)
  refund_time      time,
  reference_number text,
  reason           text   not null,
  remarks          text,
  status           public.approval_status not null default 'waiting',
  recorded_by      uuid   not null references public.user_profiles (id),
  recorded_at      timestamptz not null default now(),
  approved_by      uuid references public.user_profiles (id),
  approved_at      timestamptz,
  rejected_by      uuid references public.user_profiles (id),
  rejected_at      timestamptz,
  rejection_reason text,
  reversed_by      uuid references public.user_profiles (id),
  reversed_at      timestamptz,
  reversal_reason  text,
  is_self_approved boolean generated always as (coalesce(approved_by = recorded_by, false)) stored,
  idempotency_key  uuid   not null,
  version          int    not null default 1,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.user_profiles (id),

  constraint refunds_code_key  unique (refund_code),
  constraint refunds_idem_key  unique (idempotency_key),
  constraint refunds_provider_fk foreign key (provider_id, method)
    references public.payment_providers (id, method) on delete restrict,
  constraint refunds_amount     check (amount_paise > 0 and amount_paise <= 1000000000000000),
  constraint refunds_date_min   check (refund_date >= date '2000-01-01'),
  constraint refunds_reason_len check (length(btrim(reason)) between 1 and 500),
  constraint refunds_text_len   check (coalesce(length(reference_number), 0) <= 100 and coalesce(length(provider_other), 0) <= 60),
  constraint refunds_version_min check (version >= 1),

  constraint refunds_waiting_clean check (
    status <> 'waiting' or (approved_by is null and approved_at is null
      and rejected_by is null and rejected_at is null and rejection_reason is null
      and reversed_by is null and reversed_at is null and reversal_reason is null)
  ),
  constraint refunds_approved_fields check (
    status <> 'approved' or (approved_by is not null and approved_at is not null
      and rejected_by is null and rejected_at is null and rejection_reason is null
      and reversed_by is null and reversed_at is null and reversal_reason is null)
  ),
  constraint refunds_rejected_fields check (
    status <> 'rejected' or (rejected_by is not null and rejected_at is not null
      and length(btrim(coalesce(rejection_reason, ''))) > 0
      and approved_by is null and approved_at is null
      and reversed_by is null and reversed_at is null and reversal_reason is null)
  ),
  constraint refunds_reversed_fields check (
    status <> 'reversed' or (approved_by is not null and approved_at is not null
      and reversed_by is not null and reversed_at is not null
      and length(btrim(coalesce(reversal_reason, ''))) > 0
      and rejected_by is null and rejected_at is null and rejection_reason is null)
  )
);
create index refunds_booking_idx     on public.refunds (booking_id);
create index refunds_resort_date_idx on public.refunds (resort_id, refund_date);
create index refunds_waiting_idx     on public.refunds (recorded_at) where status = 'waiting';

-- ---------------------------------------------------------------------------
-- proofs: screenshot / receipt files of a payment OR a refund.
-- The file lives in private Storage; this row holds only the object name and
-- metadata. Files are hidden, never deleted. After a decision the originals are
-- locked; only a controlled correction file (is_correction) can be added.
-- ---------------------------------------------------------------------------
create table public.proofs (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid references public.payments (id) on delete restrict,
  refund_id          uuid references public.refunds (id) on delete restrict,
  storage_path       text   not null,        -- object name inside bucket "payment-proofs"
  original_file_name text,
  mime_type          text   not null,
  size_bytes         int    not null,
  sha256             text   not null,        -- same file attached twice => warning
  uploaded_by        uuid   not null references public.user_profiles (id),
  uploaded_at        timestamptz not null default now(),
  hidden_at          timestamptz,
  hidden_by          uuid references public.user_profiles (id),
  hidden_reason      text,
  -- Controlled correction (Q9a): a file added AFTER approval. The originals are never touched.
  is_correction      boolean not null default false,
  correction_reason  text,

  constraint proofs_one_parent  check (num_nonnulls(payment_id, refund_id) = 1),
  constraint proofs_path_key    unique (storage_path),
  constraint proofs_path_fmt    check (storage_path ~ '^(refunds/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'),
  constraint proofs_mime        check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  constraint proofs_size        check (size_bytes between 1 and 10485760),
  constraint proofs_sha256_fmt  check (sha256 ~ '^[0-9a-f]{64}$'),
  -- A correction file always carries a written reason of at least 10 characters; an ordinary file never does.
  constraint proofs_correction_fields check (
    (is_correction and length(btrim(coalesce(correction_reason, ''))) >= 10)
    or (not is_correction and correction_reason is null)
  ),
  constraint proofs_hidden      check (
    (hidden_at is null and hidden_by is null and hidden_reason is null)
    or (hidden_at is not null and hidden_by is not null and length(btrim(coalesce(hidden_reason, ''))) > 0)
  )
);
create index proofs_payment_idx on public.proofs (payment_id) where payment_id is not null;
create index proofs_refund_idx  on public.proofs (refund_id)  where refund_id  is not null;
create index proofs_sha256_idx  on public.proofs (sha256);

-- ---------------------------------------------------------------------------
-- approval_history (append-only): every status change of a payment or refund.
-- Rows are written by a trigger (migration 06), so history cannot be skipped.
-- ---------------------------------------------------------------------------
create table public.approval_history (
  id             bigint generated always as identity primary key,
  payment_id     uuid references public.payments (id) on delete restrict,
  refund_id      uuid references public.refunds (id) on delete restrict,
  from_status    public.approval_status,                    -- null when first recorded
  to_status      public.approval_status not null,
  reason         text,
  acted_by       uuid not null references public.user_profiles (id),
  acted_at       timestamptz not null default now(),
  is_self_action boolean not null,                          -- acted_by = recorded_by (Q8)

  constraint approval_history_one_parent check (num_nonnulls(payment_id, refund_id) = 1)
);
create index approval_history_payment_idx on public.approval_history (payment_id, acted_at) where payment_id is not null;
create index approval_history_refund_idx  on public.approval_history (refund_id, acted_at)  where refund_id  is not null;
