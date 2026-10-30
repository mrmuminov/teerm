import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Tag } from "@/lib/ipc";
import { useInventoryStore } from "@/stores/inventory";

const DEFAULT_COLOR = "#7ee2a8";

type TagManagerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TagManagerDialog({
  open,
  onOpenChange,
}: TagManagerDialogProps) {
  const tags = useInventoryStore((state) => state.tags);
  const createTag = useInventoryStore((state) => state.createTag);
  const updateTag = useInventoryStore((state) => state.updateTag);
  const deleteTag = useInventoryStore((state) => state.deleteTag);

  const [editing, setEditing] = useState<Tag | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Tag | null>(null);

  function reset() {
    setEditing(null);
    setName("");
    setColor(DEFAULT_COLOR);
  }

  function startEdit(tag: Tag) {
    setEditing(tag);
    setName(tag.name);
    setColor(tag.color ?? DEFAULT_COLOR);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    setBusy(true);
    const input = { name, color };
    const result = editing
      ? await updateTag(editing.id, input)
      : await createTag(input);
    setBusy(false);

    if (!result.ok) {
      toast.error("Could not save tag", { description: result.error });
      return;
    }

    toast.success(editing ? "Tag updated" : "Tag created");
    reset();
  }

  async function handleDelete() {
    if (!deleting) {
      return;
    }
    setBusy(true);
    const result = await deleteTag(deleting.id);
    setBusy(false);

    if (!result.ok) {
      toast.error("Could not delete tag", { description: result.error });
      return;
    }

    toast.success("Tag deleted");
    setDeleting(null);
    if (editing?.id === deleting.id) {
      reset();
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Tags</DialogTitle>
            <DialogDescription>
              Labels can be shared by any number of Hosts.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="tag-name">
                {editing ? "Rename tag" : "New tag"}
              </Label>
              <Input
                id="tag-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="production"
                maxLength={32}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tag-color">Color</Label>
              <input
                id="tag-color"
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-8 w-10 cursor-pointer rounded-md border border-input bg-transparent p-1"
              />
            </div>
            <Button type="submit" disabled={busy || !name.trim()} size="sm">
              {busy ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : editing ? null : (
                <Plus data-icon="inline-start" />
              )}
              {editing ? "Save" : "Add"}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Cancel edit"
                onClick={reset}
              >
                <X />
              </Button>
            )}
          </form>

          <div className="max-h-[280px] space-y-1 overflow-y-auto">
            {tags.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
                No tags yet.
              </p>
            ) : (
              tags.map((tag) => (
                <div
                  key={tag.id}
                  className="group flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/30 px-2.5 py-2"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: tag.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">
                    {tag.name}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {tag.host_count} host{tag.host_count === 1 ? "" : "s"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Rename ${tag.name}`}
                    onClick={() => startEdit(tag)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${tag.name}`}
                    onClick={() => setDeleting(tag)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete tag "${deleting?.name ?? ""}"?`}
        description="The tag is removed from every Host. Hosts themselves are untouched."
        confirmLabel="Delete tag"
        destructive
        busy={busy}
        onConfirm={handleDelete}
      />
    </>
  );
}
