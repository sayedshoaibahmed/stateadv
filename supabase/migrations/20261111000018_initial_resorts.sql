-- =============================================================================
-- 18 FOUR STARTING RESORTS (placeholders)
--
-- The application starts with four resorts so that screens and bookings can be tried at once. The NAMES AND CODES
-- BELOW ARE PLACEHOLDERS, NOT real resort names. Managers rename them (and may add as many more resorts as they need,
-- or switch these off) in Settings -> Resorts. Nothing in the code or database depends on these four.
--
-- A resort's CODE is the first part of every Booking ID of that resort. It can be changed freely until the resort has
-- its first booking, and is locked after that (guard_resort_code), so rename the placeholder codes BEFORE the first
-- real booking if different codes are wanted.
--
-- Safe to run more than once: a name or code that already exists is left alone.
-- =============================================================================
insert into public.resorts (code, name)
select v.code, v.name
from (values
  ('SR1', 'Sample Resort One'),
  ('SR2', 'Sample Resort Two'),
  ('SR3', 'Sample Resort Three'),
  ('SR4', 'Sample Resort Four')
) as v(code, name)
where not exists (select 1 from public.resorts r where r.code = v.code or lower(r.name) = lower(v.name));
