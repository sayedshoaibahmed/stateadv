/**
 * The catalog queries used to compare a local rebuild of the migrations with the hosted project
 * (npm run catalog:local, npm run catalog:compare). The SAME text runs on both sides; each returns one text column `h`
 * per item, so the two sides can be compared as sets. Read-only.
 * Definitions are compared with the "extensions." prefix removed: PostgreSQL prints it or not depending on the
 * session's search_path, which is not a real difference.
 */
const strip = (s) => `replace(${s}, 'extensions.', '')`;

export const CATALOG_QUERIES = {
  columns: `select c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||':'||a.attidentity::text h
    from pg_attribute a join pg_class c on c.oid=a.attrelid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where c.relnamespace='public'::regnamespace and c.relkind in ('r','v','p') and a.attnum>0 and not a.attisdropped`,
  constraints: `select conrelid::regclass::text||'.'||conname||'='||${strip("pg_get_constraintdef(oid)")}||':'||condeferrable||':'||condeferred h from pg_constraint where connamespace='public'::regnamespace`,
  indexes: `select tablename||'.'||indexname||'='||${strip("indexdef")} h from pg_indexes where schemaname='public'`,
  triggers: `select c.relnamespace::regnamespace::text||'.'||c.relname||'.'||t.tgname||'='||${strip("pg_get_triggerdef(t.oid)")}||':'||t.tgenabled::text h from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and (c.relnamespace='public'::regnamespace or (c.relnamespace='auth'::regnamespace and c.relname='users'))`,
  policies: `select schemaname||'.'||tablename||'.'||policyname||'='||coalesce(qual,'')||'~'||coalesce(with_check,'')||'~'||cmd||'~'||roles::text||'~'||permissive h from pg_policies where schemaname in ('public','storage')`,
  functions: `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||md5(${strip("pg_get_functiondef(p.oid)")})||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||coalesce(p.proconfig::text,'') h from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p')`,
  function_privileges: `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|anon='||has_function_privilege('anon',p.oid,'execute')||'|auth='||has_function_privilege('authenticated',p.oid,'execute')||'|service='||has_function_privilege('service_role',p.oid,'execute')||'|public='||has_function_privilege('public',p.oid,'execute') h from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p')`,
  table_privileges: `select table_name||'|'||grantee||'|'||privilege_type h from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role')`,
  column_privileges: `select table_name||'.'||column_name||'|'||grantee||'|'||privilege_type h from information_schema.column_privileges where table_schema='public' and grantee in ('anon','authenticated')`,
  rls: `select c.relname||':'||c.relrowsecurity||':'||c.relforcerowsecurity h from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'`,
  enums: `select t.typname||'='||string_agg(e.enumlabel,',' order by e.enumsortorder) h from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname`,
  views: `select c.relname||'='||md5(${strip("pg_get_viewdef(c.oid,true)")})||':'||coalesce(c.reloptions::text,'') h from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('v','m')`,
  relations: `select c.relname||':'||c.relkind::text h from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','S','v','p','m')`,
};

/** Row counts of the reference tables, shown for information only (data legitimately changes after the apply). */
export const ROW_COUNT_QUERY = `select
  (select count(*) from public.stay_types)::int stay_types, (select count(*) from public.payment_providers)::int payment_providers,
  (select count(*) from public.resorts)::int resorts, (select count(*) from public.audit_logs)::int audit_logs,
  (select count(*) from public.user_profiles)::int user_profiles, (select count(*) from public.bookings)::int bookings`;
