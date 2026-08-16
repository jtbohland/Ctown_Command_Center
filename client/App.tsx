import { Outlet } from "react-router";

import { App as AppProvider } from "@superblocksteam/library";

import { Toaster } from "./components/common/sonner";
import FantasyWiz from "./components/FantasyWiz";

export default function AppComponent() {
  return (
    <>
      {/* Do not remove the AppProvider */}
      <AppProvider className="h-full w-full">
        <Outlet />
      </AppProvider>
      <Toaster />
      <FantasyWiz />
    </>
  );
}
