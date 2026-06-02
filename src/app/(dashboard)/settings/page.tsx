"use client";

import { useState, useEffect } from "react";
import { Settings, Save, RotateCcw, Loader2 } from "lucide-react";

const DEFAULT_OUTREACH_PROMPT = `You are filling in a message template. The message is FIXED — you are only customising the parts marked with [FILL].

TEMPLATE:
---
Hi {{contactName}}, saw your post about [FILL: write a natural, short summary of what their LinkedIn post is about — keep it under 15 words, lowercase, no quotes].{{additionalContext}} Thought it would be worth reaching out.

We run a nationwide solar campaign and we're bringing on a small number of high performing installers in each area before we close it off. We've analysed every installer in your area across reviews, online presence, pricing and marketing.

Happy to share where {{companyName}} ranks and how our campaign works if you're interested.
---

YOUR ONLY JOB:
1. Replace [FILL] with a short, natural description of their LinkedIn post topic
2. If there is additional context, weave it into the first paragraph naturally (e.g. "We worked together on ECO4, so thought it would be worth reaching out")
3. If there is no additional context, just use "Thought it would be worth reaching out"
4. Output the final message with NO other changes to the template text
5. Do NOT add paragraphs, sentences, or information that isn't in the template
6. Do NOT change the wording of paragraphs 2 or 3
7. Do NOT add a sign-off, greeting, or subject line (unless email format is requested)`;

export default function SettingsPage() {
  const [prompt, setPrompt] = useState(DEFAULT_OUTREACH_PROMPT);
  const [savedPrompt, setSavedPrompt] = useState(DEFAULT_OUTREACH_PROMPT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings?key=outreach_prompt")
      .then((r) => r.json())
      .then((data) => {
        if (data.value) {
          setPrompt(data.value);
          setSavedPrompt(data.value);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "outreach_prompt", value: prompt }),
    });
    setSavedPrompt(prompt);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const hasChanges = prompt !== savedPrompt;

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="flex items-center gap-2.5 mb-6">
          <Settings className="h-5 w-5 text-[#6a6a6a]" />
          <h1 className="text-[18px] font-semibold text-[#1D1D1D]">Settings</h1>
        </div>

        {/* Outreach Prompt */}
        <div className="rounded-xl border border-[#ebebeb] bg-white">
          <div className="px-5 py-4 border-b border-[#ebebeb]">
            <h2 className="text-[14px] font-semibold text-[#1D1D1D]">Outreach Message Prompt</h2>
            <p className="text-[12px] text-[#8a8a8a] mt-1">
              This prompt is used when generating LinkedIn DMs and emails from Social Signals.
              The installer's details, their LinkedIn post, and any additional context you add are injected automatically.
            </p>
          </div>
          <div className="p-5">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-[13px] text-[#9a9a9a]">
                Loading...
              </div>
            ) : (
              <>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full h-[500px] rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-4 py-3 text-[13px] font-mono leading-relaxed text-[#2a2a2a] placeholder:text-[#b0b0b0] focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40 resize-y"
                />
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={save}
                    disabled={saving || !hasChanges}
                    className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-[#0a66c2] text-white text-[12px] font-medium hover:bg-[#094fa0] transition-colors disabled:opacity-40"
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    {saved ? "Saved" : "Save"}
                  </button>
                  <button
                    onClick={() => setPrompt(DEFAULT_OUTREACH_PROMPT)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#e5e5e5] text-[12px] font-medium text-[#6a6a6a] hover:bg-[#fafafa] transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset to default
                  </button>
                  {hasChanges && (
                    <span className="text-[11px] text-amber-600 ml-2">Unsaved changes</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Available variables hint */}
        <div className="mt-4 rounded-lg bg-[#fafaf9] border border-[#ebebeb] px-4 py-3">
          <p className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider mb-2">Available variables (injected automatically)</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-[#6a6a6a]">
            <span><code className="text-[11px] bg-[#f0f0f0] px-1 rounded">{"{{companyName}}"}</code> — Installer company name</span>
            <span><code className="text-[11px] bg-[#f0f0f0] px-1 rounded">{"{{contactName}}"}</code> — Person's name</span>
            <span><code className="text-[11px] bg-[#f0f0f0] px-1 rounded">{"{{contactRole}}"}</code> — Person's role/headline</span>
            <span><code className="text-[11px] bg-[#f0f0f0] px-1 rounded">{"{{location}}"}</code> — Installer location</span>
            <span><code className="text-[11px] bg-[#f0f0f0] px-1 rounded">{"{{linkedinPost}}"}</code> — Their recent post text</span>
            <span><code className="text-[11px] bg-[#f0f0f0] px-1 rounded">{"{{dataPoints}}"}</code> — Enrichment data (email only)</span>
            <span><code className="text-[11px] bg-[#f0f0f0] px-1 rounded">{"{{additionalContext}}"}</code> — Your extra context</span>
          </div>
        </div>
      </div>
    </div>
  );
}
