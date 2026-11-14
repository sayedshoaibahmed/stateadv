import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Inbox } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Nothing here yet: a friendly sentence and, where there is one, the next step (UI spec section 7). */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center",
        className,
      )}
    >
      <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium">{title}</p>
      {children ? (
        <p className="max-w-prose text-muted-foreground">{children}</p>
      ) : null}
      {action}
    </div>
  );
}

/**
 * Something went wrong: plain words and "Try again". Pass `onRetry` (a button, inside a page's error boundary) or
 * `retryHref` (a link that loads the page again). Nothing technical is ever shown.
 */
export function ErrorState({
  title = "Something went wrong",
  message = "We could not load this. Nothing has been changed.",
  onRetry,
  retryHref,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryHref?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-rejected/30 bg-rejected-soft p-6 text-center",
        className,
      )}
    >
      <AlertTriangle className="size-6 text-rejected" aria-hidden="true" />
      <p className="font-medium text-rejected">{title}</p>
      <p className="max-w-prose">{message}</p>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={onRetry}
        >
          Try again
        </Button>
      ) : retryHref ? (
        <Link
          href={retryHref}
          className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
        >
          Try again
        </Link>
      ) : null}
    </div>
  );
}

/** Grey placeholders while a page loads. */
export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  );
}

/** Grey bars while a list is loading. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
