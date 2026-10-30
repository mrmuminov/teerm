import { create } from "zustand";

import {
  errorMessage,
  ipc,
  type ForwardInput,
  type GroupInput,
  type Host,
  type HostGroup,
  type HostInput,
  type Key,
  type KeyGenerateInput,
  type KeyImportInput,
  type KnownHost,
  type PortForward,
  type Tag,
  type TagInput,
} from "@/lib/ipc";

export type InventoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type Snapshot = {
  hosts: Host[];
  groups: HostGroup[];
  tags: Tag[];
  keys: Key[];
  knownHosts: KnownHost[];
};

type InventoryStore = Snapshot & {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  forwards: Record<string, PortForward[]>;
  load: (force?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;

  createHost: (input: HostInput) => Promise<InventoryResult<Host>>;
  updateHost: (id: string, input: HostInput) => Promise<InventoryResult<Host>>;
  deleteHost: (id: string) => Promise<InventoryResult<void>>;

  createGroup: (input: GroupInput) => Promise<InventoryResult<HostGroup>>;
  updateGroup: (
    id: string,
    input: GroupInput,
  ) => Promise<InventoryResult<HostGroup>>;
  deleteGroup: (id: string) => Promise<InventoryResult<void>>;

  createTag: (input: TagInput) => Promise<InventoryResult<Tag>>;
  updateTag: (id: string, input: TagInput) => Promise<InventoryResult<Tag>>;
  deleteTag: (id: string) => Promise<InventoryResult<void>>;

  importKey: (input: KeyImportInput) => Promise<InventoryResult<Key>>;
  generateKey: (input: KeyGenerateInput) => Promise<InventoryResult<Key>>;
  renameKey: (id: string, name: string) => Promise<InventoryResult<Key>>;
  deleteKey: (id: string) => Promise<InventoryResult<void>>;

  loadForwards: (hostId: string) => Promise<InventoryResult<PortForward[]>>;
  createForward: (input: ForwardInput) => Promise<InventoryResult<PortForward>>;
  updateForward: (
    id: string,
    input: ForwardInput,
  ) => Promise<InventoryResult<PortForward>>;
  deleteForward: (
    hostId: string,
    id: string,
  ) => Promise<InventoryResult<void>>;

  deleteKnownHost: (id: string) => Promise<InventoryResult<void>>;
};

async function fetchSnapshot(): Promise<Snapshot> {
  const [hosts, groups, tags, keys, knownHosts] = await Promise.all([
    ipc.hostsList(),
    ipc.groupsList(),
    ipc.tagsList(),
    ipc.keysList(),
    ipc.knownHostsList(),
  ]);

  return { hosts, groups, tags, keys, knownHosts };
}

const emptySnapshot: Snapshot = {
  hosts: [],
  groups: [],
  tags: [],
  keys: [],
  knownHosts: [],
};

export const useInventoryStore = create<InventoryStore>()((set, get) => {
  async function refresh(): Promise<void> {
    try {
      const snapshot = await fetchSnapshot();
      set({ ...snapshot, loaded: true, error: null });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  }

  async function mutate<T>(
    action: () => Promise<T>,
    options: { refreshForwardsFor?: string } = {},
  ): Promise<InventoryResult<T>> {
    try {
      const value = await action();

      if (options.refreshForwardsFor) {
        const hostId = options.refreshForwardsFor;
        const forwards = await ipc.forwardsList(hostId);
        set((state) => ({
          forwards: { ...state.forwards, [hostId]: forwards },
        }));
      }

      await refresh();
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  return {
    ...emptySnapshot,
    loaded: false,
    loading: false,
    error: null,
    forwards: {},

    load: async (force = false) => {
      if (get().loaded && !force) {
        return;
      }

      set({ loading: true, error: null });

      try {
        const snapshot = await fetchSnapshot();
        set({ ...snapshot, loaded: true, loading: false });
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
      }
    },

    refresh,

    clearError: () => set({ error: null }),

    createHost: (input) => mutate(() => ipc.hostCreate(input)),
    updateHost: (id, input) => mutate(() => ipc.hostUpdate(id, input)),
    deleteHost: (id) => mutate(() => ipc.hostDelete(id)),

    createGroup: (input) => mutate(() => ipc.groupCreate(input)),
    updateGroup: (id, input) => mutate(() => ipc.groupUpdate(id, input)),
    deleteGroup: (id) => mutate(() => ipc.groupDelete(id)),

    createTag: (input) => mutate(() => ipc.tagCreate(input)),
    updateTag: (id, input) => mutate(() => ipc.tagUpdate(id, input)),
    deleteTag: (id) => mutate(() => ipc.tagDelete(id)),

    importKey: (input) => mutate(() => ipc.keyImport(input)),
    generateKey: (input) => mutate(() => ipc.keyGenerate(input)),
    renameKey: (id, name) => mutate(() => ipc.keyUpdate(id, { name })),
    deleteKey: (id) => mutate(() => ipc.keyDelete(id)),

    loadForwards: async (hostId) => {
      try {
        const forwards = await ipc.forwardsList(hostId);
        set((state) => ({
          forwards: { ...state.forwards, [hostId]: forwards },
        }));
        return { ok: true, value: forwards };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    createForward: (input) =>
      mutate(() => ipc.forwardCreate(input), {
        refreshForwardsFor: input.host_id,
      }),

    updateForward: (id, input) =>
      mutate(() => ipc.forwardUpdate(id, input), {
        refreshForwardsFor: input.host_id,
      }),

    deleteForward: (hostId, id) =>
      mutate(() => ipc.forwardDelete(id), { refreshForwardsFor: hostId }),

    deleteKnownHost: (id) => mutate(() => ipc.knownHostDelete(id)),
  };
});
