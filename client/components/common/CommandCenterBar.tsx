import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import ctownReduxLogo from "@/public/logos/ctown-redux.png";

export default function CommandCenterBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isExchange = pathname === "/";
  const isDraftRoom = pathname === "/draft";
  const isSettings = pathname === "/settings";

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950">
      {/* Logo + Title */}
      <img src={ctownReduxLogo} alt="C-Town Redux" className="w-8 h-8 object-contain" />
      <span className="text-sm font-extrabold tracking-tight text-zinc-200">
        C-Town Command Center
      </span>

      {/* Spacer */}
      <div className="w-px h-5 bg-border/50 mx-1" />

      {/* Nav Buttons */}
      <Button
        variant={isExchange ? "secondary" : "ghost"}
        size="sm"
        className="h-7 text-xs px-3 gap-1.5"
        onClick={() => navigate("/")}
      >
        🫱🏻‍🫲🏽 The Exchange
      </Button>

      <Button
        variant={isDraftRoom ? "secondary" : "ghost"}
        size="sm"
        className="h-7 text-xs px-3 gap-1.5"
        onClick={() => navigate("/draft")}
      >
        🏈 Draft Room
      </Button>

      {/* Right side — Settings */}
      <div className="flex-1" />

      <Button
        variant={isSettings ? "secondary" : "ghost"}
        size="sm"
        className="h-7 text-xs px-2"
        onClick={() => navigate("/settings")}
      >
        ⚙️
      </Button>
    </div>
  );
}
