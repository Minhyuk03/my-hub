"use client";

import { Button } from "@/components/ui/button";

export function ConfirmSubmit({ message, children, className }: { message: string; children: React.ReactNode; className?: string }) {
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
