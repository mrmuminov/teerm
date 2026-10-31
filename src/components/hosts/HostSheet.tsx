import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  KeyRound,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ForwardDialog } from "@/components/hosts/ForwardDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Host, PortForward } from "@/lib/ipc";
import { flattenGroupTree, buildGroupTree } from "@/lib/inventory-helpers";
import { cn } from "@/lib/utils";
import { useInventoryStore } from "@/stores/inventory";
import { useUiStore } from "@/stores/ui";
import { useT } from "@/lib/i18n";

const NO_GROUP = "__none";
const EMPTY_FORWARDS: PortForward[] = [];

type FormState = {
  label: string;
  address: string;
  port: string;
  username: string;
  groupId: string;
  keyId: string;
  tagIds: string[];
  password: string;
  clearPassword: boolean;
};

const emptyForm: FormState = {
  label: "",
  address: "",
  port: "22",
  username: "",
  groupId: NO_GROUP,
  keyId: NO_GROUP,
  tagIds: [],
  password: "",
  clearPassword: false,
};

function formFromHost(host: Host): FormState {
  return {
    label: host.label,
    address: host.address,
    port: String(host.port),
    username: host.username,
    groupId: host.group_id ?? NO_GROUP,
    keyId: host.key_id ?? NO_GROUP,
    tagIds: host.tag_ids,
    password: "",
    clearPassword: false,
  };
}

