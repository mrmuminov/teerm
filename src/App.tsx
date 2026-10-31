import { useEffect } from "react";

import { BootScreen } from "@/components/auth/BootScreen";
import { ErrorScreen } from "@/components/auth/ErrorScreen";
import { OnboardingScreen } from "@/components/auth/OnboardingScreen";
import { UnlockScreen } from "@/components/auth/UnlockScreen";
import { AppShell } from "@/components/layout/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLanguageSync } from "@/lib/i18n";
import { useThemeSync } from "@/lib/theme";
import { useSettingsStore } from "@/stores/settings";
import { useVaultStore } from "@/stores/vault";

function App() {
  const phase = useVaultStore((state) => state.phase);
  const error = useVaultStore((state) => state.error);
  const init = useVaultStore((state) => state.init);
  const loadSettings = useSettingsStore((state) => state.load);
  const theme = useThemeSync();
  useLanguageSync();

  useEffect(() => {
    void init();
    // Settings are not secret, so the saved theme applies on the lock screen too.
    void loadSettings();
  }, [init, loadSettings]);

  return (
    <TooltipProvider delayDuration={250}>
      {phase === "loading" && <BootScreen />}
      {phase === "onboarding" && <OnboardingScreen />}
      {phase === "locked" && <UnlockScreen />}
      {phase === "unlocked" && <AppShell />}
      {phase === "error" && (
        <ErrorScreen message={error} onRetry={() => void init()} />
      )}

      <Toaster theme={theme} position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;
