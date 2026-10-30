import { useEffect } from "react";

import { BootScreen } from "@/components/auth/BootScreen";
import { ErrorScreen } from "@/components/auth/ErrorScreen";
import { OnboardingScreen } from "@/components/auth/OnboardingScreen";
import { UnlockScreen } from "@/components/auth/UnlockScreen";
import { AppShell } from "@/components/layout/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useVaultStore } from "@/stores/vault";

function App() {
  const phase = useVaultStore((state) => state.phase);
  const error = useVaultStore((state) => state.error);
  const init = useVaultStore((state) => state.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <TooltipProvider delayDuration={250}>
      {phase === "loading" && <BootScreen />}
      {phase === "onboarding" && <OnboardingScreen />}
      {phase === "locked" && <UnlockScreen />}
      {phase === "unlocked" && <AppShell />}
      {phase === "error" && (
        <ErrorScreen message={error} onRetry={() => void init()} />
      )}

      <Toaster theme="dark" position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;
