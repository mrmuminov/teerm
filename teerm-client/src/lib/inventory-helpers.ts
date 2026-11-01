import type { Host, HostGroup } from "@/lib/ipc";

export type GroupNode = {
  group: HostGroup;
  depth: number;
  children: GroupNode[];
};

export function buildGroupTree(groups: HostGroup[]): GroupNode[] {
  const byParent = new Map<string | null, HostGroup[]>();

  for (const group of groups) {
    const key = group.parent_id;
    const bucket = byParent.get(key);
    if (bucket) {
      bucket.push(group);
    } else {
      byParent.set(key, [group]);
    }
  }

  const seen = new Set<string>();

  function build(parentId: string | null, depth: number): GroupNode[] {
    const children = byParent.get(parentId) ?? [];

    return children
      .filter((group) => {
        if (seen.has(group.id)) {
          return false;
        }
        seen.add(group.id);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((group) => ({
        group,
        depth,
        children: build(group.id, depth + 1),
      }));
  }

  const tree = build(null, 0);

  // Orphans (parent was removed outside the UI) still need to be visible.
  for (const group of groups) {
    if (!seen.has(group.id)) {
      tree.push({ group, depth: 0, children: [] });
    }
  }

  return tree;
}

export function flattenGroupTree(
  nodes: GroupNode[],
): Array<{ group: HostGroup; depth: number }> {
  const result: Array<{ group: HostGroup; depth: number }> = [];

  function walk(list: GroupNode[]) {
    for (const node of list) {
      result.push({ group: node.group, depth: node.depth });
      walk(node.children);
    }
  }

  walk(nodes);
  return result;
}

export function groupDescendantIds(
  groups: HostGroup[],
  groupId: string,
): Set<string> {
  const result = new Set<string>([groupId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const group of groups) {
      if (
        group.parent_id &&
        result.has(group.parent_id) &&
        !result.has(group.id)
      ) {
        result.add(group.id);
        changed = true;
      }
    }
  }

  return result;
}

export function hostCountForGroup(
  hosts: Host[],
  groups: HostGroup[],
  groupId: string,
): number {
  const ids = groupDescendantIds(groups, groupId);
  return hosts.filter((host) => host.group_id && ids.has(host.group_id)).length;
}

export function hostConnectionLabel(host: Host): string {
  const port = host.port === 22 ? "" : `:${host.port}`;
  return `${host.username}@${host.address}${port}`;
}

export function sortHosts(hosts: Host[]): Host[] {
  return [...hosts].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}
