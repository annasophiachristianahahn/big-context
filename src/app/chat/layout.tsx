"use client";

import { useState, useEffect } from "react";
import { ChatSidebar } from "@/components/ChatSidebar";
import { Button } from "@/components/ui/button";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile sheet
  const [collapsed, setCollapsed] = useState(false); // desktop collapse

  // Persist collapsed state
  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      localStorage.setItem("sidebar-collapsed", String(!prev));
      return !prev;
    });
  }

  return (
    <div className="h-dvh flex overflow-hidden">
      <ChatSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />

      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Mobile header + desktop collapse toggle */}
        <div className="flex items-center p-2 border-b gap-2 shrink-0 md:hidden">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(true)}
            className="h-8 w-8 p-0"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </Button>
          <span className="font-semibold text-sm">Big Context</span>
        </div>

        {/* Desktop: show expand button when sidebar is collapsed */}
        {collapsed && (
          <div className="hidden md:flex items-center p-2 border-b gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleCollapsed}
              className="h-8 w-8 p-0"
              title="Expand sidebar"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </Button>
            <span className="font-semibold text-sm">Big Context</span>
          </div>
        )}

        {children}
      </main>
    </div>
  );
}
