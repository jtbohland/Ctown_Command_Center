import ArmChairDealer from "@/components/draft/ArmChairDealer";

/**
 * Exchange page — the landing page of the C-Town Command Center.
 * Renders the full ArmChairDealer Exchange with Redux Rosters as the default tab.
 */
export default function Exchange() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ArmChairDealer />
    </div>
  );
}
