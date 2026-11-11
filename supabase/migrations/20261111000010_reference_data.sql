-- =============================================================================
-- 10 REFERENCE DATA (the only data M2 inserts)
-- Required lists the app cannot work without. Both stay editable in Settings.
-- No users, resorts, guests, bookings or money records are created here.
-- =============================================================================

-- Stay types (decided Q2)
insert into public.stay_types (name, sort_order) values
  ('Resort Stay', 10),
  ('Day Outing',  20),
  ('Package',     30);

-- Payment providers (PRD 5.8): UPI apps and card networks
insert into public.payment_providers (method, name, sort_order) values
  ('upi',  'PhonePe',    10),
  ('upi',  'Google Pay', 20),
  ('upi',  'Paytm',      30),
  ('upi',  'BHIM',       40),
  ('upi',  'Other',      99),
  ('card', 'Visa',       10),
  ('card', 'Mastercard', 20),
  ('card', 'RuPay',      30),
  ('card', 'Other',      99);
