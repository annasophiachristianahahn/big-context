"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface SystemPromptEditorProps {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

export function SystemPromptEditor({
  value,
  onChange,
  disabled,
}: SystemPromptEditorProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(!expanded)}
        className="h-7 text-xs text-muted-foreground"
      >
        <svg
          className={`w-3 h-3 mr-1 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        System Prompt
        {value && <span className="ml-1 text-primary">*</span>}
      </Button>

      {expanded && (
        <div className="mt-1 px-2">
          <Textarea
            value={value ?? ""}
            onChange={(e) =>
              onChange(e.target.value.trim() ? e.target.value : null)
            }
            placeholder="Optional system prompt (e.g., 'You are a literary translator specializing in Japanese to English')"
            disabled={disabled}
            className="text-xs min-h-[60px] max-h-[120px]"
            rows={2}
          />
        </div>
      )}
    </div>
  );
}
