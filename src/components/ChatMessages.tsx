"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  // Auto-scroll to bottom on new messages/streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Detect if user has scrolled up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpToBottom(distanceFromBottom > 200);
  }, []);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

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
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto min-h-0 relative"
    >
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

      {/* Jump to bottom button */}
      {showJumpToBottom && (
        <button
          onClick={scrollToBottom}
          className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground shadow-lg text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          Jump to bottom
        </button>
      )}
    </div>
  );
}

const USER_TRUNCATE_LINES = 20; // Show first 20 lines collapsed
const USER_TRUNCATE_CHARS = 2000;

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isBigContext =
    message.content.startsWith("[Big Context Processing]") ||
    message.content.startsWith("[Big Context Processing Failed]");

  const [expanded, setExpanded] = useState(false);

  // Truncate by lines or characters, whichever is shorter
  const lines = message.content.split("\n");
  const shouldTruncate =
    isUser &&
    (message.content.length > USER_TRUNCATE_CHARS || lines.length > USER_TRUNCATE_LINES);

  let displayContent = message.content;
  if (shouldTruncate && !expanded) {
    const byLines = lines.slice(0, USER_TRUNCATE_LINES).join("\n");
    const byChars = message.content.slice(0, USER_TRUNCATE_CHARS);
    displayContent = byLines.length < byChars.length ? byLines : byChars;
  }

  const charCount = message.content.length;
  const lineCount = lines.length;

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
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-2 flex items-center gap-1 text-xs font-medium rounded-md px-2 py-1 bg-primary-foreground/20 hover:bg-primary-foreground/30 transition-colors"
              >
                {expanded ? (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                    Collapse
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    Show full message ({lineCount} lines · {(charCount / 1000).toFixed(0)}K chars)
                  </>
                )}
              </button>
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
