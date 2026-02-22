"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CopyButton } from "./CopyButton";
import { Button } from "@/components/ui/button";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0">
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
    <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
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
        {isStreaming && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Thinking...
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const TRUNCATE_THRESHOLD = 1500; // characters before truncating user messages

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isBigContext =
    message.content.startsWith("[Big Context Processing]") ||
    message.content.startsWith("[Big Context Processing Failed]");

  const [expanded, setExpanded] = useState(false);
  const shouldTruncate = isUser && message.content.length > TRUNCATE_THRESHOLD;
  const displayContent =
    shouldTruncate && !expanded
      ? message.content.slice(0, TRUNCATE_THRESHOLD)
      : message.content;

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
          <div>
            <p className="whitespace-pre-wrap text-sm break-words">{displayContent}</p>
            {shouldTruncate && (
              <Button
                variant="link"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                className="h-auto p-0 mt-1 text-xs text-primary-foreground/70 hover:text-primary-foreground"
              >
                {expanded
                  ? "Show less"
                  : `... Show all (${(message.content.length / 1000).toFixed(0)}K chars)`}
              </Button>
            )}
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none break-words overflow-hidden [&_pre]:bg-background/50 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_code]:text-xs">
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
