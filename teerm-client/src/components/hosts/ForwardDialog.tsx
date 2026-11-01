import { useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import type { ForwardKind, PortForward } from "@/lib/ipc";
import { useInventoryStore } from "@/stores/inventory";
import { useT } from "@/lib/i18n";

type ForwardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostId: string;
  forward: PortForward | null;
};

type FormState = {
  kind: ForwardKind;
  bindAddress: string;
  bindPort: string;
  targetHost: string;
  targetPort: string;
  autoStart: boolean;
};

const emptyForm: FormState = {
  kind: "local",
  bindAddress: "127.0.0.1",
  bindPort: "8080",
  targetHost: "localhost",
  targetPort: "80",
  autoStart: false,
};

export function ForwardDialog({
  open,
  onOpenChange,
  hostId,
  forward,
}: ForwardDialogProps) {
  const t = useT();
  const createForward = useInventoryStore((state) => state.createForward);
  const updateForward = useInventoryStore((state) => state.updateForward);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (forward) {
      setForm({
        kind: forward.kind,
        bindAddress: forward.bind_address,
        bindPort: String(forward.bind_port),
        targetHost: forward.target_host,
        targetPort: String(forward.target_port),
        autoStart: forward.auto_start,
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, forward]);

  function patch(next: Partial<FormState>) {
    setForm((current) => ({ ...current, ...next }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    const input = {
      host_id: hostId,
      kind: form.kind,
      bind_address: form.bindAddress,
      bind_port: Number(form.bindPort),
      target_host: form.targetHost,
      target_port: Number(form.targetPort),
      auto_start: form.autoStart,
    };

    const result = forward
      ? await updateForward(forward.id, input)
      : await createForward(input);

    setBusy(false);

    if (!result.ok) {
      toast.error(t("Could not save port forward"), {
        description: result.error,
      });
      return;
    }

    toast.success(forward ? t("Port forward updated") : t("Port forward added"));
    onOpenChange(false);
  }

  const isLocal = form.kind === "local";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>
            {forward ? t("Edit port forward") : t("New port forward")}
          </DialogTitle>
          <DialogDescription>
            {isLocal
              ? t("Teerm listens on this device and the server connects to the target.")
              : t("The server listens and Teerm connects to the target from this device.")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{t("Direction")}</Label>
            <Select
              value={form.kind}
              onValueChange={(value) => patch({ kind: value as ForwardKind })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">{t("Local (-L)")}</SelectItem>
                <SelectItem value="remote">{t("Remote (-R)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>{isLocal ? t("Listen on this device") : t("Listen on the server")}</Label>
            <div className="flex gap-2">
              <Input
                value={form.bindAddress}
                onChange={(event) => patch({ bindAddress: event.target.value })}
                placeholder="127.0.0.1"
                className="flex-1 font-mono text-[12px]"
              />
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.bindPort}
                onChange={(event) => patch({ bindPort: event.target.value })}
                placeholder="8080"
                className="w-24 font-mono text-[12px]"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>{isLocal ? t("Target (from the server)") : t("Target (from this device)")}</Label>
            <div className="flex gap-2">
              <Input
                value={form.targetHost}
                onChange={(event) => patch({ targetHost: event.target.value })}
                placeholder={t("localhost")}
                className="flex-1 font-mono text-[12px]"
              />
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.targetPort}
                onChange={(event) => patch({ targetPort: event.target.value })}
                placeholder="80"
                className="w-24 font-mono text-[12px]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2.5">
            <div>
              <p className="text-[12.5px] font-medium">{t("Start with the Session")}</p>
              <p className="text-[11px] text-muted-foreground">
                {t("Open this tunnel whenever this Host connects.")}</p>
            </div>
            <Switch
              checked={form.autoStart}
              onCheckedChange={(checked) => patch({ autoStart: checked })}
            />
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
              {forward ? t("Save changes") : t("Add rule")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
