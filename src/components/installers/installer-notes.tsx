"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Note {
  id: number;
  installerId: number;
  content: string;
  createdAt: string;
}

export function InstallerNotes({
  installerId,
  initialNotes,
}: {
  installerId: number;
  initialNotes: Note[];
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const addNote = async () => {
    if (!newNote.trim()) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/installers/${installerId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newNote }),
      });

      if (!res.ok) throw new Error("Failed to save note");

      const note = await res.json();
      setNotes((prev) => [...prev, note]);
      setNewNote("");
      toast.success("Note added");
    } catch {
      toast.error("Failed to save note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          Notes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {notes.length === 0 && (
          <p className="text-sm text-muted-foreground">No notes yet</p>
        )}

        {notes.map((note) => (
          <div
            key={note.id}
            className="rounded border p-3 text-sm space-y-1"
          >
            <p>{note.content}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(note.createdAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        ))}

        <div className="flex gap-2">
          <Textarea
            placeholder="Add a note..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="min-h-[60px]"
          />
          <Button
            onClick={addNote}
            disabled={!newNote.trim() || saving}
            size="icon"
            className="shrink-0 self-end"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
