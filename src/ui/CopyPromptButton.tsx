import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bot, Check } from 'lucide-react';
import { promptForPath } from '../lib/agentPrompts';

/** Copies text, falling back to a hidden textarea where the async clipboard API is unavailable. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/**
 * "Copy prompt for your agent": copies a brief an AI agent can follow to do
 * this page's task through the API (see src/lib/agentPrompts.ts). `floating`
 * pins it top-right, opposite the menu button; `menu` renders a drawer item.
 */
export default function CopyPromptButton({ variant, onCopied }: { variant: 'floating' | 'menu'; onCopied?: () => void }) {
  const { pathname } = useLocation();
  const [copied, setCopied] = useState(false);
  const prompt = promptForPath(pathname);
  if (!prompt) return null;

  const copy = async () => {
    if (!(await copyText(prompt))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopied?.();
  };
  const Icon = copied ? Check : Bot;
  const label = copied ? 'Copied' : 'Copy prompt for your agent';
  const title = "Copies a brief your AI agent (Claude, ChatGPT, Codex) can follow to do this page's task through the Backgammon API";

  if (variant === 'menu') {
    return (
      <button
        type="button"
        onClick={() => void copy()}
        title={title}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
      >
        <Icon className="size-4" />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={title}
      aria-label={label}
      className="fixed right-3 top-3 z-40 flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-background/70 px-3 text-sm text-muted-foreground backdrop-blur transition-colors hover:text-foreground pr-[max(0.75rem,env(safe-area-inset-right))]"
    >
      <Icon className="size-4" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{copied ? 'Copied' : 'Agent prompt'}</span>
    </button>
  );
}
