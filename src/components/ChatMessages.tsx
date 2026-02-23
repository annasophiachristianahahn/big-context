"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Button } from "@/components/ui/button";
import { ScrollScrubber } from "./ScrollScrubber";

interface Message {
  id: string;
  role: string;
  content: string;
}

interface ChatMessagesProps {
  messages: Message[];
  streamingContent: string;
  isStreaming: boolean;
  onSendToNewChat?: (content: string) => void;
}

export function ChatMessages({
  messages,
  streamingContent,
  isStreaming,
  onSendToNewChat,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const userIsNavigatingRef = useRef(false);

  // Auto-scroll to bottom on new messages/streaming (paused during scrubber drag)
  useEffect(() => {
    if (userIsNavigatingRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleScrubberDragging = useCallback((dragging: boolean) => {
    userIsNavigatingRef.current = dragging;
  }, []);

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
      className="flex-1 overflow-y-auto min-h-0 relative hide-native-scrollbar"
    >
      <div ref={contentRef} className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onSendToNewChat={onSendToNewChat}
          />
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

      {/* Scroll scrubber for long documents */}
      <ScrollScrubber
        scrollRef={scrollRef}
        contentRef={contentRef}
        onDraggingChange={handleScrubberDragging}
      />
    </div>
  );
}

const USER_TRUNCATE_LINES = 20; // Show first 20 lines collapsed
const USER_TRUNCATE_CHARS = 2000;

function MessageBubble({
  message,
  onSendToNewChat,
}: {
  message: Message;
  onSendToNewChat?: (content: string) => void;
}) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isBigContext =
    message.content.startsWith("[Big Context Processing]") ||
    message.content.startsWith("[Big Context Processing Failed]");
  const isStreaming = message.id === "streaming";

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // --- Action handlers ---

  // For user messages, strip Big Context metadata and only copy the user's actual input
  function getUserCopyText(): string {
    const content = message.content;
    if (content.startsWith("[Big Context Processing]")) {
      const match = content.match(/^.*\nInstruction:\s*(.*)/);
      return match ? match[1].trim() : content;
    }
    return content;
  }

  async function handleCopy() {
    const text = isUser ? getUserCopyText() : message.content;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const blob = new Blob([message.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `response-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleSendToChat() {
    onSendToNewChat?.(message.content);
  }

  return (
    <div
      className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}
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

      {/* Copy button below user messages */}
      {isUser && (
        <div className="flex items-center gap-1 mt-1.5 mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            {copied ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}

      {/* Action buttons below assistant messages */}
      {isAssistant && !isStreaming && (
        <div className="flex items-center gap-1 mt-1.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Copy to clipboard */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            {copied ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
            {copied ? "Copied" : "Copy"}
          </Button>

          {/* Download as .txt */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download .txt
          </Button>

          {/* Send to new chat */}
          {onSendToNewChat && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSendToChat}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              Send to new chat
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
