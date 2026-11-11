# ER_DIAGRAM — Entity Relationships

Status: M0 final draft. Renders on GitHub (Mermaid). Column details are in DATABASE_SCHEMA.md.

```mermaid
erDiagram
    AUTH_USERS ||--|| USER_PROFILES : "has profile"

    RESORTS ||--o{ BOOKINGS : "has"
    RESORTS ||--o{ BOOKING_SEQUENCES : "one counter per year"
    GUESTS ||--o{ BOOKINGS : "makes"
    AGENTS_PARTNERS ||--o{ BOOKINGS : "C/O agent or partner"
    STAY_TYPES ||--o{ BOOKINGS : "stay type"

    BOOKINGS ||--o{ PAYMENT_PLAN_REVISIONS : "plan revisions"
    PAYMENT_PLAN_REVISIONS ||--o{ PAYMENT_SCHEDULES : "rows created"
    PAYMENT_PLAN_REVISIONS ||--o{ EXPECTED_ADJUSTMENTS : "adjustments"
    BOOKINGS ||--o{ PAYMENT_SCHEDULES : "plan rows (active + replaced)"
    BOOKINGS ||--o{ EXPECTED_ADJUSTMENTS : "dated corrections"
    RESORTS ||--o{ EXPECTED_ADJUSTMENTS : "resort_id copy"
    BOOKINGS ||--o{ PAYMENTS : "money in"
    BOOKINGS ||--o{ REFUNDS : "money out"
    BOOKINGS ||--o{ BOOKING_PDF_VERSIONS : "PDF versions"
    BOOKINGS ||--o{ PDF_JOBS : "PDF queue"

    PAYMENT_PROVIDERS ||--o{ PAYMENTS : "provider"
    PAYMENT_PROVIDERS ||--o{ REFUNDS : "provider"
    PAYMENTS ||--o{ PROOFS : "screenshots"
    REFUNDS ||--o{ PROOFS : "screenshots"
    PAYMENTS ||--o{ APPROVAL_HISTORY : "status changes"
    REFUNDS ||--o{ APPROVAL_HISTORY : "status changes"

    USER_PROFILES ||--o{ BOOKINGS : "created / updated / cancelled by"
    USER_PROFILES ||--o{ PAYMENTS : "recorded / approved / rejected / reversed by"
    USER_PROFILES ||--o{ REFUNDS : "recorded / approved / rejected / reversed by"
    USER_PROFILES ||--o{ APPROVAL_HISTORY : "acted by"
    USER_PROFILES ||--o{ AUDIT_LOGS : "actor / target user"

    USER_PROFILES {
        uuid id PK "= auth.users.id"
        text full_name "shown in app"
        citext email UK
        user_role role "owner-account protection only"
        bool is_active
        bool must_change_password
    }
    RESORTS {
        uuid id PK
        citext code UK "locked after first booking"
        text name
        text location
        text contact_number
        text logo_path
        bool is_active
    }
    BOOKING_SEQUENCES {
        uuid resort_id PK
        int year PK "booking date year"
        int last_value
    }
    GUESTS {
        uuid id PK
        text full_name
        text mobile
        text mobile_normalized
    }
    AGENTS_PARTNERS {
        uuid id PK
        partner_type type
        text name
        bool is_active
    }
    STAY_TYPES {
        smallint id PK
        text name UK "Resort Stay, Day Outing, Package"
        bool is_active
    }
    BOOKINGS {
        uuid id PK
        text booking_code UK
        uuid resort_id FK "immutable"
        int booking_year "immutable"
        int booking_seq
        uuid guest_id FK
        int pax
        co_category co_category
        uuid agent_partner_id FK
        text co_name
        smallint stay_type_id FK
        date booking_date
        timestamptz check_in_at
        timestamptz check_out_at
        int nights
        pricing_method pricing_method
        bigint tariff_per_person_paise
        bigint base_amount_paise
        bigint extra_charges_paise
        bigint total_amount_paise "generated"
        bigint discount_paise
        bigint manual_adjustment_paise
        text manual_adjustment_reason
        bigint final_amount_paise "generated"
        booking_status status
        date cancellation_date
        bigint cancellation_charge_paise
        bigint amount_due_paise "generated"
        uuid idempotency_key UK
        int version
    }
    PAYMENT_SCHEDULES {
        uuid id PK
        uuid booking_id FK
        uuid revision_id FK
        plan_kind kind "booking or cancellation"
        int line_no
        date due_date "locked once past"
        bigint amount_paise
        timestamptz superseded_at "NULL = active"
    }
    PAYMENT_PLAN_REVISIONS {
        uuid id PK
        uuid booking_id FK
        int revision_no
        text source
        text reason
        bigint amount_due_before
        bigint amount_due_after
    }
    EXPECTED_ADJUSTMENTS {
        uuid id PK
        uuid booking_id FK
        uuid resort_id FK
        uuid revision_id FK
        date adjustment_date
        bigint amount_paise "signed"
        adjustment_source source
        text reason
    }
    PAYMENT_PROVIDERS {
        smallint id PK
        payment_method method
        text name
    }
    PAYMENTS {
        uuid id PK
        text payment_code UK
        uuid booking_id FK
        uuid resort_id FK
        bigint amount_paise
        payment_method method
        date payment_date
        approval_status status
        uuid recorded_by FK
        uuid approved_by FK
        bool is_self_approved "generated"
        uuid idempotency_key UK
    }
    REFUNDS {
        uuid id PK
        text refund_code UK
        uuid booking_id FK
        uuid resort_id FK
        bigint amount_paise
        payment_method method
        date refund_date
        text reason
        approval_status status
        uuid recorded_by FK
        uuid approved_by FK
        bool is_self_approved "generated"
        uuid idempotency_key UK
    }
    PROOFS {
        uuid id PK
        uuid payment_id FK "one of"
        uuid refund_id FK "one of"
        text storage_path UK
        text mime_type
        text sha256
        timestamptz hidden_at
    }
    APPROVAL_HISTORY {
        bigint id PK
        uuid payment_id FK "one of"
        uuid refund_id FK "one of"
        approval_status from_status
        approval_status to_status
        text reason
        uuid acted_by FK
        bool is_self_action
    }
    BOOKING_PDF_VERSIONS {
        uuid id PK
        uuid booking_id FK
        int version_no
        text storage_path UK
        text content_hash
    }
    PDF_JOBS {
        bigint id PK
        uuid booking_id FK
        pdf_job_status status
    }
    AUDIT_LOGS {
        bigint id PK
        timestamptz occurred_at
        uuid actor_id
        uuid target_user_id
        text action
        text table_name
        text record_id
        uuid booking_id
        jsonb old_data
        jsonb new_data
        text reason
    }
```

## Relationship notes
- **Resort → Booking → Payments / Refunds** is the main chain. `payments.resort_id` and `refunds.resort_id` are trigger-checked copies of the booking's resort, used for fast reports.
- `booking_sequences` has one row per resort per booking-date year (Q4).
- **Proofs** and **approval history** are shared by payments and refunds. Each row belongs to exactly one of them (CHECK).
- **Append-only:** `approval_history`, `booking_pdf_versions`, `audit_logs`, `payment_plan_revisions`, `expected_adjustments`, superseded `payment_schedules` rows, and past due `payment_schedules` rows (locked, D2).
- **Expected collection** = active plan rows (by due date) + expected adjustments (by adjustment date). Their total per booking always equals `bookings.amount_due_paise`.
- `user_profiles.role` affects only Owner-account protection. At least one active Owner always exists.
- Files (logos, proofs, PDFs) live in Supabase Storage. The tables hold paths and metadata only.
- `audit_logs.booking_id` and `audit_logs.target_user_id` are plain columns (not FKs), so the log is never blocked by schema changes.
