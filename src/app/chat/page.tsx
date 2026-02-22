"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCreateChat } from "@/hooks/use-chats";
import { ModelSelector } from "@/components/ModelSelector";
import { SystemPromptEditor } from "@/components/SystemPromptEditor";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload, type UploadedFile } from "@/components/FileUpload";

const BIG_CONTEXT_THRESHOLD = 10000; // chars — matches ChatInput threshold

export default function NewChatPage() {
  const [model, setModel] = useState("anthropic/claude-sonnet-4.6");
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [bigContextMode, setBigContextMode] = useState(false);
  const router = useRouter();
  const createChat = useCreateChat();

  const totalChars = uploadedFiles.reduce((sum, f) => sum + f.content.length, 0);

  // Auto-enable Big Context when files exceed threshold
  useEffect(() => {
    if (totalChars > BIG_CONTEXT_THRESHOLD) {
      setBigContextMode(true);
    } else {
      setBigContextMode(false);
    }
  }, [totalChars]);

  async function handleStart() {
    if (!message.trim() && uploadedFiles.length === 0) return;

    const chat = await createChat.mutateAsync({
      model,
      systemPrompt: systemPrompt ?? undefined,
    });

    if (bigContextMode && uploadedFiles.length > 0) {
      // Big Context mode: store file content and instruction separately
      const combinedContent = uploadedFiles.map((f) => f.content).join("\n\n---\n\n");
      sessionStorage.setItem(
        `pending-message-${chat.id}`,
        JSON.stringify({
          bigContext: true,
          text: combinedContent,
          instruction: message.trim() || "Process this text",
          files: uploadedFiles,
        })
      );
    } else {
      // Normal mode: combine files into message
      const fileParts = uploadedFiles.map((f) => `[File: ${f.name}]\n${f.content}`);
      const fullMessage = [...fileParts, message].filter(Boolean).join("\n\n");
      sessionStorage.setItem(
        `pending-message-${chat.id}`,
        JSON.stringify({
          message: fullMessage,
          files: uploadedFiles,
        })
      );
    }

    router.push(`/chat/${chat.id}`);
  }

  function removeFile(index: number) {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Big Context</h1>
          <p className="text-muted-foreground">
            Chat with any LLM, or process massive documents in parallel.
          </p>
        </div>

        {/* Model selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Model</label>
          <div>
            <ModelSelector value={model} onChange={setModel} />
          </div>
        </div>

        {/* System prompt */}
        <SystemPromptEditor
          value={systemPrompt}
          onChange={setSystemPrompt}
        />

        {/* File upload */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileUpload
              onFilesContent={(files) =>
                setUploadedFiles((prev) => [...prev, ...files])
              }
            />
            {uploadedFiles.length === 0 && (
              <span className="text-xs text-muted-foreground">
                Attach files (.txt, .md, .csv, .json, .pdf)
              </span>
            )}
          </div>
          {uploadedFiles.map((file, idx) => (
            <div
              key={`${file.name}-${idx}`}
              className="flex items-center gap-1 text-sm text-muted-foreground bg-muted rounded-md px-2 py-1"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="truncate max-w-[200px]">{file.name}</span>
              <span className="text-xs">
                ({(file.content.length / 1000).toFixed(0)}K chars)
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 ml-auto shrink-0"
                onClick={() => removeFile(idx)}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>
          ))}
          {/* Big Context toggle */}
          {totalChars > BIG_CONTEXT_THRESHOLD && (
            <div className="flex items-center gap-2 px-2 py-1">
              <span className="text-xs text-muted-foreground">
                {uploadedFiles.length} file{uploadedFiles.length > 1 ? "s" : ""} · {(totalChars / 1000).toFixed(0)}K chars total
              </span>
              <Button
                variant={bigContextMode ? "default" : "outline"}
                size="sm"
                className="h-6 text-xs ml-auto"
                onClick={() => setBigContextMode(!bigContextMode)}
              >
                {bigContextMode ? "Big Context ON" : "Enable Big Context"}
              </Button>
            </div>
          )}
        </div>

        {/* Big Context mode banner */}
        {bigContextMode && (
          <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            <strong>Big Context mode:</strong> Your {uploadedFiles.length > 1 ? "files" : "file"} will be split into
            chunks and processed in parallel. You&apos;ll see a cost estimate before processing begins.
            Type your instruction below (e.g., &quot;Translate to English&quot; or &quot;Summarize each section&quot;).
          </div>
        )}

        {/* Message input */}
        <div className="space-y-2">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              bigContextMode
                ? "Enter instruction for processing (e.g., 'Translate to English')..."
                : "Type your first message..."
            }
            className="min-h-[100px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleStart();
              }
            }}
          />
        </div>

        <Button
          onClick={handleStart}
          disabled={
            createChat.isPending || (!message.trim() && uploadedFiles.length === 0)
          }
          className="w-full"
          size="lg"
        >
          {createChat.isPending
            ? "Creating..."
            : bigContextMode
            ? "Start Big Context Processing"
            : "Start Chat"}
        </Button>
      </div>
    </div>
  );
}
