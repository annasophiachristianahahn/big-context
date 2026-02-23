"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useChats, useDeleteChat, useDeleteChats, useRenameChat } from "@/hooks/use-chats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./ThemeToggle";

interface ChatSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function ChatSidebar({ isOpen, onToggle, collapsed, onToggleCollapse }: ChatSidebarProps) {
  const { data: chats, isLoading } = useChats();
  const deleteChat = useDeleteChat();
  const deleteChats = useDeleteChats();
  const renameChat = useRenameChat();
  const router = useRouter();
  const pathname = usePathname();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Prefetch the new chat page for instant navigation
  useEffect(() => {
    router.prefetch("/chat");
  }, [router]);

  const filteredChats = chats?.filter(
    (c) =>
      !searchQuery ||
      c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function handleNewChat() {
    router.push("/chat");
    if (isOpen) onToggle();
  }

  function handleSelectChat(id: string) {
    if (selectMode) {
      toggleSelection(id);
      return;
    }
    router.push(`/chat/${id}`);
    if (isOpen) onToggle();
  }

  function handleStartRename(id: string, currentTitle: string) {
    setEditingId(id);
    setEditTitle(currentTitle);
  }

  async function handleRename(id: string) {
    if (editTitle.trim()) {
      renameChat.mutate({ id, title: editTitle.trim() });
    }
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    deleteChat.mutate(id);
    if (pathname === `/chat/${id}`) {
      router.push("/chat");
    }
  }

  // --- Multi-select ---
  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    if (filteredChats) {
      setSelectedIds(new Set(filteredChats.map((c) => c.id)));
    }
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    deleteChats.mutate(ids);
    if (pathname && ids.some((id) => pathname === `/chat/${id}`)) {
      router.push("/chat");
    }
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [selectedIds, deleteChats, pathname, router]);

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  const sidebarContent = (
    <div className="flex flex-col h-full bg-muted/50">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <h1 className="font-semibold text-sm">Big Context</h1>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={handleNewChat} className="h-8 w-8 p-0" title="New chat">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </Button>
          {/* Desktop collapse button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className="h-8 w-8 p-0 hidden md:inline-flex"
            title="Collapse sidebar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Search + Select toggle */}
      <div className="p-2 flex items-center gap-1.5">
        <Input
          placeholder="Search chats..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 text-sm flex-1"
        />
        <Button
          variant={selectMode ? "default" : "ghost"}
          size="sm"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          className="h-8 w-8 p-0 shrink-0"
          title={selectMode ? "Exit select mode" : "Select multiple chats"}
        >
          {selectMode ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          )}
        </Button>
      </div>

      {/* Bulk actions bar */}
      {selectMode && (
        <div className="px-2 pb-2 flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={selectedIds.size === filteredChats?.length ? deselectAll : selectAll}
            className="h-7 text-xs flex-1"
          >
            {selectedIds.size === filteredChats?.length ? "Deselect all" : "Select all"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            disabled={selectedIds.size === 0 || deleteChats.isPending}
            className="h-7 text-xs flex-1 gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {deleteChats.isPending
              ? "Deleting..."
              : `Delete${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
          </Button>
        </div>
      )}

      {/* Chat list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-10 rounded-md bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : filteredChats?.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {searchQuery ? "No matches" : "No chats yet"}
            </p>
          ) : (
            filteredChats?.map((chat) => {
              const isActive = pathname === `/chat/${chat.id}`;
              const isSelected = selectedIds.has(chat.id);
              return (
                <div
                  key={chat.id}
                  className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors ${
                    selectMode && isSelected
                      ? "bg-primary/15 text-foreground"
                      : isActive
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                  onClick={() => handleSelectChat(chat.id)}
                >
                  {/* Checkbox in select mode */}
                  {selectMode && (
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? "bg-primary border-primary"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {isSelected && (
                        <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  )}

                  {editingId === chat.id ? (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => handleRename(chat.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(chat.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      className="h-6 text-sm"
                    />
                  ) : (
                    <>
                      <span className="flex-1 truncate">{chat.title}</span>

                      {/* Delete button — visible on hover */}
                      {!selectMode && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(chat.id);
                          }}
                          title="Delete chat"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </Button>
                      )}

                      {/* Three-dot menu for rename */}
                      {!selectMode && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
                              </svg>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartRename(chat.id, chat.title);
                              }}
                            >
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(chat.id);
                              }}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar - animated collapse */}
      <aside
        className={`hidden md:flex border-r shrink-0 transition-all duration-200 overflow-hidden ${
          collapsed ? "w-0 border-r-0" : "w-64"
        }`}
      >
        <div className="w-64 min-w-[16rem]">{sidebarContent}</div>
      </aside>

      {/* Mobile drawer */}
      <Sheet open={isOpen} onOpenChange={onToggle}>
        <SheetContent side="left" className="w-64 p-0">
          {sidebarContent}
        </SheetContent>
      </Sheet>
    </>
  );
}
