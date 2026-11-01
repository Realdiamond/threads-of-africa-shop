import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { countryName, countrySearchScore } from "@/lib/countries";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  value: string;
  countries: string[];
  onChange: (code: string) => void;
  className?: string;
  invalid?: boolean;
};

// A country picker with a search box: the delivery list can hold every country in the world, which
// is too long to scroll through on a phone. Typing matches the country's name or its two-letter code.
export function CountryCombobox({ id, value, countries, onChange, className, invalid }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid ? true : undefined}
          className={cn(className, "flex items-center justify-between text-left")}
        >
          <span className={value ? undefined : "text-muted-foreground"}>
            {value ? countryName(value) : "Choose a country…"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] rounded-none p-0"
      >
        <Command
          filter={(code, search, keywords) =>
            countrySearchScore(code, keywords?.[0] ?? code, search)
          }
        >
          <CommandInput placeholder="Search countries…" aria-label="Search countries" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {countries.map((code) => (
                <CommandItem
                  key={code}
                  value={code}
                  keywords={[countryName(code)]}
                  onSelect={() => {
                    onChange(code);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === code ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  {countryName(code)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
