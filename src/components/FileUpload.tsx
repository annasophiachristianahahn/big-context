"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";

interface FileUploadProps {
  onFileContent: (content: string, filename: string) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = [
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
];

export function FileUpload({ onFileContent, disabled }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setProcessing(true);
      try {
        if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
          // Dynamic import of PDF.js
          const pdfjsLib = await import("pdfjs-dist");
          pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          const pages: string[] = [];

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((item: any) => (item.str as string) ?? "")
              .join(" ");
            pages.push(pageText);
          }

          onFileContent(pages.join("\n\n"), file.name);
        } else {
          const text = await file.text();
          onFileContent(text, file.name);
        }
      } catch (error) {
        console.error("Error reading file:", error);
      } finally {
        setProcessing(false);
      }
    },
    [onFileContent]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || processing}
        onClick={() => inputRef.current?.click()}
        className="h-8 px-2"
        title="Upload file (.txt, .md, .csv, .json, .pdf)"
      >
        {processing ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        )}
      </Button>

      {/* Drag overlay */}
      {isDragOver && (
        <div
          className="fixed inset-0 z-50 bg-primary/10 backdrop-blur-sm flex items-center justify-center"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragOver(false)}
        >
          <div className="bg-background border-2 border-dashed border-primary rounded-xl p-8 text-center">
            <p className="text-lg font-medium">Drop file here</p>
            <p className="text-sm text-muted-foreground">
              .txt, .md, .csv, .json, .pdf
            </p>
          </div>
        </div>
      )}
    </>
  );
}
