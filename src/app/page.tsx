import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * M1 placeholder home page. Replaced by the login page and dashboard in
 * M2/M3.
 */
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Resort Management</CardTitle>
          <CardDescription>
            Project setup is complete. Login and the dashboard will be added in
            the next steps.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href="/api/health">Check system status</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
