import { describe, expect, it } from "vitest";

import {
  buildGroupTree,
  flattenGroupTree,
  groupDescendantIds,
  hostConnectionLabel,
  hostCountForGroup,
  sortHosts,
} from "@/lib/inventory-helpers";
import type { Host, HostGroup } from "@/lib/ipc";

function group(id: string, name: string, parentId: string | null): HostGroup {
  return {
    id,
    name,
    parent_id: parentId,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function host(label: string, groupId: string | null = null, port = 22): Host {
  return {
    id: label,
    label,
    address: "example.com",
    port,
    username: "root",
    group_id: groupId,
    tag_ids: [],
    key_id: null,
    has_password: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("group tree", () => {
  const groups = [
    group("prod", "Production", null),
    group("eu", "EU", "prod"),
    group("dev", "Development", null),
  ];

  it("nests groups under their parent and sorts siblings by name", () => {
    const tree = buildGroupTree(groups);

    expect(tree.map((node) => node.group.id)).toEqual(["dev", "prod"]);
    expect(tree[1].children.map((node) => node.group.id)).toEqual(["eu"]);
    expect(tree[1].children[0].depth).toBe(1);
  });

  it("keeps groups whose parent no longer exists visible", () => {
    const tree = buildGroupTree([group("lost", "Lost", "missing")]);

    expect(tree.map((node) => node.group.id)).toEqual(["lost"]);
  });

  it("does not loop forever on a parent cycle", () => {
    const tree = buildGroupTree([group("a", "A", "b"), group("b", "B", "a")]);

    expect(flattenGroupTree(tree)).toHaveLength(2);
  });

  it("flattens depth-first", () => {
    const flat = flattenGroupTree(buildGroupTree(groups));

    expect(flat.map((entry) => [entry.group.id, entry.depth])).toEqual([
      ["dev", 0],
      ["prod", 0],
      ["eu", 1],
    ]);
  });

  it("collects a group together with all its descendants", () => {
    expect([...groupDescendantIds(groups, "prod")].sort()).toEqual([
      "eu",
      "prod",
    ]);
  });

  it("counts hosts in nested groups", () => {
    const hosts = [host("a", "prod"), host("b", "eu"), host("c", "dev")];

    expect(hostCountForGroup(hosts, groups, "prod")).toBe(2);
  });
});

describe("host helpers", () => {
  it("omits the default SSH port from the connection label", () => {
    expect(hostConnectionLabel(host("a"))).toBe("root@example.com");
    expect(hostConnectionLabel(host("a", null, 2222))).toBe(
      "root@example.com:2222",
    );
  });

  it("sorts hosts by label without mutating the input", () => {
    const hosts = [host("beta"), host("Alpha")];

    expect(sortHosts(hosts).map((item) => item.label)).toEqual([
      "Alpha",
      "beta",
    ]);
    expect(hosts[0].label).toBe("beta");
  });
});
