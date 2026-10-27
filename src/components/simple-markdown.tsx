import { Fragment, type ReactNode } from "react";

// A deliberately tiny formatter for policy pages: headings (#, ##, ###), bullet lists (- ),
// paragraphs, **bold**, *italic* and [links](https://…). It builds React elements directly and
// never injects HTML, so whatever is typed in the admin cannot run a script on the page.

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;
const SAFE_LINK = /^(https:\/\/|mailto:|\/)[^\s]*$/;

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = `${keyBase}-${index}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link && SAFE_LINK.test(link[2]!)) {
      const external = link[2]!.startsWith("https://");
      return (
        <a
          key={key}
          href={link[2]}
          className="underline underline-offset-4"
          {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
        >
          {link[1]}
        </a>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function SimpleMarkdown({ text }: { text: string }) {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/);
  return (
    <div className="space-y-5 text-sm leading-7 text-muted-foreground">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        const lines = block.split("\n");
        const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0]!);
        if (heading && lines.length === 1) {
          const level = heading[1]!.length;
          // The page title is the h1, so sections start at h2 whether written as # or ##.
          const Tag = level <= 2 ? "h2" : "h3";
          return (
            <Tag key={key} className="pt-4 font-display text-xl text-foreground">
              {inline(heading[2]!, key)}
            </Tag>
          );
        }
        if (lines.every((line) => /^[-*]\s+/.test(line))) {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {lines.map((line, i) => (
                <li key={`${key}-${i}`}>{inline(line.replace(/^[-*]\s+/, ""), `${key}-${i}`)}</li>
              ))}
            </ul>
          );
        }
        // A heading followed directly by text on the next line.
        if (heading) {
          const Tag = heading[1]!.length <= 2 ? "h2" : "h3";
          return (
            <div key={key}>
              <Tag className="pt-4 font-display text-xl text-foreground">
                {inline(heading[2]!, key)}
              </Tag>
              <p className="mt-2">{inline(lines.slice(1).join(" "), `${key}-p`)}</p>
            </div>
          );
        }
        return <p key={key}>{inline(lines.join(" "), key)}</p>;
      })}
    </div>
  );
}
