import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FolderClosed,
  FolderOpen,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { GroupDialog } from "@/components/hosts/GroupDialog";
import { TagManagerDialog } from "@/components/hosts/TagManagerDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Host, HostGroup } from "@/lib/ipc";
import {
  buildGroupTree,
  groupDescendantIds,
  hostConnectionLabel,
  sortHosts,
  type GroupNode,
} from "@/lib/inventory-helpers";
import type { Section } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useInventoryStore } from "@/stores/inventory";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";

const sectionMeta: Record<
  Exclude<Section, "settings">,
  { title: string; search: string; empty: string }
> = {
  hosts: {
    title: "Hosts",
    search: "Search hosts…",
    empty: "No hosts yet",
  },
  keys: {
    title: "Keychain",
    search: "Search keys…",
    empty: "No keys yet",
  },
  "known-hosts": {
    title: "Known Hosts",
    search: "Search known hosts…",
    empty: "No known hosts yet",
  },
};

function SidebarHeading({
  label,
  action,
}: {
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mt-3 mb-1 flex items-center justify-between px-2">
      <span className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </span>
      {action}
    </div>
  );
}

function HostRow({
  host,
  active,
  onSelect,
  onConnect,
  onEdit,
}: {
  host: Host;
  active: boolean;
  onSelect: () => void;
  onConnect: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      onDoubleClick={onConnect}
      className={cn(
        "group flex items-center gap-2 rounded-md pr-1 pl-2 transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left outline-none"
      >
        <Server
          className={cn(
            "size-4 shrink-0",
            active ? "text-primary" : "text-muted-foreground",
          )}
          strokeWidth={1.8}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] leading-tight">
            {host.label}
          </span>
          <span className="block truncate font-mono text-[10px] leading-tight text-muted-foreground/80">
            {hostConnectionLabel(host)}
          </span>
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Edit ${host.label}`}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        className="opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Pencil />
      </Button>
    </div>
  );
}

function GroupTreeRow({
  node,
  collapsed,
  onToggle,
  onSelect,
  onEdit,
  onDelete,
  hosts,
  groups,
  activeGroupId,
}: {
  node: GroupNode;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onEdit: (group: HostGroup) => void;
  onDelete: (group: HostGroup) => void;
  hosts: Host[];
  groups: HostGroup[];
  activeGroupId: string | null;
}) {
  const isOpen = !collapsed.has(node.group.id);
  const active = activeGroupId === node.group.id;
  const descendants = groupDescendantIds(groups, node.group.id);
  const count = hosts.filter(
    (host) => host.group_id && descendants.has(host.group_id),
  ).length;
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md pr-1 transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
        style={{ paddingLeft: 6 + node.depth * 14 }}
      >
        <button
          type="button"
          aria-label={isOpen ? "Collapse group" : "Expand group"}
          onClick={() => onToggle(node.group.id)}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded",
            !hasChildren && "invisible",
          )}
        >
          {isOpen ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.group.id)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left outline-none"
        >
          {isOpen ? (
            <FolderOpen className="size-4 shrink-0" strokeWidth={1.8} />
          ) : (
            <FolderClosed className="size-4 shrink-0" strokeWidth={1.8} />
          )}
          <span className="min-w-0 flex-1 truncate text-[12.5px]">
            {node.group.name}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground/80">
            {count}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Edit ${node.group.name}`}
          onClick={() => onEdit(node.group)}
          className="opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete ${node.group.name}`}
          onClick={() => onDelete(node.group)}
          className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>

      {isOpen &&
        node.children.map((child) => (
          <GroupTreeRow
            key={child.group.id}
            node={child}
            collapsed={collapsed}
            onToggle={onToggle}
            onSelect={onSelect}
            onEdit={onEdit}
            onDelete={onDelete}
            hosts={hosts}
            groups={groups}
            activeGroupId={activeGroupId}
          />
        ))}
    </>
  );
}

