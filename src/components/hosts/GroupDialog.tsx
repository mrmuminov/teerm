import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HostGroup } from "@/lib/ipc";
import {
  buildGroupTree,
  flattenGroupTree,
  groupDescendantIds,
} from "@/lib/inventory-helpers";
import { useInventoryStore } from "@/stores/inventory";
import { useT } from "@/lib/i18n";

const NO_PARENT = "__root";

type GroupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: HostGroup | null;
  defaultParentId?: string | null;
};

export function GroupDialog({
  open,
  onOpenChange,
  group,
  defaultParentId = null,
}: GroupDialogProps) {
  const t = useT();
  const groups = useInventoryStore((state) => state.groups);
  const createGroup = useInventoryStore((state) => state.createGroup);
  const updateGroup = useInventoryStore((state) => state.updateGroup);

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>(NO_PARENT);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(group?.name ?? "");
    setParentId(group?.parent_id ?? defaultParentId ?? NO_PARENT);
  }, [open, group, defaultParentId]);

  const options = useMemo(() => {
    const blocked = group ? groupDescendantIds(groups, group.id) : new Set();
    return flattenGroupTree(buildGroupTree(groups)).filter(
      ({ group: candidate }) => !blocked.has(candidate.id),
    );
  }, [groups, group]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    const input = {
      name,
      parent_id: parentId === NO_PARENT ? null : parentId,
    };

    const result = group
      ? await updateGroup(group.id, input)
      : await createGroup(input);

    setBusy(false);

    if (!result.ok) {
      toast.error(t("Could not save Host Group"), { description: result.error });
      return;
    }

    toast.success(group ? t("Host Group updated") : t("Host Group created"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {group ? t("Rename Host Group") : t("New Host Group")}
          </DialogTitle>
          <DialogDescription>
            {t("Groups nest freely. A Host belongs to at most one group.")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="group-name">{t("Name")}</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("Production")}
              required
              autoFocus
              maxLength={64}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>{t("Parent group")}</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>{t("No parent (root)")}</SelectItem>
                {options.map(({ group: candidate, depth }) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {"  ".repeat(depth)}
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t("Cancel")}</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {group ? t("Save") : t("Create group")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
