import { useState } from "react";

import { submitMessageFn } from "@/backend/site.functions";
import { Button } from "@/components/ui/button";
import { MESSAGE_TOPICS, type MessageTopic } from "@/lib/store-types";

const fieldClass =
  "w-full rounded-none border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function ContactForm({ defaultTopic = "general" }: { defaultTopic?: MessageTopic }) {
  const [topic, setTopic] = useState<MessageTopic>(defaultTopic);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setState("sending");
    try {
      const result = await submitMessageFn({ data: { topic, name, email, body, website } });
      if (!result.ok) {
        setError(result.message);
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError("Something went wrong. Please try again, or email us directly.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div role="status" className="border bg-background p-6">
        <h3 className="font-display text-xl">Thank you — your message is on its way.</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          We will reply to {email} as soon as we can.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 border bg-background p-6" noValidate>
      <h3 className="font-display text-xl">Send us a message</h3>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="contact-topic" className="text-sm">
          What is it about?
        </label>
        <select
          id="contact-topic"
          className={fieldClass}
          value={topic}
          onChange={(e) => setTopic(e.target.value as MessageTopic)}
        >
          {MESSAGE_TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="contact-name" className="text-sm">
            Your name
          </label>
          <input
            id="contact-name"
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={100}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="contact-email" className="text-sm">
            Your email
          </label>
          <input
            id="contact-email"
            type="email"
            className={fieldClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="contact-body" className="text-sm">
          Your message
        </label>
        <textarea
          id="contact-body"
          className={fieldClass}
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          required
        />
      </div>
      {/* Hidden from people; bots that fill in every field give themselves away. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="contact-website">Leave this empty</label>
        <input
          id="contact-website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      <Button type="submit" className="rounded-none" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
