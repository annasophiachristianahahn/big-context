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
      <PopoverContent className="w-[350px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models..." />
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
    <CommandItem value={model.id + " " + model.name} onSelect={onSelect} className="flex items-center justify-between">
      <div className="flex items-center gap-2 min-w-0">
        {selected && (
          <svg className="w-4 h-4 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        <span className="truncate">{model.name}</span>
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0 ml-2 text-right">
        {model.isFree
          ? "Free"
          : `$${model.inputPricePerMillion.toFixed(2)} in / $${model.outputPricePerMillion.toFixed(2)} out`}
        {" · "}
        {(model.contextLength / 1000).toFixed(0)}K ctx
      </span>
    </CommandItem>
  );
}
