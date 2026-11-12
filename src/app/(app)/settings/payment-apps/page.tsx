import type { Metadata } from "next";
import Link from "next/link";
import { ErrorState } from "@/components/app/states";
import { Fold } from "@/components/app/settings-forms";
import { ProviderForm } from "@/components/app/bookings/provider-form";
import { requireUser } from "@/lib/auth/session";
import { loadProviders } from "@/lib/bookings/data";

export const metadata: Metadata = { title: "Payment apps" };

export default async function PaymentAppsPage() {
  await requireUser();
  const providers = await loadProviders();
  return (
    <main className="flex max-w-4xl flex-1 flex-col gap-4 p-4">
      <div>
        <Link href="/settings" className="text-sm underline underline-offset-4">
          Back to Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Payment apps</h1>
        <p className="text-muted-foreground">
          The UPI and card apps people can choose when a payment is recorded.
          Renaming or switching one off never changes an old payment.
        </p>
      </div>
      {!providers.ok ? (
        <ErrorState
          title="The apps could not be loaded"
          retryHref="/settings/payment-apps"
        />
      ) : (
        <>
          <section
            className="grid gap-2 rounded-xl border p-4"
            aria-label="Add an app"
          >
            <h2 className="text-lg font-semibold">Add an app</h2>
            <ProviderForm />
          </section>
          <ul className="grid gap-2" aria-label="Payment apps">
            {providers.data.map((p) => (
              <li key={p.id}>
                <Fold
                  title={`${p.name} · ${p.method === "upi" ? "UPI" : "Card"}${p.is_active ? "" : " (switched off)"}`}
                >
                  <ProviderForm
                    provider={{
                      id: p.id,
                      name: p.name,
                      method: p.method === "card" ? "card" : "upi",
                      is_active: p.is_active,
                    }}
                  />
                </Fold>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
