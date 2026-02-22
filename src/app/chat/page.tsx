"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateChat } from "@/hooks/use-chats";
import { ModelSelector } from "@/components/ModelSelector";
import { SystemPromptEditor } from "@/components/SystemPromptEditor";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload, type UploadedFile } from "@/components/FileUpload";

export default function NewChatPage() {
  const [model, setModel] = useState("anthropic/claude-sonnet-4.6");
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const router = useRouter();
  const createChat = useCreateChat();

  async function handleStart() {
    if (!message.trim() && uploadedFiles.length === 0) return;

    const chat = await createChat.mutateAsync({
      model,
      systemPrompt: systemPrompt ?? undefined,
    });

    // Build the first message
    const fileParts = uploadedFiles.map((f) => `[File: ${f.name}]\n${f.content}`);
    const fullMessage = [...fileParts, message].filter(Boolean).join("\n\n");

    // Store the first message in sessionStorage so the chat page can pick it up
    sessionStorage.setItem(
      `pending-message-${chat.id}`,
      JSON.stringify({
        message: fullMessage,
        files: uploadedFiles,
      })
    );

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

        {/* Message input */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your first message..."
              className="min-h-[100px]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleStart();
                }
              }}
            />
          </div>

          {/* File upload */}
          <div className="space-y-1">
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
          </div>
        </div>

        <Button
          onClick={handleStart}
          disabled={
            createChat.isPending || (!message.trim() && uploadedFiles.length === 0)
          }
          className="w-full"
          size="lg"
        >
          {createChat.isPending ? "Creating..." : "Start Chat"}
        </Button>
      </div>
    </div>
  );
}
