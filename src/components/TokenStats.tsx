"use client";

import { useQuery } from "@tanstack/react-query";
import type { ChatStats } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface TokenStatsProps {
  chatId: string;
  refreshTrigger?: number;
}

export function TokenStats({ chatId, refreshTrigger }: TokenStatsProps) {
  const { data: stats } = useQuery<ChatStats>({
    queryKey: ["chat-stats", chatId, refreshTrigger],
    queryFn: async () => {
      const res = await fetch(`/api/chats/${chatId}/stats`);
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  if (!stats || stats.totalApiCalls === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground hover:text-foreground"
        >
          ${stats.totalCost.toFixed(4)} · {stats.totalTokens.toLocaleString()}{" "}
          tokens
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="space-y-2 text-sm">
          <h4 className="font-semibold">Session Stats</h4>
          <div className="grid grid-cols-2 gap-1 text-xs">
            <span className="text-muted-foreground">API Calls</span>
            <span className="font-mono text-right">{stats.totalApiCalls}</span>
            <span className="text-muted-foreground">Prompt Tokens</span>
            <span className="font-mono text-right">
              {stats.totalPromptTokens.toLocaleString()}
            </span>
            <span className="text-muted-foreground">Completion Tokens</span>
            <span className="font-mono text-right">
              {stats.totalCompletionTokens.toLocaleString()}
            </span>
            <span className="text-muted-foreground">Total Cost</span>
            <span className="font-mono text-right font-medium">
              ${stats.totalCost.toFixed(4)}
            </span>
            {stats.totalCacheSavings > 0 && (
              <>
                <span className="text-muted-foreground">Cache Savings</span>
                <span className="font-mono text-right text-green-600">
                  -${stats.totalCacheSavings.toFixed(4)}
                </span>
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
