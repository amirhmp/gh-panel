import { useState, type FC } from "hono/jsx/dom";
import { shutdown } from "./api";
import { ServerCard } from "./components/ServerCard";
import { ServicesSection } from "./components/ServicesSection";
import { Toast } from "./components/Toast";

type Phase = "running" | "stopping" | "stopped";

export const App: FC = () => {
  const [phase, setPhase] = useState<Phase>("running");

  const onShutdown = async () => {
    if (!confirm("Shut down the panel and end the workflow?")) return;
    setPhase("stopping"); // stops polling and disables the button
    try {
      await shutdown();
    } catch {}
    setPhase("stopped");
  };

  if (phase === "stopped")
    return (
      <main>
        <div class="empty">
          <h1>Shut down</h1>
          <p>The workflow is ending.</p>
        </div>
      </main>
    );

  return (
    <>
      <main>
        <ServerCard
          active={phase === "running"}
          onShutdown={() => void onShutdown()}
        />
        <ServicesSection active={phase === "running"} />
      </main>
      <Toast />
    </>
  );
};