function useHostFilter() {
  const hosts = useInventoryStore((state) => state.hosts);
  const groups = useInventoryStore((state) => state.groups);
  const [query, setQuery] = useState("");
  const [filterGroupId, setFilterGroupId] = useState<string | null>(null);
  const [filterTagId, setFilterTagId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    let list = hosts;

    if (filterGroupId) {
      const ids = groupDescendantIds(groups, filterGroupId);
      list = list.filter((host) => host.group_id && ids.has(host.group_id));
    }
    if (filterTagId) {
      list = list.filter((host) => host.tag_ids.includes(filterTagId));
    }
    if (term) {
      list = list.filter(
        (host) =>
          host.label.toLowerCase().includes(term) ||
          host.address.toLowerCase().includes(term) ||
          host.username.toLowerCase().includes(term),
      );
    }

    return sortHosts(list);
  }, [hosts, groups, query, filterGroupId, filterTagId]);

  return {
    query,
    setQuery,
    filterGroupId,
    setFilterGroupId,
    filterTagId,
    setFilterTagId,
    filtered,
  };
}

export function Sidebar() {
  const section = useUiStore((state) => state.section);
  const selectedHostId = useUiStore((state) => state.selectedHostId);
  const selectHost = useUiStore((state) => state.selectHost);
  const openHostSheet = useUiStore((state) => state.openHostSheet);
  const openKeyDialog = useUiStore((state) => state.openKeyDialog);

  const hosts = useInventoryStore((state) => state.hosts);
  const groups = useInventoryStore((state) => state.groups);
  const tags = useInventoryStore((state) => state.tags);
  const keys = useInventoryStore((state) => state.keys);
  const knownHosts = useInventoryStore((state) => state.knownHosts);
  const deleteGroup = useInventoryStore((state) => state.deleteGroup);
  const deleteKey = useInventoryStore((state) => state.deleteKey);
  const deleteKnownHost = useInventoryStore((state) => state.deleteKnownHost);
  const connect = useSessionsStore((state) => state.connect);

  const filter = useHostFilter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [groupDialog, setGroupDialog] = useState<{
    open: boolean;
    group: HostGroup | null;
    parentId: string | null;
  }>({ open: false, group: null, parentId: null });
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<HostGroup | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deletingKnown, setDeletingKnown] = useState<string | null>(null);
  const [keyQuery, setKeyQuery] = useState("");
  const [knownQuery, setKnownQuery] = useState("");

  if (section === "settings") {
    return null;
  }

  const meta = sectionMeta[section];
  const tree = buildGroupTree(groups);

  const visibleKeys = keys.filter(
    (key) =>
      key.name.toLowerCase().includes(keyQuery.trim().toLowerCase()) ||
      key.key_type.toLowerCase().includes(keyQuery.trim().toLowerCase()),
  );

  const visibleKnown = knownHosts.filter(
    (known) =>
      known.address.toLowerCase().includes(knownQuery.trim().toLowerCase()) ||
      known.fingerprint.toLowerCase().includes(knownQuery.trim().toLowerCase()),
  );

  function toggleGroup(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleDeleteGroup() {
    if (!deletingGroup) {
      return;
    }
    const result = await deleteGroup(deletingGroup.id);
    if (!result.ok) {
      toast.error("Could not delete Host Group", {
        description: result.error,
      });
      return;
    }
    toast.success("Host Group deleted");
    setDeletingGroup(null);
    if (filter.filterGroupId === deletingGroup.id) {
      filter.setFilterGroupId(null);
    }
  }

  async function handleDeleteKey() {
    if (!deletingKey) {
      return;
    }
    const result = await deleteKey(deletingKey);
    if (!result.ok) {
      toast.error("Could not delete Key", { description: result.error });
      return;
    }
    toast.success("Key deleted");
    setDeletingKey(null);
  }

  async function handleDeleteKnown() {
    if (!deletingKnown) {
      return;
    }
    const result = await deleteKnownHost(deletingKnown);
    if (!result.ok) {
      toast.error("Could not forget host", { description: result.error });
      return;
    }
    toast.success("Host fingerprint forgotten");
    setDeletingKnown(null);
  }

  return (
    <>
      <aside className="flex w-[264px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-12 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold tracking-tight">
            {meta.title}
          </h2>
          <Badge
            variant="secondary"
            className="h-[18px] px-1.5 text-[10px] tabular-nums text-muted-foreground"
          >
            {section === "hosts"
              ? hosts.length
              : section === "keys"
                ? keys.length
                : knownHosts.length}
          </Badge>
        </div>
        {section === "hosts" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New Host"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => openHostSheet()}
          >
            <Plus />
          </Button>
        ) : section === "keys" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Import Key"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => openKeyDialog("import")}
          >
            <Plus />
          </Button>
        ) : null}
      </div>

      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={
              section === "hosts"
                ? filter.query
                : section === "keys"
                  ? keyQuery
                  : knownQuery
            }
            onChange={(event) =>
              section === "hosts"
                ? filter.setQuery(event.target.value)
                : section === "keys"
                  ? setKeyQuery(event.target.value)
                  : setKnownQuery(event.target.value)
            }
            id="sidebar-search"
            placeholder={meta.search}
            aria-label={meta.search}
            className="h-8 w-full rounded-md border border-sidebar-border bg-background/50 pr-2 pl-7 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-4">
          {section === "hosts" && (
            <>
              <button
                type="button"
                onClick={() => {
                  filter.setFilterGroupId(null);
                  filter.setFilterTagId(null);
                  selectHost(null);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors",
                  !filter.filterGroupId && !filter.filterTagId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Server
                  className={cn(
                    "size-4 shrink-0",
                    !filter.filterGroupId && !filter.filterTagId
                      ? "text-primary"
                      : "",
                  )}
                  strokeWidth={1.8}
                />
                <span className="min-w-0 flex-1 truncate">All Hosts</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {hosts.length}
                </span>
              </button>

              <SidebarHeading
                label="Groups"
                action={
                  <button
                    type="button"
                    aria-label="New group"
                    onClick={() =>
                      setGroupDialog({ open: true, group: null, parentId: null })
                    }
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Plus className="size-3.5" />
                  </button>
                }
              />
              {tree.length === 0 ? (
                <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  No groups. Create one to organize Hosts.
                </p>
              ) : (
                tree.map((node) => (
                  <GroupTreeRow
                    key={node.group.id}
                    node={node}
                    collapsed={collapsed}
                    onToggle={toggleGroup}
                    onSelect={(id) => {
                      filter.setFilterTagId(null);
                      filter.setFilterGroupId(id);
                    }}
                    onEdit={(group) =>
                      setGroupDialog({
                        open: true,
                        group,
                        parentId: group.parent_id,
                      })
                    }
                    onDelete={setDeletingGroup}
                    hosts={hosts}
                    groups={groups}
                    activeGroupId={filter.filterGroupId}
                  />
                ))
              )}

              <SidebarHeading
                label="Tags"
                action={
                  <button
                    type="button"
                    aria-label="Manage tags"
                    onClick={() => setTagManagerOpen(true)}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Plus className="size-3.5" />
                  </button>
                }
              />
              {tags.length === 0 ? (
                <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  No tags yet.
                </p>
              ) : (
                tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => {
                      filter.setFilterGroupId(null);
                      filter.setFilterTagId(
                        filter.filterTagId === tag.id ? null : tag.id,
                      );
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                      filter.filterTagId === tag.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                    )}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: tag.color ?? "var(--muted-foreground)" }}
                    />
                    <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    <span className="text-[10px] tabular-nums">
                      {tag.host_count}
                    </span>
                  </button>
                ))
              )}

              <SidebarHeading
                label={
                  filter.filterGroupId || filter.filterTagId
                    ? "Filtered Hosts"
                    : "Saved Hosts"
                }
              />
              {filter.filtered.length === 0 ? (
                <p className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {hosts.length === 0
                    ? "No hosts yet. Add your first server."
                    : "No Hosts match this filter."}
                </p>
              ) : (
                filter.filtered.map((host) => (
                  <HostRow
                    key={host.id}
                    host={host}
                    active={host.id === selectedHostId}
                    onSelect={() => selectHost(host.id)}
                    onConnect={() => void connect(host)}
                    onEdit={() => openHostSheet(host.id)}
                  />
                ))
              )}
            </>
          )}

          {section === "keys" && (
            <>
              {visibleKeys.length === 0 ? (
                <div className="mx-1 mt-2 rounded-lg border border-dashed border-sidebar-border px-3 py-6 text-center">
                  <KeyRound
                    className="mx-auto size-5 text-muted-foreground/70"
                    strokeWidth={1.6}
                  />
                  <p className="mt-2 text-[12px] font-medium">No keys yet</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Import an OpenSSH key or generate ed25519.
                  </p>
                </div>
              ) : (
                visibleKeys.map((key) => (
                  <div
                    key={key.id}
                    className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                  >
                    <KeyRound className="size-4 shrink-0" strokeWidth={1.8} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-foreground">
                        {key.name}
                      </span>
                      <span className="block truncate font-mono text-[10px]">
                        {key.key_type.replace("ssh-", "")}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Copy ${key.name} public key`}
                      onClick={() => {
                        void navigator.clipboard.writeText(key.public_key);
                        toast.success("Public key copied");
                      }}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Copy />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete ${key.name}`}
                      onClick={() => setDeletingKey(key.id)}
                      className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))
              )}
            </>
          )}

          {section === "known-hosts" && (
            <>
              {visibleKnown.length === 0 ? (
                <div className="mx-1 mt-2 rounded-lg border border-dashed border-sidebar-border px-3 py-6 text-center">
                  <ShieldCheck
                    className="mx-auto size-5 text-muted-foreground/70"
                    strokeWidth={1.6}
                  />
                  <p className="mt-2 text-[12px] font-medium">
                    {meta.empty}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Fingerprints are saved after the first connect.
                  </p>
                </div>
              ) : (
                visibleKnown.map((known) => (
                  <div
                    key={known.id}
                    className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-sidebar-accent/60"
                  >
                    <ShieldCheck
                      className="mt-0.5 size-4 shrink-0"
                      strokeWidth={1.8}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-foreground">
                        {known.address}
                        {known.port === 22 ? "" : `:${known.port}`}
                      </span>
                      <span className="block truncate font-mono text-[9.5px]">
                        {known.fingerprint}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Forget ${known.address}`}
                      onClick={() => setDeletingKnown(known.id)}
                      className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-sidebar-border p-3">
        {section === "hosts" && (
          <Button
            className="w-full"
            size="sm"
            onClick={() => openHostSheet()}
          >
            <Plus data-icon="inline-start" />
            New Host
          </Button>
        )}

        {section === "keys" && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="w-full"
              variant="outline"
              size="sm"
              onClick={() => openKeyDialog("import")}
            >
              <Plus data-icon="inline-start" />
              Import
            </Button>
            <Button
              className="w-full"
              variant="outline"
              size="sm"
              onClick={() => openKeyDialog("generate")}
            >
              <KeyRound data-icon="inline-start" />
              Generate
            </Button>
          </div>
        )}

        {section === "known-hosts" && (
          <p className="flex items-start gap-1.5 px-0.5 text-[10px] leading-relaxed text-muted-foreground">
            <LockKeyhole className="mt-px size-3 shrink-0" />
            Fingerprints stay inside your encrypted Vault.
          </p>
        )}
      </div>
      </aside>

      <GroupDialog
        open={groupDialog.open}
        onOpenChange={(open) =>
          setGroupDialog((current) => ({ ...current, open }))
        }
        group={groupDialog.group}
        defaultParentId={groupDialog.parentId}
      />

      <TagManagerDialog
        open={tagManagerOpen}
        onOpenChange={setTagManagerOpen}
      />

      <ConfirmDialog
        open={deletingGroup !== null}
        onOpenChange={(open) => !open && setDeletingGroup(null)}
        title={`Delete Host Group "${deletingGroup?.name ?? ""}"?`}
        description="Child groups and Hosts move to its parent. No Hosts are deleted."
        confirmLabel="Delete group"
        destructive
        onConfirm={handleDeleteGroup}
      />

      <ConfirmDialog
        open={deletingKey !== null}
        onOpenChange={(open) => !open && setDeletingKey(null)}
        title="Delete this Key?"
        description="Hosts using it must be reassigned first. The private material is wiped from the Vault."
        confirmLabel="Delete key"
        destructive
        onConfirm={handleDeleteKey}
      />

      <ConfirmDialog
        open={deletingKnown !== null}
        onOpenChange={(open) => !open && setDeletingKnown(null)}
        title="Forget this fingerprint?"
        description="The next connection will ask you to trust the server again."
        confirmLabel="Forget"
        destructive
        onConfirm={handleDeleteKnown}
      />
    </>
  );
}
