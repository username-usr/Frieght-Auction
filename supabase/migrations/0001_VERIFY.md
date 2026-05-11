# Phase 1 verification checklist

Run `0001_initial_schema.sql` in the Supabase SQL editor (one paste, click Run).
Then go through these checks. Each one is a query you can paste into the SQL
editor — expected results are listed.

---

## 1. Tables, enums, and functions exist

```sql
-- Should return 8 rows: bids, loads, operators, routes, shipments,
-- trucker_routes, truckers, whatsapp_messages
select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;

-- Should return 9 rows (the enum types)
select typname from pg_type
where typtype = 'e' and typnamespace = 'public'::regnamespace
order by typname;

-- Should return award_bid, is_admin, is_operator, set_updated_at
select proname from pg_proc
where pronamespace = 'public'::regnamespace
order by proname;
```

Open the **Table Editor** sidebar in the Supabase dashboard and confirm all 8
tables show up with the columns you expect. Click into each one and check the
"RLS enabled" badge is on (a green shield).

## 2. RLS is enabled on every table

```sql
-- All 8 rows should have rowsecurity = true.
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
order by tablename;
```

## 3. Policies exist

```sql
-- Expect 4 policies on operators, 3 on each of the other 7 tables = 25 total.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

## 4. Test data + the award_bid function

This is the important one — it exercises the concurrency safeguard.

### 4a. Seed a fake operator, two truckers, a load, two bids

```sql
-- Pretend an admin already exists. We bypass the auth.users FK constraint
-- by inserting directly via the SQL editor (which uses the service role).
-- Use a real auth user id once you've invited yourself via Supabase Auth;
-- this fake one is fine for schema testing.
insert into auth.users (id, email)
  values ('11111111-1111-1111-1111-111111111111', 'test-admin@example.com')
  on conflict (id) do nothing;

insert into operators (id, email, full_name, role)
  values (
    '11111111-1111-1111-1111-111111111111',
    'test-admin@example.com',
    'Test Admin',
    'admin'
  );

insert into truckers (id, phone_e164, full_name, truck_type)
  values
    ('22222222-2222-2222-2222-222222222222', '+919000000001', 'Trucker A', 'open'),
    ('33333333-3333-3333-3333-333333333333', '+919000000002', 'Trucker B', 'open');

insert into loads (
  id, origin_city, destination_city, truck_type_required,
  weight_kg, pickup_deadline, posted_by
) values (
  '44444444-4444-4444-4444-444444444444',
  'Mumbai', 'Pune', 'open',
  10000, now() + interval '2 days',
  '11111111-1111-1111-1111-111111111111'
);

insert into bids (id, load_id, trucker_id, amount_paise, message_text)
  values
    ('55555555-5555-5555-5555-555555555555',
     '44444444-4444-4444-4444-444444444444',
     '22222222-2222-2222-2222-222222222222',
     1500000, 'Bidding 15000 for Mumbai-Pune'),
    ('66666666-6666-6666-6666-666666666666',
     '44444444-4444-4444-4444-444444444444',
     '33333333-3333-3333-3333-333333333333',
     1400000, 'I will do 14000');
```

### 4b. Award bid B (the cheaper one)

```sql
select * from award_bid(
  '44444444-4444-4444-4444-444444444444',  -- load
  '66666666-6666-6666-6666-666666666666',  -- bid B
  '11111111-1111-1111-1111-111111111111'   -- operator
);
```

Expected: one row with a fresh `shipment_id`, `winner_phone = '+919000000002'`,
and `loser_phones = {'+919000000001'}`.

### 4c. Confirm the side effects

```sql
select id, status from loads where id = '44444444-4444-4444-4444-444444444444';
-- → status = 'awarded'

select id, status from bids where load_id = '44444444-4444-4444-4444-444444444444';
-- → bid B is 'won', bid A is 'lost'

select * from shipments where load_id = '44444444-4444-4444-4444-444444444444';
-- → one row, delivery_status = 'pending_pickup'
```

### 4d. Verify the concurrency guard

Try to award the same load again:

```sql
select * from award_bid(
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '11111111-1111-1111-1111-111111111111'
);
```

Expected: `ERROR: award_bid: load <uuid> is not open (status=awarded)`.
This is exactly what we want — second operator's click is rejected cleanly.

### 4e. Verify the bid-belongs-to-load guard

```sql
-- Make a second load and try to award bid A under that load's id.
insert into loads (
  id, origin_city, destination_city, truck_type_required,
  weight_kg, pickup_deadline, posted_by
) values (
  '77777777-7777-7777-7777-777777777777',
  'Delhi', 'Jaipur', 'open',
  5000, now() + interval '1 day',
  '11111111-1111-1111-1111-111111111111'
);

select * from award_bid(
  '77777777-7777-7777-7777-777777777777',
  '55555555-5555-5555-5555-555555555555',  -- bid A, but it's on load #1
  '11111111-1111-1111-1111-111111111111'
);
```

Expected: `ERROR: award_bid: bid <uuid> does not belong to load <uuid>`.

### 4f. Clean up the seed data

```sql
delete from shipments where load_id in (
  '44444444-4444-4444-4444-444444444444',
  '77777777-7777-7777-7777-777777777777');
delete from bids     where load_id in (
  '44444444-4444-4444-4444-444444444444',
  '77777777-7777-7777-7777-777777777777');
delete from loads    where id in (
  '44444444-4444-4444-4444-444444444444',
  '77777777-7777-7777-7777-777777777777');
delete from truckers where id in (
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from operators where id = '11111111-1111-1111-1111-111111111111';
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
```

## 5. Phone-format CHECK constraint actually works

```sql
-- Should ERROR (no leading +).
insert into truckers (phone_e164, truck_type)
  values ('919876543210', 'open');

-- Should ERROR (leading 0 after +).
insert into truckers (phone_e164, truck_type)
  values ('+0919876543210', 'open');

-- Should SUCCEED.
insert into truckers (phone_e164, truck_type)
  values ('+919876543210', 'open');
delete from truckers where phone_e164 = '+919876543210';
```

## 6. RLS sanity check (optional but worth it once)

In the SQL editor, switch the role dropdown (top right of the editor) from
`postgres` to `anon`, then run:

```sql
select count(*) from loads;
```

Expected: `0` rows or a permission error — the anon role is not an operator,
so RLS hides everything. Switch back to `postgres` (which uses service_role
under the hood and bypasses RLS) before continuing.

---

## When you're done

If all of the above pass, the schema is ready and we can move to **Phase 2:
Next.js scaffolding**. Tell me when you're ready.
