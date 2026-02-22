"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateChat } from "@/hooks/use-chats";
import { ModelSelector } from "@/components/ModelSelector";
import { SystemPromptEditor } from "@/components/SystemPromptEditor";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "@/components/FileUpload";

export default function NewChatPage() {
  const [model, setModel] = useState("anthropic/claude-sonnet-4.6");
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [uploadedFile, setUploadedFile] = useState<{
    content: string;
    name: string;
  } | null>(null);
  const router = useRouter();
  const createChat = useCreateChat();

  async function handleStart() {
    if (!message.trim() && !uploadedFile) return;

    const chat = await createChat.mutateAsync({
      model,
      systemPrompt: systemPrompt ?? undefined,
    });

    // Send the first message via the chat page
    const fullMessage = uploadedFile
      ? `[File: ${uploadedFile.name}]\n${uploadedFile.content}\n\n${message}`
      : message;

    // Store the first message in sessionStorage so the chat page can pick it up
    sessionStorage.setItem(
      `pending-message-${chat.id}`,
      JSON.stringify({
        message: fullMessage,
        file: uploadedFile,
      })
    );

    router.push(`/chat/${chat.id}`);
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
          <div className="flex items-center gap-2">
            <FileUpload
              onFileContent={(content, name) =>
                setUploadedFile({ content, name })
              }
            />
            {uploadedFile && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <span className="truncate max-w-[200px]">
                  {uploadedFile.name}
                </span>
                <span>
                  ({(uploadedFile.content.length / 1000).toFixed(0)}K chars)
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={() => setUploadedFile(null)}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </Button>
              </div>
            )}
          </div>
        </div>

        <Button
          onClick={handleStart}
          disabled={
            createChat.isPending || (!message.trim() && !uploadedFile)
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
