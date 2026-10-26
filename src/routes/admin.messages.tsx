import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  adminDeleteMessageFn,
  adminListMessagesFn,
  adminSetMessageStatusFn,
} from "@/backend/admin.functions";
import {
  adminCall,
  formatDateTime,
  Notice,
  PageHeader,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { MESSAGE_TOPICS } from "@/lib/store-types";

type Filter = "new" | "handled";

export const Route = createFileRoute("/admin/messages")({
  validateSearch: (search: { status?: unknown }): { status?: Filter | undefined } => ({
    status: search.status === "new" || search.status === "handled" ? search.status : undefined,
  }),
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: ({ deps }) => adminListMessagesFn({ data: { status: deps.status } }),
  component: MessagesPage,
});

const topicLabel = (topic: string) => MESSAGE_TOPICS.find((t) => t.value === topic)?.label ?? topic;

function MessagesPage() {
  const messages = Route.useLoaderData();
  const { status } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    const result = await adminCall(action);
    if (!result.ok) setMessage({ kind: "error", text: result.message ?? "That did not work." });
    await router.invalidate();
  }

  const tabs: Array<{ label: string; value: Filter | undefined }> = [
    { label: "All", value: undefined },
    { label: "New", value: "new" },
    { label: "Handled", value: "handled" },
  ];

  return (
    <>
      <PageHeader
        title="Messages"
        description="Messages sent through the contact, wholesale and collaboration forms. Each one also arrives by email."
      />
      <div className="mb-4 flex gap-1" role="tablist" aria-label="Filter messages">
        {tabs.map((tab) => (
          <Button
            key={tab.label}
            role="tab"
            aria-selected={status === tab.value}
            variant={status === tab.value ? "default" : "ghost"}
            size="sm"
            onClick={() => void navigate({ search: { status: tab.value } })}
          >
            {tab.label}
          </Button>
        ))}
      </div>
      {message && (
        <Notice kind={message.kind} className="mb-4">
          {message.text}
        </Notice>
      )}
      {messages.length === 0 ? (
        <div className="rounded-lg border bg-background p-10 text-center text-sm text-muted-foreground">
          {status ? `No ${status} messages.` : "No messages yet."}
        </div>
      ) : (
        <ul className="space-y-3">
          {messages.map((item) => (
            <li key={item.id} className="rounded-lg border bg-background p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {item.name}{" "}
                    <span className="font-normal text-muted-foreground">&lt;{item.email}&gt;</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {topicLabel(item.topic)} · {formatDateTime(item.createdAt)}
                  </p>
                </div>
                <StatusBadge status={item.status === "new" ? "draft" : "active"} />
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.body}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a
                    href={`mailto:${item.email}?subject=${encodeURIComponent(`Re: ${topicLabel(item.topic)}`)}`}
                  >
                    Reply by email
                  </a>
                </Button>
                {item.status === "new" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      run(() =>
                        adminSetMessageStatusFn({ data: { id: item.id, status: "handled" } }),
                      )
                    }
                  >
                    Mark as handled
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      run(() => adminSetMessageStatusFn({ data: { id: item.id, status: "new" } }))
                    }
                  >
                    Mark as new
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => {
                    if (window.confirm("Delete this message for good?"))
                      void run(() => adminDeleteMessageFn({ data: { id: item.id } }));
                  }}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Looking for something else?{" "}
        <Link to="/admin" className="underline">
          Back to the dashboard
        </Link>
      </p>
    </>
  );
}
