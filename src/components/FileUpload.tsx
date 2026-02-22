"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";

export interface UploadedFile {
  content: string;
  name: string;
}

interface FileUploadProps {
  onFilesContent: (files: UploadedFile[]) => void;
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

export function FileUpload({ onFilesContent, disabled }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readSingleFile = useCallback(async (file: File): Promise<UploadedFile> => {
    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
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

      return { content: pages.join("\n\n"), name: file.name };
    } else {
      const text = await file.text();
      return { content: text, name: file.name };
    }
  }, []);

  const handleFiles = useCallback(
    async (fileList: FileList) => {
      setProcessing(true);
      try {
        const files = Array.from(fileList);
        const results = await Promise.all(files.map(readSingleFile));
        onFilesContent(results);
      } catch (error) {
        console.error("Error reading files:", error);
      } finally {
        setProcessing(false);
      }
    },
    [onFilesContent, readSingleFile]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
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
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFiles(e.target.files);
          }
          e.target.value = "";
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || processing}
        onClick={() => inputRef.current?.click()}
        className="h-8 px-2"
        title="Upload files (.txt, .md, .csv, .json, .pdf)"
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
            <p className="text-lg font-medium">Drop files here</p>
            <p className="text-sm text-muted-foreground">
              .txt, .md, .csv, .json, .pdf — multiple files supported
            </p>
          </div>
        </div>
      )}
    </>
  );
}
