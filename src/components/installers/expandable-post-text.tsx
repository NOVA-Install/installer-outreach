"use client";

import { useState } from "react";

function HighlightKeyword({ text, keyword }: { text: string; keyword: string | null }) {
  if (!keyword || !text) return <>{text}</>;
  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-amber-100 text-amber-900 rounded px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function ExpandablePostText({
  text,
  keyword,
  maxLength = 280,
}: {
  text: string;
  keyword: string | null;
  maxLength?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > maxLength;
  const displayText = expanded || !needsTruncation ? text : text.slice(0, maxLength) + "…";

  return (
    <div>
      <p className="text-[12px] text-[#4a4a4a] mt-1.5 leading-relaxed whitespace-pre-line">
        <HighlightKeyword text={displayText} keyword={keyword} />
      </p>
      {needsTruncation && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[11px] text-[#0a66c2] hover:underline mt-1"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
