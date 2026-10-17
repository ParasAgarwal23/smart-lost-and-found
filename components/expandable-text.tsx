"use client";

import { useLayoutEffect, useRef, useState } from "react";

// A description clamped to three lines, with "Show more" only when text is hidden.
export default function ExpandableText({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <div className="grid justify-items-start gap-1">
      <p ref={ref} className={`whitespace-pre-wrap ${expanded ? "" : "line-clamp-3"} ${className}`}>{text}</p>
      {(overflows || expanded) && (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
          className="text-sm font-semibold text-brand underline decoration-brand/40 underline-offset-[3px] hover:decoration-current">
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
