import { useEffect, useState } from "react";

/** `text`, once it has stopped changing for `ms` — what a search box sends. */
export function useSettled(text: string, ms: number) {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(timer);
  }, [text, ms]);
  return settled;
}
