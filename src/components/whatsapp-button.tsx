import { MessageCircle } from "lucide-react";

// A floating shortcut to chat with the shop. Only shown once a WhatsApp number is set in the admin.
export function WhatsAppButton({ number, storeName }: { number: string; storeName: string }) {
  const text = encodeURIComponent(`Hello ${storeName}, I have a question.`);
  return (
    <a
      href={`https://wa.me/${number}?text=${text}`}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Chat with us on WhatsApp"
      title="Chat with us on WhatsApp"
      className="fixed bottom-5 right-5 z-40 flex size-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
    >
      <MessageCircle className="size-6" aria-hidden="true" />
    </a>
  );
}
