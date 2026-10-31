import { beforeEach, describe, expect, it } from "vitest";

import { useForwardsStore } from "@/stores/forwards";

describe("forwards store", () => {
  beforeEach(() => useForwardsStore.setState({ bySession: {} }));

  it("tracks the runtime state per session and forward", () => {
    const { handleStatus } = useForwardsStore.getState();

    handleStatus({
      sessionId: "s1",
      forwardId: "f1",
      state: "running",
      message: null,
    });
    handleStatus({
      sessionId: "s1",
      forwardId: "f2",
      state: "failed",
      message: "port in use",
    });
    handleStatus({
      sessionId: "s2",
      forwardId: "f1",
      state: "stopped",
      message: null,
    });

    const { bySession } = useForwardsStore.getState();
    expect(bySession.s1.f1.state).toBe("running");
    expect(bySession.s1.f2).toEqual({ state: "failed", message: "port in use" });
    expect(bySession.s2.f1.state).toBe("stopped");
  });

  it("replaces the previous state of the same forward", () => {
    const { handleStatus } = useForwardsStore.getState();
    const base = { sessionId: "s1", forwardId: "f1", message: null };

    handleStatus({ ...base, state: "running" });
    handleStatus({ ...base, state: "stopped" });

    expect(useForwardsStore.getState().bySession.s1.f1.state).toBe("stopped");
  });
});
