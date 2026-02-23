"use client";

import { useState, useMemo } from "react";
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
import type { ModelInfo } from "@/types";

type SortOption = "default" | "name" | "price-low" | "price-high" | "newest";

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

const FEATURED_IDS = [
  "google/gemini-2.5-flash",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-opus-4.6",
];

export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<SortOption>("default");
  const { data: models, isLoading } = useModels();

  const selectedModel = models?.find((m) => m.id === value);

  const { featured, sortedModels } = useMemo(() => {
    if (!models) return { featured: [], sortedModels: [] };

    const feat = models.filter((m) => FEATURED_IDS.includes(m.id));
    const rest = models.filter((m) => !FEATURED_IDS.includes(m.id));

    let sorted: ModelInfo[];
    switch (sort) {
      case "name":
        sorted = [...rest].sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "price-low":
        sorted = [...rest].sort((a, b) => {
          // Free first, then by input price ascending
          if (a.isFree && !b.isFree) return -1;
          if (!a.isFree && b.isFree) return 1;
          return a.inputPricePerMillion - b.inputPricePerMillion;
        });
        break;
      case "price-high":
        sorted = [...rest].sort((a, b) => {
          // Paid first (most expensive), then free
          if (a.isFree && !b.isFree) return 1;
          if (!a.isFree && b.isFree) return -1;
          return b.inputPricePerMillion - a.inputPricePerMillion;
        });
        break;
      case "newest":
        sorted = [...rest].sort((a, b) => b.createdAt - a.createdAt);
        break;
      default:
        sorted = rest; // original order from API (free first, then alphabetical)
        break;
    }

    return { featured: feat, sortedModels: sorted };
  }, [models, sort]);

  // In default mode, split into free/paid groups
  const freeModels = sort === "default" ? sortedModels.filter((m) => m.isFree) : [];
  const paidModels = sort === "default" ? sortedModels.filter((m) => !m.isFree) : [];

  const sortButtons: { key: SortOption; label: string }[] = [
    { key: "default", label: "Default" },
    { key: "name", label: "A-Z" },
    { key: "price-low", label: "$ Low" },
    { key: "price-high", label: "$ High" },
    { key: "newest", label: "Newest" },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || isLoading}
          className="justify-between min-w-0 sm:min-w-[200px] max-w-[300px] truncate"
        >
          {isLoading && (
            <svg className="w-4 h-4 shrink-0 animate-spin mr-1" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
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
      <PopoverContent className="w-[calc(100vw-2rem)] max-w-[540px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models..." />
          {/* Sort controls */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b flex-wrap">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">Sort</span>
            {sortButtons.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                  sort === s.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {/* Column headers - hidden on small screens */}
          <div className="hidden sm:grid grid-cols-[1fr_72px_72px_56px] gap-1 px-3 py-1.5 border-b text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            <span>Model</span>
            <span className="text-right">In/1M</span>
            <span className="text-right">Out/1M</span>
            <span className="text-right">Context</span>
          </div>
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            {/* Featured always on top */}
            {featured.length > 0 && (
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
            {/* Default mode: show grouped Free / Paid */}
            {sort === "default" && freeModels.length > 0 && (
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
            {sort === "default" && paidModels.length > 0 && (
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
            {/* Sorted mode: flat list */}
            {sort !== "default" && sortedModels.length > 0 && (
              <CommandGroup heading={`All Models · ${sortedModels.length}`}>
                {sortedModels.map((model) => (
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
  model: ModelInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  const priceLabel = model.isFree
    ? "Free"
    : `${formatPrice(model.inputPricePerMillion)} in / ${formatPrice(model.outputPricePerMillion)} out`;

  return (
    <CommandItem value={model.id + " " + model.name} onSelect={onSelect}>
      {/* Desktop: grid columns */}
      <div className="hidden sm:grid grid-cols-[1fr_72px_72px_56px] gap-1 items-center w-full">
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
      </div>
      {/* Mobile: stacked layout */}
      <div className="flex sm:hidden items-center justify-between w-full gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {selected && (
            <svg className="w-4 h-4 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          <span className="truncate">{model.name}</span>
        </div>
        <span className={`text-[10px] shrink-0 whitespace-nowrap ${model.isFree ? "text-emerald-500 font-medium" : "text-muted-foreground"}`}>
          {priceLabel} · {formatContext(model.contextLength)}
        </span>
      </div>
    </CommandItem>
  );
}
