import { useEffect, useRef, useState } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SEARCH_DECORATIONS = {
  matchBackground: "#7ee2a833",
  matchBorder: "#7ee2a866",
  matchOverviewRuler: "#7ee2a8",
  activeMatchBackground: "#e8c87966",
  activeMatchBorder: "#e8c879",
  activeMatchColorOverviewRuler: "#e8c879",
};

export function TerminalSearchBar({
  search,
  onClose,
}: {
  search: SearchAddon | null;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();

    return () => search?.clearDecorations();
  }, [search]);

  function find(direction: "next" | "previous", incremental = false) {
    if (!search || !query) {
      search?.clearDecorations();
      return;
    }

    const options = { incremental, decorations: SEARCH_DECORATIONS };
    if (direction === "next") {
      search.findNext(query, options);
    } else {
      search.findPrevious(query, options);
    }
  }

  return (
    <div className="absolute top-3 right-4 z-10 flex items-center gap-1 rounded-lg border border-border/80 bg-card/95 p-1 shadow-lg shadow-black/40 backdrop-blur">
      <Input
        ref={inputRef}
        value={query}
        placeholder="Find in terminal"
        aria-label="Find in terminal"
        className="h-6 w-48 text-[11px]"
        onChange={(event) => {
          setQuery(event.target.value);
          if (search && event.target.value) {
            search.findNext(event.target.value, {
              incremental: true,
              decorations: SEARCH_DECORATIONS,
            });
          } else {
            search?.clearDecorations();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            find(event.shiftKey ? "previous" : "next");
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Previous match"
        onClick={() => find("previous")}
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Next match"
        onClick={() => find("next")}
      >
        <ChevronDown />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Close search"
        onClick={onClose}
      >
        <X />
      </Button>
    </div>
  );
}
