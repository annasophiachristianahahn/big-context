"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useChatDetail, useRefreshChat } from "@/hooks/use-chat-messages";
import { useUpdateChat } from "@/hooks/use-chats";
import { ChatMessages } from "@/components/ChatMessages";
import { ChatInput } from "@/components/ChatInput";
import { ModelSelector } from "@/components/ModelSelector";
import { SystemPromptEditor } from "@/components/SystemPromptEditor";
import { TokenStats } from "@/components/TokenStats";
import { ChunkProgress } from "@/components/ChunkProgress";
import { CostEstimator } from "@/components/CostEstimator";
import type { CostEstimate } from "@/types";

export default function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: chat, isLoading } = useChatDetail(id);
  const refreshChat = useRefreshChat(id);
  const updateChat = useUpdateChat();

  const [localMessages, setLocalMessages] = useState<
    Array<{ id: string; role: string; content: string }>
  >([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [refreshStats, setRefreshStats] = useState(0);
  const [activeChunkJob, setActiveChunkJob] = useState<string | null>(null);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [pendingBigContext, setPendingBigContext] = useState<{
    text: string;
    instruction: string;
  } | null>(null);

  // Sync DB messages to local state
  useEffect(() => {
    if (chat?.messages) {
      setLocalMessages(
        chat.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        }))
      );
    }
  }, [chat?.messages]);

  // Check for pending first message from new chat creation
  useEffect(() => {
    if (!id || isLoading) return;

    const pending = sessionStorage.getItem(`pending-message-${id}`);
    if (pending) {
      sessionStorage.removeItem(`pending-message-${id}`);
      const { message } = JSON.parse(pending);
      if (message) {
        sendMessage(message);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isLoading]);

  async function sendMessage(content: string) {
    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    setLocalMessages((prev) => [
      ...prev,
      { id: tempId, role: "user", content },
    ]);
    setStreamingContent("");
    setIsStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: id, message: content }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let fullContent = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  fullContent += data.content;
                  setStreamingContent(fullContent);
                }
                if (data.done) {
                  setRefreshStats((prev) => prev + 1);
                }
                if (data.error) {
                  setStreamingContent(
                    fullContent + `\n\n**Error:** ${data.error}`
                  );
                }
              } catch {
                // Skip malformed
              }
            }
          }
        }
      }
    } catch (error) {
      setStreamingContent(`Error: ${(error as Error).message}`);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      refreshChat();
    }
  }

  async function handleBigContext(text: string, instruction: string) {
    // Get cost estimate first
    try {
      const res = await fetch("/api/chunk-process?estimate=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: id, text, instruction }),
      });
      if (res.ok) {
        const estimate = await res.json();
        setCostEstimate(estimate);
        setPendingBigContext({ text, instruction });
      }
    } catch (error) {
      console.error("Cost estimate failed:", error);
    }
  }

  async function startChunkProcessing(enableStitch: boolean) {
    if (!pendingBigContext) return;
    setCostEstimate(null);

    try {
      const res = await fetch("/api/chunk-process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: id,
          text: pendingBigContext.text,
          instruction: pendingBigContext.instruction,
          enableStitchPass: enableStitch,
        }),
      });
      if (res.ok) {
        const { jobId } = await res.json();
        setActiveChunkJob(jobId);
        setPendingBigContext(null);
        refreshChat();
      }
    } catch (error) {
      console.error("Start chunk processing failed:", error);
    }
  }

  const handleChunkComplete = useCallback(
    (_output: string) => {
      setActiveChunkJob(null);
      setRefreshStats((prev) => prev + 1);
      refreshChat();
    },
    [refreshChat]
  );

  function handleModelChange(modelId: string) {
    updateChat.mutate({ id, model: modelId });
  }

  function handleSystemPromptChange(value: string | null) {
    updateChat.mutate({ id, systemPrompt: value ?? "" });
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!chat) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Chat not found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ModelSelector
            value={chat.model}
            onChange={handleModelChange}
            disabled={isStreaming}
          />
          <SystemPromptEditor
            value={chat.systemPrompt}
            onChange={handleSystemPromptChange}
            disabled={isStreaming}
          />
        </div>
        <TokenStats chatId={id} refreshTrigger={refreshStats} />
      </div>

      {/* Messages */}
      <ChatMessages
        messages={localMessages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
      />

      {/* Chunk progress */}
      {activeChunkJob && (
        <ChunkProgress
          jobId={activeChunkJob}
          onComplete={handleChunkComplete}
        />
      )}

      {/* Cost estimator dialog */}
      {costEstimate && (
        <CostEstimator
          estimate={costEstimate}
          open={!!costEstimate}
          onConfirm={startChunkProcessing}
          onCancel={() => {
            setCostEstimate(null);
            setPendingBigContext(null);
          }}
        />
      )}

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        onBigContext={handleBigContext}
        disabled={isStreaming || !!activeChunkJob}
      />
    </div>
  );
}
