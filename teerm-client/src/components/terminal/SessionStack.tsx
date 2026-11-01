import { SftpPanel } from "@/components/sftp/SftpPanel";
import { SessionHeader } from "@/components/terminal/SessionHeader";
import { TerminalPane } from "@/components/terminal/TerminalPane";
import { cn } from "@/lib/utils";
import {
  useSessionsStore,
  type SessionTab,
} from "@/stores/sessions";
import { useSftpStore } from "@/stores/sftp";
import { useUiStore } from "@/stores/ui";

function SessionView({ tab, active }: { tab: SessionTab; active: boolean }) {
  const sftpVisible = useSftpStore(
    (state) => state.tabs[tab.id]?.visible ?? false,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SessionHeader tab={tab} active={active} />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <TerminalPane tab={tab} active={active} />
        </div>
        {sftpVisible ? <SftpPanel tab={tab} /> : null}
      </div>
    </div>
  );
}

export function SessionStack() {
  const tabs = useSessionsStore((state) => state.tabs);
  const activeSessionId = useUiStore((state) => state.activeSessionId);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[#0b0e11]">
      {tabs.map((tab) => {
        const active = tab.id === activeSessionId;

        return (
          <div
            key={tab.id}
            aria-hidden={!active}
            className={cn(
              "absolute inset-0",
              active ? "visible z-10" : "invisible pointer-events-none z-0",
            )}
          >
            <SessionView tab={tab} active={active} />
          </div>
        );
      })}
    </div>
  );
}
