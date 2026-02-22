"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CopyButton } from "./CopyButton";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Message {
  id: string;
  role: string;
  content: string;
}

interface ChatMessagesProps {
  messages: Message[];
  streamingContent: string;
  isStreaming: boolean;
}

export function ChatMessages({
  messages,
  streamingContent,
  isStreaming,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <h2 className="text-2xl font-semibold mb-2">Big Context</h2>
          <p className="text-muted-foreground">
            Chat with any LLM, or process massive documents by splitting them
            into parallel chunks. Upload a file or start typing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isStreaming && streamingContent && (
          <MessageBubble
            message={{
              id: "streaming",
              role: "assistant",
              content: streamingContent,
            }}
          />
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isBigContext =
    message.content.startsWith("[Big Context Processing]") ||
    message.content.startsWith("[Big Context Processing Failed]");

  return (
    <div
      className={`group flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`relative max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : isBigContext
            ? "bg-amber-500/10 border border-amber-500/20"
            : "bg-muted"
        }`}
      >
        {!isUser && (
          <div className="absolute -top-1 -right-1">
            <CopyButton text={message.content} />
          </div>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&_pre]:bg-background/50 [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-xs">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
