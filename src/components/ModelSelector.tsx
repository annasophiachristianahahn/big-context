"use client";

import { useState } from "react";
import { useModels } from "@/hooks/use-models";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const { data: models, isLoading } = useModels();

  const selectedModel = models?.find((m) => m.id === value);

  const featured = models?.filter(
    (m) =>
      m.id === "anthropic/claude-sonnet-4.6" ||
      m.id === "anthropic/claude-opus-4.6"
  );
  const freeModels = models?.filter(
    (m) => m.isFree && !featured?.find((f) => f.id === m.id)
  );
  const paidModels = models?.filter(
    (m) => !m.isFree && !featured?.find((f) => f.id === m.id)
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || isLoading}
          className="justify-between min-w-[200px] max-w-[300px] truncate"
        >
          <span className="truncate">
            {isLoading
              ? "Loading models..."
              : selectedModel?.name ?? "Select model"}
          </span>
          {selectedModel?.isFree && (
            <Badge variant="secondary" className="ml-2 text-[10px] px-1">
              Free
            </Badge>
          )}
          <svg
            className="ml-2 h-4 w-4 shrink-0 opacity-50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models..." />
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_72px_72px_52px] gap-1 px-3 py-1.5 border-b text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            <span>Model</span>
            <span className="text-right">In/1M</span>
            <span className="text-right">Out/1M</span>
            <span className="text-right">Context</span>
          </div>
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            {featured && featured.length > 0 && (
              <CommandGroup heading="Featured">
                {featured.map((model) => (
                  <ModelItem
                    key={model.id}
                    model={model}
                    selected={value === model.id}
                    onSelect={() => {
                      onChange(model.id);
                      setOpen(false);
                    }}
                  />
                ))}
              </CommandGroup>
            )}
            {freeModels && freeModels.length > 0 && (
              <CommandGroup heading="Free Models">
                {freeModels.slice(0, 20).map((model) => (
                  <ModelItem
                    key={model.id}
                    model={model}
                    selected={value === model.id}
                    onSelect={() => {
                      onChange(model.id);
                      setOpen(false);
                    }}
                  />
                ))}
              </CommandGroup>
            )}
            {paidModels && paidModels.length > 0 && (
              <CommandGroup heading="Paid Models">
                {paidModels.map((model) => (
                  <ModelItem
                    key={model.id}
                    model={model}
                    selected={value === model.id}
                    onSelect={() => {
                      onChange(model.id);
                      setOpen(false);
                    }}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  return `${(tokens / 1000).toFixed(0)}K`;
}

function formatPrice(price: number): string {
  if (price >= 100) return `$${price.toFixed(0)}`;
  if (price >= 10) return `$${price.toFixed(1)}`;
  return `$${price.toFixed(2)}`;
}

function ModelItem({
  model,
  selected,
  onSelect,
}: {
  model: { id: string; name: string; contextLength: number; inputPricePerMillion: number; outputPricePerMillion: number; isFree: boolean };
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={model.id + " " + model.name} onSelect={onSelect} className="grid grid-cols-[1fr_72px_72px_52px] gap-1 items-center">
      <div className="flex items-center gap-2 min-w-0">
        {selected && (
          <svg className="w-4 h-4 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        <span className="truncate">{model.name}</span>
      </div>
      {model.isFree ? (
        <span className="col-span-2 text-[11px] text-emerald-500 font-medium text-right">Free</span>
      ) : (
        <>
          <span className="text-[11px] text-muted-foreground text-right tabular-nums">
            {formatPrice(model.inputPricePerMillion)}
          </span>
          <span className="text-[11px] text-muted-foreground text-right tabular-nums">
            {formatPrice(model.outputPricePerMillion)}
          </span>
        </>
      )}
      <span className="text-[11px] text-muted-foreground text-right tabular-nums">
        {formatContext(model.contextLength)}
      </span>
    </CommandItem>
  );
}
