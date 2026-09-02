import { Outlet } from "react-router";

import { App as AppProvider } from "@superblocksteam/library";

import { Toaster } from "./components/common/sonner";
import CommandCenterBar from "./components/common/CommandCenterBar";
import FantasyWiz from "./components/FantasyWiz";

export default function AppComponent() {
  return (
    <>
      {/* Do not remove the AppProvider */}
      <AppProvider className="h-full w-full">
        <div className="flex flex-col h-full overflow-hidden">
          <CommandCenterBar />
          <div className="flex-1 min-h-0 overflow-hidden">
            <Outlet />
          </div>
        </div>
      </AppProvider>
      <Toaster />
      <FantasyWiz />
    </>
  );
}
