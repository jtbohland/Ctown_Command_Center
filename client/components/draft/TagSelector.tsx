import { memo, useCallback } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { TAG_OPTIONS, type TagKey } from "@/lib/draft-constants";

type TagSelectorProps = {
  currentTags: string[];
  onToggleTag: (tag: TagKey) => void;
  children: React.ReactNode;
};

const TagSelector = memo(function TagSelector({ currentTags, onToggleTag, children }: TagSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Player Tags</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {TAG_OPTIONS.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag.key}
            checked={currentTags.includes(tag.key)}
            onCheckedChange={() => onToggleTag(tag.key)}
          >
            <span className="mr-1">{tag.emoji}</span> {tag.label}
            {tag.points !== 0 && (
              <span className={`ml-auto text-[10px] font-mono ${tag.points > 0 ? "text-emerald-400" : "text-red-400"}`}>
                {tag.points > 0 ? `+${tag.points}` : tag.points}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export default TagSelector;
