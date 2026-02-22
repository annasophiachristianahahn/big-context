"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

interface Message {
  id: string;
  chatId: string;
  role: string;
  content: string;
  summary: string | null;
  createdAt: string;
}

interface ChatDetail {
  id: string;
  title: string;
  model: string;
  systemPrompt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export function useChatDetail(chatId: string | undefined) {
  return useQuery<ChatDetail>({
    queryKey: ["chat", chatId],
    queryFn: async () => {
      const res = await fetch(`/api/chats/${chatId}`);
      if (!res.ok) throw new Error("Failed to fetch chat");
      return res.json();
    },
    enabled: !!chatId,
  });
}

export function useRefreshChat(chatId: string | undefined) {
  const queryClient = useQueryClient();

  return () => {
    if (chatId) {
      queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    }
  };
}
