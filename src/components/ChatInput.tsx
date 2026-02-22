"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "./FileUpload";

interface ChatInputProps {
  onSend: (message: string) => void;
  onBigContext: (text: string, instruction: string) => void;
  disabled?: boolean;
}

const BIG_CONTEXT_THRESHOLD = 10000; // chars

export function ChatInput({ onSend, onBigContext, disabled }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [uploadedFile, setUploadedFile] = useState<{
    content: string;
    name: string;
  } | null>(null);
  const [bigContextMode, setBigContextMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [message]);

  function handleFileContent(content: string, filename: string) {
    setUploadedFile({ content, name: filename });
    if (content.length > BIG_CONTEXT_THRESHOLD) {
      setBigContextMode(true);
    }
  }

  function handleSend() {
    if (!message.trim() && !uploadedFile) return;

    if (bigContextMode && uploadedFile) {
      onBigContext(uploadedFile.content, message.trim() || "Process this text");
      setMessage("");
      setUploadedFile(null);
      setBigContextMode(false);
    } else {
      const fullMessage = uploadedFile
        ? `[File: ${uploadedFile.name}]\n${uploadedFile.content}\n\n${message}`
        : message;
      onSend(fullMessage);
      setMessage("");
      setUploadedFile(null);
      setBigContextMode(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="border-t bg-background p-4">
      <div className="max-w-3xl mx-auto">
        {/* Uploaded file indicator */}
        {uploadedFile && (
          <div className="mb-2 flex items-center gap-2 text-sm bg-muted rounded-lg px-3 py-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="truncate">{uploadedFile.name}</span>
            <span className="text-muted-foreground shrink-0">
              ({(uploadedFile.content.length / 1000).toFixed(0)}K chars)
            </span>
            {uploadedFile.content.length > BIG_CONTEXT_THRESHOLD && (
              <Button
                variant={bigContextMode ? "default" : "outline"}
                size="sm"
                className="h-6 text-xs ml-auto"
                onClick={() => setBigContextMode(!bigContextMode)}
              >
                {bigContextMode ? "Big Context ON" : "Enable Big Context"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 shrink-0"
              onClick={() => {
                setUploadedFile(null);
                setBigContextMode(false);
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Button>
          </div>
        )}

        {bigContextMode && (
          <div className="mb-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
            Big Context mode: Your file will be split into chunks and processed in parallel.
            Type your instruction below (e.g., &quot;Translate to English&quot; or &quot;Summarize each section&quot;).
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end gap-2">
          <FileUpload onFileContent={handleFileContent} disabled={disabled} />
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              bigContextMode
                ? "Enter instruction for processing..."
                : "Type a message... (Shift+Enter for new line)"
            }
            disabled={disabled}
            className="flex-1 min-h-[40px] max-h-[200px] resize-none text-sm"
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={disabled || (!message.trim() && !uploadedFile)}
            size="sm"
            className="h-10 w-10 p-0 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
}
