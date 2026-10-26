import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { subscribeFn } from "@/backend/site.functions";
import { Button } from "@/components/ui/button";

export function NewsletterForm({ source = "homepage" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setState("sending");
    try {
      const result = await subscribeFn({ data: { email, source, website } });
      if (!result.ok) {
        setError(result.message);
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("Something went wrong. Please try again.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="text-sm">
        Thank you for joining the story. Check your inbox for a welcome note.
      </p>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="newsletter-input">
        <input
          type="email"
          required
          aria-label="Email address"
          placeholder="Your email address"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
        />
        <Button
          type="submit"
          variant="inverse"
          aria-label="Join the mailing list"
          disabled={state === "sending"}
        >
          <ArrowRight />
        </Button>
      </div>
      {/* Hidden from people; bots that fill in every field give themselves away. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="newsletter-website">Leave this empty</label>
        <input
          id="newsletter-website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      <p className="mt-3 text-[10px]" role={error ? "alert" : undefined}>
        {error || "We only email about new collections and stories. Unsubscribe any time."}
      </p>
    </form>
  );
}
