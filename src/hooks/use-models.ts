"use client";

import { useQuery } from "@tanstack/react-query";
import type { ModelInfo } from "@/types";

export function useModels() {
  return useQuery<ModelInfo[]>({
    queryKey: ["models"],
    queryFn: async () => {
      const res = await fetch("/api/models");
      if (!res.ok) throw new Error("Failed to fetch models");
      return res.json();
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}