function ForwardRow({
  forward,
  onEdit,
  onDelete,
}: {
  forward: PortForward;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <div className="group flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 px-2.5 py-2">
      <Badge
        variant="secondary"
        className={cn(
          "h-5 shrink-0 px-1.5 text-[9px] font-medium tracking-wide uppercase",
          forward.kind === "local"
            ? "text-primary/90"
            : "text-[oklch(0.78_0.13_85)]",
        )}
      >
        {forward.kind}
      </Badge>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
        {forward.bind_address}:{forward.bind_port}
        <ArrowLeftRight className="mx-1 inline size-3 opacity-60" />
        {forward.target_host}:{forward.target_port}
      </span>
      {forward.auto_start && (
        <span
          title={t("Starts automatically")}
          className="size-1.5 shrink-0 rounded-full bg-primary"
        />
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("Edit forward")}
        onClick={onEdit}
        className="opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("Delete forward")}
        onClick={onDelete}
        className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
      >
        <Trash2 />
      </Button>
    </div>
  );
}

export function HostSheet() {
  const t = useT();
  const sheet = useUiStore((state) => state.hostSheet);
  const closeHostSheet = useUiStore((state) => state.closeHostSheet);
  const selectHost = useUiStore((state) => state.selectHost);

  const hosts = useInventoryStore((state) => state.hosts);
  const groups = useInventoryStore((state) => state.groups);
  const tags = useInventoryStore((state) => state.tags);
  const keys = useInventoryStore((state) => state.keys);
  const forwards = useInventoryStore((state) =>
    sheet.hostId ? (state.forwards[sheet.hostId] ?? EMPTY_FORWARDS) : EMPTY_FORWARDS,
  );
  const createHost = useInventoryStore((state) => state.createHost);
  const updateHost = useInventoryStore((state) => state.updateHost);
  const deleteHost = useInventoryStore((state) => state.deleteHost);
  const loadForwards = useInventoryStore((state) => state.loadForwards);
  const deleteForward = useInventoryStore((state) => state.deleteForward);

  const host = sheet.hostId
    ? hosts.find((candidate) => candidate.id === sheet.hostId) ?? null
    : null;
  const isEditing = Boolean(host);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forwardDialog, setForwardDialog] = useState<{
    open: boolean;
    forward: PortForward | null;
  }>({ open: false, forward: null });
  const [deletingForward, setDeletingForward] = useState<PortForward | null>(
    null,
  );

  useEffect(() => {
    if (!sheet.open) {
      return;
    }

    const current = sheet.hostId
      ? useInventoryStore
          .getState()
          .hosts.find((candidate) => candidate.id === sheet.hostId) ?? null
      : null;

    setForm(current ? formFromHost(current) : emptyForm);
    setConfirmDelete(false);
    setForwardDialog({ open: false, forward: null });
    if (current) {
      void loadForwards(current.id);
    }
  }, [sheet.open, sheet.hostId, loadForwards]);

  const groupOptions = useMemo(
    () => flattenGroupTree(buildGroupTree(groups)),
    [groups],
  );

  function patch(next: Partial<FormState>) {
    setForm((current) => ({ ...current, ...next }));
  }

  function toggleTag(tagId: string) {
    setForm((current) => ({
      ...current,
      tagIds: current.tagIds.includes(tagId)
        ? current.tagIds.filter((id) => id !== tagId)
        : [...current.tagIds, tagId],
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    const input = {
      label: form.label,
      address: form.address,
      port: Number(form.port),
      username: form.username,
      group_id: form.groupId === NO_GROUP ? null : form.groupId,
      tag_ids: form.tagIds,
      key_id: form.keyId === NO_GROUP ? null : form.keyId,
      password: form.password.length > 0 ? form.password : null,
      clear_password: form.clearPassword,
    };

    const result = host
      ? await updateHost(host.id, input)
      : await createHost(input);

    setBusy(false);

    if (!result.ok) {
      toast.error(t("Could not save Host"), { description: result.error });
      return;
    }

    toast.success(host ? "Host updated" : "Host created");
    selectHost(result.value.id);
    closeHostSheet();
  }

  async function handleDelete() {
    if (!host) {
      return;
    }
    setBusy(true);
    const result = await deleteHost(host.id);
    setBusy(false);

    if (!result.ok) {
      toast.error(t("Could not delete Host"), { description: result.error });
      return;
    }

    toast.success(t("Host deleted"));
    setConfirmDelete(false);
    selectHost(null);
    closeHostSheet();
  }

  async function handleDeleteForward() {
    if (!host || !deletingForward) {
      return;
    }
    const result = await deleteForward(host.id, deletingForward.id);
    if (!result.ok) {
      toast.error(t("Could not delete port forward"), {
        description: result.error,
      });
      return;
    }
    toast.success(t("Port forward removed"));
    setDeletingForward(null);
  }

  return (
    <>
      <Sheet open={sheet.open} onOpenChange={(open) => !open && closeHostSheet()}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-[460px]">
          <SheetHeader className="border-b border-border/70 px-5 py-4">
            <SheetTitle>{isEditing ? "Edit Host" : "New Host"}</SheetTitle>
            <SheetDescription>
              {isEditing
                ? "Secrets stay inside the encrypted Vault."
                : "Save a connection profile. You can connect once the SSH engine lands."}
            </SheetDescription>
          </SheetHeader>

          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div className="grid gap-3.5">
                <div className="grid gap-1.5">
                  <Label htmlFor="host-label">
                    {t("Label")}{" "}<span className="text-muted-foreground">{t("(optional)")}</span>
                  </Label>
                  <Input
                    id="host-label"
                    value={form.label}
                    onChange={(event) => patch({ label: event.target.value })}
                    placeholder={t("Production API")}
                    autoFocus
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="host-address">{t("Address")}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="host-address"
                      value={form.address}
                      onChange={(event) => patch({ address: event.target.value })}
                      placeholder={t("server.example.com")}
                      required
                      autoComplete="off"
                      spellCheck={false}
                      className="flex-1 font-mono text-[12.5px]"
                    />
                    <Input
                      aria-label={t("Port")}
                      type="number"
                      min={1}
                      max={65535}
                      value={form.port}
                      onChange={(event) => patch({ port: event.target.value })}
                      className="w-20 font-mono text-[12.5px]"
                    />
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="host-username">{t("Username")}</Label>
                  <Input
                    id="host-username"
                    value={form.username}
                    onChange={(event) => patch({ username: event.target.value })}
                    placeholder={t("root")}
                    required
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-[12.5px]"
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label>{t("Host Group")}</Label>
                  <Select
                    value={form.groupId}
                    onValueChange={(value) => patch({ groupId: value })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_GROUP}>{t("No group")}</SelectItem>
                      {groupOptions.map(({ group, depth }) => (
                        <SelectItem key={group.id} value={group.id}>
                          {"  ".repeat(depth)}
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border/70 bg-card/30 p-3.5">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-primary" strokeWidth={1.8} />
                  <p className="text-[12.5px] font-medium">{t("Authentication")}</p>
                </div>

                <div className="grid gap-1.5">
                  <Label>{t("Key")}</Label>
                  <Select
                    value={form.keyId}
                    onValueChange={(value) => patch({ keyId: value })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_GROUP}>
                        {t("None — password or prompt")}</SelectItem>
                      {keys.map((key) => (
                        <SelectItem key={key.id} value={key.id}>
                          {key.name}{" "}
                          <span className="text-muted-foreground">
                            ({key.key_type.replace("ssh-", "")})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="host-password">{t("Password")}</Label>
                  <Input
                    id="host-password"
                    type="password"
                    value={form.password}
                    onChange={(event) => patch({ password: event.target.value })}
                    placeholder={
                      host?.has_password
                        ? "Stored — leave blank to keep"
                        : "Optional, stored encrypted"
                    }
                    autoComplete="new-password"
                    disabled={form.clearPassword}
                  />
                  {host?.has_password && (
                    <label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Checkbox
                        checked={form.clearPassword}
                        onCheckedChange={(checked) =>
                          patch({ clearPassword: checked === true })
                        }
                      />
                      {t("Remove the stored password")}</label>
                  )}
                  <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <LockKeyhole className="size-3" />
                    {t("Write-only across IPC. Never shown again after saving.")}</p>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>{t("Tags")}</Label>
                {tags.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {t("No tags yet. Create them from the Hosts sidebar.")}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => {
                      const active = form.tagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          className={cn(
                            "flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors",
                            active
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
                          )}
                        >
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: tag.color ?? "var(--muted-foreground)" }}
                          />
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {host && (
                <div className="space-y-2.5 border-t border-border/60 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ArrowLeftRight
                        className="size-4 text-primary"
                        strokeWidth={1.8}
                      />
                      <p className="text-[12.5px] font-medium">{t("Port forwards")}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setForwardDialog({ open: true, forward: null })
                      }
                    >
                      <Plus data-icon="inline-start" />
                      {t("Add rule")}</Button>
                  </div>

                  {forwards.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-[11px] text-muted-foreground">
                      {t("No tunnels yet. Local and remote rules start with the Session.")}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {forwards.map((forward) => (
                        <ForwardRow
                          key={forward.id}
                          forward={forward}
                          onEdit={() =>
                            setForwardDialog({ open: true, forward })
                          }
                          onDelete={() => setDeletingForward(forward)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <SheetFooter className="flex-row items-center justify-between border-t border-border/70 px-5 py-3">
              <div>
                {isEditing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(true)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 data-icon="inline-start" />
                    {t("Delete")}</Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeHostSheet}
                  disabled={busy}
                >
                  {t("Cancel")}</Button>
                <Button type="submit" size="sm" disabled={busy}>
                  {busy && (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  )}
                  {isEditing ? "Save changes" : "Create Host"}
                </Button>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${host?.label ?? "this Host"}?`}
        description={t("Its Port Forwards are removed too. The record is hidden from the UI and its stored password is wiped from the Vault.")}
        confirmLabel={t("Delete Host")}
        destructive
        busy={busy}
        onConfirm={handleDelete}
      />

      {host && (
        <ForwardDialog
          open={forwardDialog.open}
          onOpenChange={(open) =>
            setForwardDialog((current) => ({ ...current, open }))
          }
          hostId={host.id}
          forward={forwardDialog.forward}
        />
      )}

      <ConfirmDialog
        open={deletingForward !== null}
        onOpenChange={(open) => !open && setDeletingForward(null)}
        title={t("Delete port forward?")}
        description={
          deletingForward
            ? `${deletingForward.bind_address}:${deletingForward.bind_port} → ${deletingForward.target_host}:${deletingForward.target_port}`
            : ""
        }
        confirmLabel={t("Delete rule")}
        destructive
        onConfirm={handleDeleteForward}
      />
    </>
  );
}
